import { expect, test } from '@playwright/test';
import { createVault } from './helpers';

const SHOTS = process.env.SHOTS_DIR;

test('Início avisa que está fora do Drive; apagar tudo pede várias confirmações', async ({ page }) => {
  await createVault(page);
  await expect(page.getByText('Você está fora da conta Google')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/5-inicio-drive.png` });

  await page.getByRole('button', { name: 'Mais' }).click();
  await page.locator('.more-sheet').getByRole('button', { name: 'Ajustes' }).click();
  const sec = page.locator('#ajustes-apagar');
  await sec.scrollIntoViewIfNeeded();
  if (await sec.getByRole('button', { name: 'Quero apagar tudo…' }).isHidden()) await sec.getByText('Apagar tudo e começar do zero').click();
  await sec.getByRole('button', { name: 'Quero apagar tudo…' }).click();
  const go = sec.getByRole('button', { name: 'Apagar tudo', exact: true });
  await expect(go).toBeDisabled();
  await sec.getByText('Entendo que isso não pode ser desfeito').click();
  await sec.getByLabel(/Digite APAGAR TUDO/).fill('apagar tudo');
  await sec.getByLabel(/Senha do cofre/).fill('senha errada');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/6-apagar.png`, fullPage: true });
  await go.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Apagar tudo' }).click();
  await expect(sec.getByText('Nada foi apagado')).toBeVisible();
  await sec.getByLabel(/Senha do cofre/).fill('forno quente massa fina');
  await go.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Apagar tudo' }).click();
  await expect(page.locator('#s-name')).toBeVisible({ timeout: 30_000 });
});
