import { expect, test, type BrowserContext, type Route } from '@playwright/test';
import { createVault, novoInsumo } from './helpers';

/**
 * Google e Drive falsos, servidos pelo próprio Playwright: o app roda de verdade, com a janela
 * de login, a renovação pelo servidor e a API do Drive, mas nada sai para a internet.
 */
const EMAIL = 'dono@pizzaria.com';

class FakeGoogle {
  files = new Map<string, { name: string; parents: string[]; content: string; version: number }>();
  log: string[] = [];
  renewals = 0;
  /** A próxima chamada ao Drive responde 401 (token vencido antes da hora). */
  expireNext = false;
  private n = 0;

  lotes() {
    return [...this.files.values()].filter((f) => f.name.startsWith('lote-')).length;
  }

  async install(context: BrowserContext) {
    await context.route('**/api/google/login*', (route) => {
      const state = new URL(route.request().url()).searchParams.get('state')!;
      return route.fulfill({ status: 302, headers: { Location: `/oauth.html#state=${state}&access_token=tok-1&expires_in=3600` } });
    });
    await context.route('**/api/google/token', (route) => {
      this.renewals++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accessToken: `tok-r${this.renewals}`, expiresIn: 3600, email: EMAIL }) });
    });
    await context.route('**/api/google/logout', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
    await context.route('https://www.googleapis.com/**', (route) => this.drive(route));
  }

  private json(route: Route, body: unknown, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
  }

  private async drive(route: Route) {
    const req = route.request();
    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH' } });
    }
    const url = new URL(req.url());
    if (url.pathname === '/oauth2/v3/userinfo') return this.json(route, { email: EMAIL, email_verified: true });
    if (this.expireNext) {
      this.expireNext = false;
      return this.json(route, { error: 'expirado' }, 401);
    }
    const file = (id: string) => ({ id, name: this.files.get(id)!.name, version: String(this.files.get(id)!.version) });
    if (url.pathname === '/drive/v3/changes/startPageToken') return this.json(route, { startPageToken: String(this.log.length) });
    if (url.pathname === '/drive/v3/changes') {
      const from = Number(url.searchParams.get('pageToken'));
      const ids = [...new Set(this.log.slice(from))];
      return this.json(route, { newStartPageToken: String(this.log.length), changes: ids.map((id) => ({ fileId: id, file: { ...file(id), parents: this.files.get(id)!.parents } })) });
    }
    if (url.pathname === '/drive/v3/files' && req.method() === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const name = /name = '([^']+)'/.exec(q)?.[1];
      const ids = [...this.files.keys()].filter((id) => (parent ? this.files.get(id)!.parents.includes(parent) : this.files.get(id)!.name === name));
      return this.json(route, { files: ids.map(file) });
    }
    if (url.pathname === '/drive/v3/files' && req.method() === 'POST') {
      const meta = JSON.parse(req.postData() ?? '{}') as { name: string };
      return this.json(route, { id: this.add(meta.name, [], '') });
    }
    if (url.pathname === '/upload/drive/v3/files' && req.method() === 'POST') {
      const body = req.postData() ?? '';
      const parts = body.split(/--cr[0-9a-f]+/).map((p) => p.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''));
      const meta = JSON.parse(parts[1]!) as { name: string; parents: string[] };
      const id = this.add(meta.name, meta.parents, parts[2]!);
      return this.json(route, file(id));
    }
    const m = /^\/(upload\/)?drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (m && req.method() === 'PATCH') {
      const f = this.files.get(m[2]!)!;
      f.content = req.postData() ?? '';
      f.version++;
      this.log.push(m[2]!);
      return this.json(route, file(m[2]!));
    }
    if (m && req.method() === 'GET') {
      return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: this.files.get(m[2]!)!.content });
    }
    return this.json(route, { error: 'não simulado' }, 404);
  }

  private add(name: string, parents: string[], content: string) {
    const id = `id${++this.n}`;
    this.files.set(id, { name, parents, content, version: 1 });
    this.log.push(id);
    return id;
  }
}

test('cada mudança sobe sozinha para o Drive, espera sem internet e renova o login', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const google = new FakeGoogle();
  await google.install(context);

  await createVault(page);
  const chip = page.locator('.topbar .account-chip');

  // Entrar com Google em Ajustes: o cofre vai para o Drive.
  await chip.click();
  await page.click('#ajustes-drive >> text=Entrar com Google');
  await expect(page.getByText('Tudo no Drive. Cada mudança sobe sozinha')).toBeVisible({ timeout: 15_000 });
  expect([...google.files.values()].some((f) => f.name === 'cofre.json')).toBe(true);
  const first = google.lotes();
  expect(first).toBeGreaterThan(0);

  // Uma mudança qualquer: sobe sozinha em poucos segundos, sem tocar em nada.
  await novoInsumo(page, 'Rúcula');
  await expect.poll(() => google.lotes(), { timeout: 10_000 }).toBeGreaterThan(first);
  await expect(chip).toHaveAttribute('aria-label', /Tudo no Drive/);

  // Sem internet: a mudança espera no aparelho e o indicador mostra quantas.
  await context.setOffline(true);
  const before = google.lotes();
  await novoInsumo(page, 'Tomate Seco');
  await expect(chip).toHaveAttribute('aria-label', /Sem internet, 1 mudança esperando/, { timeout: 10_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/drive-sem-internet.png', clip: { x: 0, y: 0, width: 412, height: 200 } });
  expect(google.lotes()).toBe(before);

  // A internet volta: sobe na hora.
  await context.setOffline(false);
  await expect.poll(() => google.lotes(), { timeout: 10_000 }).toBe(before + 1);
  await expect(chip).toHaveAttribute('aria-label', /Tudo no Drive/);

  // O Google recusa o token antes da hora: o app renova pelo servidor, sem janela, e sobe.
  google.expireNext = true;
  const renewals = google.renewals;
  await novoInsumo(page, 'Azeitona Preta');
  await expect.poll(() => google.lotes(), { timeout: 10_000 }).toBe(before + 2);
  expect(google.renewals).toBeGreaterThan(renewals);
  await expect(chip).toHaveAttribute('aria-label', /Tudo no Drive/);

  expect(errors).toEqual([]);
});
