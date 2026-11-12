import { GOOGLE_CLIENT_ID } from '../config';
import { randomBytes, toHex } from '../crypto/encoding';

export interface GoogleToken {
  accessToken: string;
  expiresAt: number;
}

/**
 * Abre a janela de login do Google e espera o token. A janela passa por /api/google/login:
 * com a renovação ligada no servidor, o login fica guardado e o app renova sozinho depois
 * (`renewGoogleToken`); sem ela, o token vale cerca de 1 hora. A volta acontece em /oauth.html,
 * que entrega o token por um canal do próprio endereço do app (BroadcastChannel).
 * Precisa ser chamada a partir de um toque do usuário, senão o navegador bloqueia a janela.
 */
export function requestGoogleToken(loginHint?: string, opts: { folders?: boolean } = {}): Promise<GoogleToken> {
  if (!GOOGLE_CLIENT_ID) return Promise.reject(new Error('O acesso ao Google ainda não foi configurado neste app.'));
  const state = toHex(randomBytes(16).buffer);
  const params = new URLSearchParams({ state, ...(loginHint ? { hint: loginHint } : {}), ...(opts.folders ? { escopo: 'pastas' } : {}) });
  const popup = window.open(`/api/google/login?${params}`, 'ficharedonda-google', 'width=480,height=640');
  if (!popup) return Promise.reject(new Error('O navegador bloqueou a janela do Google. Permita janelas para este site e tente de novo.'));

  return new Promise((resolve, reject) => {
    const ch = new BroadcastChannel('ficharedonda-oauth');
    const timer = setTimeout(() => finish(new Error('O login no Google demorou demais. Tente de novo.')), 5 * 60_000);
    function finish(err: Error | null, token?: GoogleToken) {
      clearTimeout(timer);
      ch.close();
      if (err) reject(err);
      else resolve(token!);
    }
    ch.onmessage = (ev: MessageEvent<{ state: string; accessToken: string | null; expiresIn: number; error: string | null }>) => {
      const m = ev.data;
      if (!m || m.state !== state) return; // resposta de outro pedido: ignora
      if (m.error || !m.accessToken) return finish(new Error(m.error === 'access_denied' ? 'Você não autorizou o acesso ao Google Drive.' : 'O Google não completou o login.'));
      finish(null, { accessToken: m.accessToken, expiresAt: expiry(m.expiresIn) });
    };
  });
}

/** Vence um minuto antes do que o Google diz, para nunca usar um token no limite. */
const expiry = (seconds: number) => Date.now() + Math.max(60, seconds - 60) * 1000;

export type Renewal =
  | { kind: 'ok'; token: GoogleToken; email: string }
  /** Precisa de um toque: não há login guardado, ou o Google pediu para entrar de novo. */
  | { kind: 'login' }
  /** Esta instalação não tem a renovação ligada (falta o segredo no Cloudflare). */
  | { kind: 'off' }
  /** Sem rede ou o Google não respondeu: tentar mais tarde. */
  | { kind: 'retry' };

/** Pede ao servidor um token novo com o login guardado no cookie. Nunca abre janela. */
export async function renewGoogleToken(): Promise<Renewal> {
  let res: Response;
  try {
    res = await fetch('/api/google/token', { method: 'POST', credentials: 'same-origin' });
  } catch {
    return { kind: 'retry' };
  }
  const isJson = (res.headers.get('Content-Type') ?? '').includes('application/json');
  // Resposta que não é do Worker (app servido sem ele, em desenvolvimento): renovação desligada.
  if (!isJson) return { kind: 'off' };
  const data = (await res.json().catch(() => ({}))) as { accessToken?: string; expiresIn?: number; email?: string; code?: string };
  if (res.ok && data.accessToken && data.email) return { kind: 'ok', token: { accessToken: data.accessToken, expiresAt: expiry(data.expiresIn ?? 3600) }, email: data.email };
  if (data.code === 'login') return { kind: 'login' };
  if (data.code === 'off') return { kind: 'off' };
  return { kind: 'retry' };
}

/** Sair: o servidor apaga o login guardado e encerra o acesso no Google (também o token em uso). */
export async function forgetGoogleLogin(accessToken?: string): Promise<void> {
  try {
    await fetch('/api/google/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(accessToken ? { accessToken } : {}) });
  } catch {
    // Sem rede: o cookie continua, mas o cofre já não sincroniza com essa conta.
  }
}
