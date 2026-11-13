import { expect, test } from '@playwright/test';
import { createVault, importPlanilha } from './helpers';

const SHOTS = process.env.SHOTS_DIR;

test('criar cofre, importar a planilha, abrir a ficha, lançar compra e simular meio a meio', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await createVault(page);
  await importPlanilha(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-inicio.png`, fullPage: true });

  // Pendências da planilha aparecem no Início.
  await expect(page.getByText('Sem Receita').first()).toBeVisible();

  // A ficha da Mussarela: CMV comida do Médio = massa + molho + queijo.
  await page.locator('nav').getByRole('button', { name: /Pizzas/ }).first().click();
  await page.getByRole('button', { name: /Mussarela/ }).first().click();
  await expect(page.getByText('R$ 8,19').first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-ficha.png`, fullPage: true });
  await page.getByText('Modo cozinha').click();
  await expect(page.getByLabel('Modo cozinha')).toBeVisible();

  // Compra nova muda o preço do insumo.
  await page.locator('nav').getByRole('button', { name: 'Insumos' }).click();
  await page.getByRole('button', { name: 'Lançar compra' }).first().click();
  await page.selectOption('#co-ins', { label: 'Queijo Mussarela' });
  await page.fill('#co-preco', '60');
  await page.fill('#co-qtd', '1');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/3-compra.png`, fullPage: true });
  await page.locator('form').getByRole('button', { name: 'Lançar compra' }).click();
  await expect(page.getByText(/Compra lançada/)).toBeVisible();

  // Meio a meio abre com os sabores.
  await page.getByRole('button', { name: 'Mais' }).click();
  await page.locator('.more-sheet').getByRole('button', { name: 'Meio a meio' }).click();
  await expect(page.getByRole('heading', { name: 'Meio a meio' })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4-meio.png`, fullPage: true });

  // Canais e preços compara os três canais.
  await page.locator('nav').getByRole('button', { name: /Preços/ }).first().click();
  await expect(page.getByText('iFood').first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/5-canais.png`, fullPage: true });

  expect(errors).toEqual([]);
});
