/**
 * Login do Google renovado pelo servidor.
 *
 * O navegador abre /api/google/login numa janelinha. Com GOOGLE_CLIENT_SECRET configurado, o
 * Worker pede ao Google um "código" (fluxo de autorização com acesso offline), troca o código
 * por um token de acesso e um token de renovação, e guarda o de renovação cifrado num cookie
 * HttpOnly: o JavaScript do app nunca o vê. Depois, POST /api/google/token devolve um token de
 * acesso novo sempre que o anterior vence (cerca de 1 hora), sem abrir janela nenhuma.
 *
 * Sem o segredo, /api/google/login cai no fluxo antigo (o token vem direto na volta e dura
 * 1 hora), e /api/google/token responde que a renovação está desligada.
 */

export interface GoogleEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Opcional: chave própria para cifrar o cookie. Sem ela, deriva do GOOGLE_CLIENT_SECRET. */
  GOOGLE_COOKIE_KEY?: string;
}

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const SCOPES = 'https://www.googleapis.com/auth/drive.file openid email';
const READ_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

const SESSION_COOKIE = 'cr_google';
const STATE_COOKIE = 'cr_google_state';
const SESSION_DAYS = 180;

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

type TokenReply = { accessToken: string; expiresIn: number; email: string };

const reply = (status: number, body: unknown, cookies: string[] = []) => {
  const headers = new Headers(HEADERS);
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify(body), { status, headers });
};

const redirect = (to: string, cookies: string[] = []) => {
  const headers = new Headers({ Location: to, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
};

export const renewalOn = (env: GoogleEnv) => !!env.GOOGLE_CLIENT_SECRET;

/** Atende /api/google/*. Devolve null para outros caminhos. */
export async function googleRoutes(request: Request, env: GoogleEnv, clientId: string): Promise<Response | null> {
  const url = new URL(request.url);
  switch (url.pathname) {
    case '/api/google/login':
      return login(url, env, clientId);
    case '/api/google/callback':
      return callback(request, url, env, clientId);
    case '/api/google/token':
      return token(request, env, clientId);
    case '/api/google/logout':
      return logout(request, env);
    default:
      return null;
  }
}

const sameOrigin = (request: Request) => {
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(request.url).origin;
};

/** Abre o login do Google. `state` vem do app (confere a volta); `hint` é o e-mail esperado. */
function login(url: URL, env: GoogleEnv, clientId: string): Response {
  const state = url.searchParams.get('state') ?? '';
  if (!/^[0-9a-f]{32}$/.test(state)) return reply(400, { error: 'Pedido de login inválido.' });
  const hint = (url.searchParams.get('hint') ?? '').slice(0, 320);
  // Ler pastas do Drive (caixa de entrada) pede mais acesso; só quando o dono escolhe usar isso.
  const folders = url.searchParams.get('escopo') === 'pastas';
  const base = {
    client_id: clientId,
    scope: folders ? `${SCOPES} ${READ_SCOPE}` : SCOPES,
    include_granted_scopes: 'true',
    state,
    ...(hint ? { login_hint: hint } : {}),
  };
  if (!renewalOn(env)) {
    // Fluxo antigo: o token volta direto para /oauth.html e vale cerca de 1 hora.
    const params = new URLSearchParams({ ...base, redirect_uri: `${url.origin}/oauth.html`, response_type: 'token', ...(hint ? {} : { prompt: 'select_account' }) });
    return redirect(`${AUTH_URL}?${params}`);
  }
  const params = new URLSearchParams({
    ...base,
    redirect_uri: `${url.origin}/api/google/callback`,
    response_type: 'code',
    access_type: 'offline',
    // "consent" garante que o Google mande o token de renovação mesmo para quem já autorizou antes.
    prompt: hint ? 'consent' : 'select_account consent',
  });
  // A volta do Google é uma navegação vinda de outro site: o cookie do "state" precisa ser Lax.
  return redirect(`${AUTH_URL}?${params}`, [cookie(STATE_COOKIE, state, { maxAge: 600, sameSite: 'Lax', path: '/api/google/callback' })]);
}

/** Volta do Google: troca o código, guarda a renovação no cookie e entrega o token à janela do app. */
async function callback(request: Request, url: URL, env: GoogleEnv, clientId: string): Promise<Response> {
  const state = url.searchParams.get('state') ?? '';
  const clearState = cookie(STATE_COOKIE, '', { maxAge: 0, sameSite: 'Lax', path: '/api/google/callback' });
  const back = (fields: Record<string, string>, cookies: string[] = []) =>
    redirect(`${url.origin}/oauth.html#${new URLSearchParams({ state, ...fields })}`, [clearState, ...cookies]);

  if (!renewalOn(env)) return back({ error: 'server_error' });
  const error = url.searchParams.get('error');
  if (error) return back({ error: error === 'access_denied' ? 'access_denied' : 'server_error' });
  const expected = readCookie(request, STATE_COOKIE);
  const code = url.searchParams.get('code');
  if (!code || !expected || expected !== state) return back({ error: 'state_mismatch' });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: env.GOOGLE_CLIENT_SECRET!, redirect_uri: `${url.origin}/api/google/callback`, grant_type: 'authorization_code' }),
  });
  if (!res.ok) return back({ error: 'server_error' });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; refresh_token?: string; id_token?: string };
  const email = emailFromIdToken(data.id_token);
  if (!data.access_token || !email) return back({ error: 'server_error' });

  const cookies: string[] = [];
  if (data.refresh_token) {
    const sealed = await sealSession(env, { rt: data.refresh_token, email });
    cookies.push(cookie(SESSION_COOKIE, sealed, { maxAge: SESSION_DAYS * 86400, sameSite: 'Strict', path: '/api/google' }));
  }
  return back({ access_token: data.access_token, expires_in: String(data.expires_in ?? 3600), renewal: data.refresh_token ? '1' : '0' }, cookies);
}

/** Token de acesso novo, a partir do cookie. Sem janela, sem toque. */
async function token(request: Request, env: GoogleEnv, clientId: string): Promise<Response> {
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' });
  if (!sameOrigin(request)) return reply(403, { error: 'Origem não permitida.' });
  if (!renewalOn(env)) return reply(404, { error: 'A renovação automática do login não está ligada.', code: 'off' });
  const raw = readCookie(request, SESSION_COOKIE);
  const session = raw ? await openSession(env, raw) : null;
  const clear = cookie(SESSION_COOKIE, '', { maxAge: 0, sameSite: 'Strict', path: '/api/google' });
  if (!session) return reply(401, { error: 'Entre com Google de novo.', code: 'login' }, raw ? [clear] : []);

  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: env.GOOGLE_CLIENT_SECRET!, refresh_token: session.rt, grant_type: 'refresh_token' }),
    });
  } catch {
    return reply(502, { error: 'Não consegui falar com o Google agora.', code: 'retry' });
  }
  if (res.status === 400 || res.status === 401) {
    // invalid_grant: o dono tirou o acesso, trocou a senha do Google ou passou muito tempo sem usar.
    return reply(401, { error: 'O Google pediu para você entrar de novo.', code: 'login' }, [clear]);
  }
  if (!res.ok) return reply(502, { error: 'O Google não renovou o acesso agora.', code: 'retry' });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; refresh_token?: string };
  if (!data.access_token) return reply(502, { error: 'O Google não renovou o acesso agora.', code: 'retry' });
  const cookies: string[] = [];
  // Se o Google trocar o token de renovação, guarda o novo. Também estende a validade do cookie.
  const sealed = await sealSession(env, { rt: data.refresh_token ?? session.rt, email: session.email });
  cookies.push(cookie(SESSION_COOKIE, sealed, { maxAge: SESSION_DAYS * 86400, sameSite: 'Strict', path: '/api/google' }));
  const body: TokenReply = { accessToken: data.access_token, expiresIn: data.expires_in ?? 3600, email: session.email };
  return reply(200, body, cookies);
}

/** Sair: apaga o cookie e avisa o Google para encerrar o acesso. */
async function logout(request: Request, env: GoogleEnv): Promise<Response> {
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' });
  if (!sameOrigin(request)) return reply(403, { error: 'Origem não permitida.' });
  const raw = readCookie(request, SESSION_COOKIE);
  const session = raw && renewalOn(env) ? await openSession(env, raw) : null;
  const body = (await request.json().catch(() => ({}))) as { accessToken?: unknown };
  // O token de renovação encerra o acesso todo; sem ele, encerra ao menos o token em uso.
  const revoke = session?.rt ?? (typeof body.accessToken === 'string' && body.accessToken.length < 4096 ? body.accessToken : null);
  if (revoke) {
    try {
      await fetch(`${REVOKE_URL}?token=${encodeURIComponent(revoke)}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    } catch {
      // Sem rede até o Google: o cookie some do mesmo jeito.
    }
  }
  return reply(200, { ok: true }, [cookie(SESSION_COOKIE, '', { maxAge: 0, sameSite: 'Strict', path: '/api/google' })]);
}

// ---------- cookie cifrado ----------

function cookie(name: string, value: string, o: { maxAge: number; sameSite: 'Strict' | 'Lax'; path: string }) {
  return `${name}=${value}; Max-Age=${o.maxAge}; Path=${o.path}; HttpOnly; Secure; SameSite=${o.sameSite}`;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null;
  }
  return null;
}

/** O id_token veio direto do Google por HTTPS, na troca do código: basta ler o e-mail. */
function emailFromIdToken(idToken?: string): string | null {
  const payload = idToken?.split('.')[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as { email?: string; email_verified?: boolean | string };
    if (!json.email || !(json.email_verified === true || json.email_verified === 'true')) return null;
    return json.email.toLowerCase();
  } catch {
    return null;
  }
}

const keys = new Map<string, Promise<CryptoKey>>();
function cookieKey(env: GoogleEnv): Promise<CryptoKey> {
  const material = env.GOOGLE_COOKIE_KEY || env.GOOGLE_CLIENT_SECRET || '';
  let k = keys.get(material);
  if (!k) {
    k = crypto.subtle
      .importKey('raw', new TextEncoder().encode(material), 'HKDF', false, ['deriveKey'])
      .then((base) => crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('ficharedonda'), info: new TextEncoder().encode('cookie google v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
    keys.set(material, k);
  }
  return k;
}

const AAD = new TextEncoder().encode(SESSION_COOKIE);

export async function sealSession(env: GoogleEnv, s: { rt: string; email: string }): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, await cookieKey(env), new TextEncoder().encode(JSON.stringify(s))));
  return `${b64url(iv)}.${b64url(ct)}`;
}

export async function openSession(env: GoogleEnv, raw: string): Promise<{ rt: string; email: string } | null> {
  const [iv, ct] = raw.split('.');
  if (!iv || !ct) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64urlDecode(iv), additionalData: AAD }, await cookieKey(env), b64urlDecode(ct));
    const s = JSON.parse(new TextDecoder().decode(plain)) as { rt?: string; email?: string };
    return s.rt && s.email ? { rt: s.rt, email: s.email } : null;
  } catch {
    return null; // cookie mexido ou de outro segredo
  }
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
