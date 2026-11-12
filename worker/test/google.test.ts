import { beforeEach, describe, expect, it, vi } from 'vitest';
import { googleRoutes, openSession, sealSession } from '../google';

const ORIGIN = 'https://app.test';
const CLIENT = 'app-id';
const on = { GOOGLE_CLIENT_SECRET: 'segredo-de-teste' };
const off = {};

/** Respostas do "Google" falso, por endereço. */
let google: (url: string, body: URLSearchParams) => Response;
let seen: { url: string; body: URLSearchParams }[];

const idToken = (email: string) => `x.${btoa(JSON.stringify({ email, email_verified: true })).replace(/=+$/, '')}.y`;

beforeEach(() => {
  seen = [];
  google = () => new Response('{}', { status: 500 });
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const body = new URLSearchParams(typeof init?.body === 'string' ? init.body : init?.body ? String(init.body) : '');
    seen.push({ url, body });
    return google(url, body);
  });
});

const get = (path: string, cookie?: string) => new Request(`${ORIGIN}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
const post = (path: string, cookie?: string, origin = ORIGIN) => new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) } });
const route = async (r: Request, env: object) => (await googleRoutes(r, env, CLIENT))!;
const setCookies = (res: Response) => res.headers.getSetCookie();
const cookieValue = (res: Response, name: string) => setCookies(res).find((c) => c.startsWith(`${name}=`))?.split(';')[0]!.slice(name.length + 1) ?? null;
const STATE = 'a'.repeat(32);

describe('login do Google renovado pelo servidor', () => {
  it('sem o segredo, o login cai no fluxo antigo e a renovação diz que está desligada', async () => {
    const res = await route(get(`/api/google/login?state=${STATE}`), off);
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get('Location')!);
    expect(to.searchParams.get('response_type')).toBe('token');
    expect(to.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/oauth.html`);
    const t = await route(post('/api/google/token'), off);
    expect(t.status).toBe(404);
    expect(await t.json()).toMatchObject({ code: 'off' });
  });

  it('com o segredo, pede código com acesso offline e guarda o "state" num cookie', async () => {
    const res = await route(get(`/api/google/login?state=${STATE}&hint=dono@pizzaria.com`), on);
    const to = new URL(res.headers.get('Location')!);
    expect(to.searchParams.get('response_type')).toBe('code');
    expect(to.searchParams.get('access_type')).toBe('offline');
    expect(to.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/google/callback`);
    expect(to.searchParams.get('login_hint')).toBe('dono@pizzaria.com');
    const c = setCookies(res)[0]!;
    expect(c).toMatch(/^cr_google_state=a{32};/);
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=Lax/);
    expect((await route(get('/api/google/login?state=curto'), on)).status).toBe(400);
  });

  it('a volta troca o código, guarda a renovação cifrada e entrega o token à janela do app', async () => {
    google = (url) => url.includes('/token')
      ? Response.json({ access_token: 'acesso-1', expires_in: 3599, refresh_token: 'renova-1', id_token: idToken('Dono@Pizzaria.com') })
      : new Response('', { status: 404 });
    const res = await route(get(`/api/google/callback?state=${STATE}&code=c0d3`, `cr_google_state=${STATE}`), on);
    expect(res.status).toBe(302);
    const back = new URL(res.headers.get('Location')!);
    expect(back.pathname).toBe('/oauth.html');
    const frag = new URLSearchParams(back.hash.slice(1));
    expect(frag.get('access_token')).toBe('acesso-1');
    expect(frag.get('state')).toBe(STATE);
    expect(seen[0]!.body.get('client_secret')).toBe('segredo-de-teste');
    expect(seen[0]!.body.get('grant_type')).toBe('authorization_code');

    const sealed = cookieValue(res, 'cr_google')!;
    expect(sealed).not.toContain('renova-1'); // cifrado
    expect(setCookies(res).find((c) => c.startsWith('cr_google='))).toMatch(/HttpOnly; Secure; SameSite=Strict/);
    expect(await openSession(on, sealed)).toEqual({ rt: 'renova-1', email: 'dono@pizzaria.com' });
  });

  it('a volta recusa "state" diferente do cookie (outra janela ou ataque)', async () => {
    const res = await route(get(`/api/google/callback?state=${STATE}&code=c0d3`, `cr_google_state=${'b'.repeat(32)}`), on);
    expect(new URLSearchParams(new URL(res.headers.get('Location')!).hash.slice(1)).get('error')).toBe('state_mismatch');
    expect(seen).toHaveLength(0);
  });

  it('renova sem janela com o cookie, e guarda o token novo de renovação se o Google trocar', async () => {
    google = () => Response.json({ access_token: 'acesso-2', expires_in: 3599, refresh_token: 'renova-2' });
    const sealed = await sealSession(on, { rt: 'renova-1', email: 'dono@pizzaria.com' });
    const res = await route(post('/api/google/token', `cr_google=${sealed}`), on);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accessToken: 'acesso-2', expiresIn: 3599, email: 'dono@pizzaria.com' });
    expect(seen[0]!.body.get('refresh_token')).toBe('renova-1');
    expect(await openSession(on, cookieValue(res, 'cr_google')!)).toEqual({ rt: 'renova-2', email: 'dono@pizzaria.com' });
  });

  it('sem cookie, cookie mexido ou acesso tirado no Google: pede para entrar de novo', async () => {
    expect(await (await route(post('/api/google/token'), on)).json()).toMatchObject({ code: 'login' });
    const sealed = await sealSession(on, { rt: 'renova-1', email: 'dono@pizzaria.com' });
    const tampered = sealed.slice(0, -3) + (sealed.endsWith('AAA') ? 'BBB' : 'AAA');
    const t = await route(post('/api/google/token', `cr_google=${tampered}`), on);
    expect(t.status).toBe(401);
    expect(cookieValue(t, 'cr_google')).toBe(''); // apaga o cookie ruim
    expect(setCookies(t)[0]).toMatch(/Max-Age=0/);
    // Cifrado com outro segredo também não abre.
    expect(await openSession({ GOOGLE_CLIENT_SECRET: 'outro' }, sealed)).toBeNull();

    google = () => Response.json({ error: 'invalid_grant' }, { status: 400 });
    const g = await route(post('/api/google/token', `cr_google=${sealed}`), on);
    expect(g.status).toBe(401);
    expect(await g.json()).toMatchObject({ code: 'login' });
    expect(setCookies(g)[0]).toMatch(/Max-Age=0/);
  });

  it('Google fora do ar: pede para tentar depois, sem apagar o login', async () => {
    google = () => new Response('', { status: 503 });
    const sealed = await sealSession(on, { rt: 'renova-1', email: 'dono@pizzaria.com' });
    const res = await route(post('/api/google/token', `cr_google=${sealed}`), on);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: 'retry' });
    expect(setCookies(res)).toHaveLength(0);
  });

  it('recusa outra origem e GET na renovação', async () => {
    expect((await route(post('/api/google/token', undefined, 'https://outro.site'), on)).status).toBe(403);
    expect((await route(get('/api/google/token'), on)).status).toBe(405);
  });

  it('sair apaga o cookie e encerra o acesso no Google', async () => {
    google = () => new Response('', { status: 200 });
    const sealed = await sealSession(on, { rt: 'renova-1', email: 'dono@pizzaria.com' });
    const res = await route(post('/api/google/logout', `cr_google=${sealed}`), on);
    expect(res.status).toBe(200);
    expect(setCookies(res)[0]).toMatch(/^cr_google=; Max-Age=0/);
    expect(seen[0]!.url).toContain('revoke?token=renova-1');
  });
});
