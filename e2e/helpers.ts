import { expect, type Page } from '@playwright/test';

export const PLANILHA = new URL('./fixtures/ficha-exemplo.xlsx', import.meta.url).pathname;

/** Cria um cofre novo, do primeiro acesso até o Início (ainda vazio). */
export async function createVault(page: Page) {
  await page.goto('/');
  await page.fill('#s-name', 'Pizzaria Teste');
  await page.click('text=Continuar');
  await page.fill('#s-pw', 'forno quente massa fina');
  await page.fill('#s-pw2', 'forno quente massa fina');
  await page.click('text=Criar cofre');
  await page.waitForSelector('.codes', { timeout: 30_000 });
  const codes = await page.$$eval('p.codes', (els) => els.map((e) => (e.textContent ?? '').replace(/[^A-Z0-9]/gi, '')));
  await page.fill('#s-c1', codes[0]!.slice(-4));
  await page.fill('#s-c2', codes[1]!.slice(0, 4));
  await page.click('text=Já guardei os dois');
  await page.fill('#s-pin', '274159');
  await page.fill('#s-pin2', '274159');
  await page.click('text=Começar a usar');
  await expect(page.getByText('Vamos trazer as suas fichas técnicas')).toBeVisible();
}

/** Importa a planilha de exemplo pelo botão do Início. */
export async function importPlanilha(page: Page) {
  await page.getByRole('button', { name: 'Importar planilha' }).click();
  await page.locator('input[type=file]').first().setInputFiles(PLANILHA);
  await expect(page.getByText('Confira os números')).toBeVisible();
  await page.getByRole('button', { name: 'Importar', exact: true }).click();
  await expect(page.getByText('O que precisa da sua atenção')).toBeVisible();
}

/** Uma mudança qualquer: cadastra um insumo novo. */
export async function novoInsumo(page: Page, nome: string) {
  await page.locator('nav').getByRole('button', { name: 'Insumos' }).click();
  await page.getByRole('button', { name: 'Novo insumo' }).click();
  await page.fill('#in-nome', nome);
  await page.fill('#in-preco', '10');
  await page.fill('#in-qtd', '1');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('heading', { name: nome })).toBeVisible();
}
