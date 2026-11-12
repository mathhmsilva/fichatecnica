/**
 * Worker do Ficha Redonda (Cloudflare). Só faz duas coisas:
 * - /api/google/*: login do Google renovado pelo servidor (ver google.ts);
 * - o resto do endereço serve os arquivos do app (dist/).
 * Os dados da pizzaria nunca passam por aqui: ficam cifrados no aparelho e no Drive do dono.
 */
import { googleRoutes, type GoogleEnv } from './google';

/** ID do cliente OAuth do app (público). A variável GOOGLE_CLIENT_ID no painel, se existir, vale mais. */
const DEFAULT_GOOGLE_CLIENT_ID = '902687953951-9oqtf22u0o3li55msmcd3hgcpblrj9im.apps.googleusercontent.com';

interface Env extends GoogleEnv {
  ASSETS: Fetcher;
  GOOGLE_CLIENT_ID?: string;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/google/')) {
      const r = await googleRoutes(request, env, env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID);
      if (r) return r;
    }
    if (url.pathname.startsWith('/api/')) return json(404, { error: 'Não encontrado.' });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
