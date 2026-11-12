import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Session, restoreBackup } from '../app/service';
import { LocalDb } from '../store/localdb';
import { MemoryDrive } from '../sync/drive';
import { pullVault } from '../sync/sync';
import { readXlsxSheets } from '../import/xlsx';
import { lerPlanilha } from '../import/planilha';

const PASSWORD = 'forno a lenha de domingo';
const EMAIL = 'dono@exemplo.com';

async function catalogo() {
  const buf = readFileSync(new URL('../../e2e/fixtures/ficha-exemplo.xlsx', import.meta.url));
  return lerPlanilha(await readXlsxSheets(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))).catalogo;
}

async function novo() {
  const db = await LocalDb.open(`t-${Math.random()}`);
  const { session, recoveryCodes } = await Session.create(db, PASSWORD, { businessName: 'Pizzaria' });
  return { db, session, recoveryCodes };
}

describe('sessão', () => {
  it('importa a planilha, guarda cifrado e reabre igual', async () => {
    const { db, session } = await novo();
    await session.importCatalog(await catalogo(), 'ficha.xlsx');
    expect(session.catalogo.pizzas).toHaveLength(4);
    expect(session.pizza('PZ001')!.M.comida).toBeCloseTo(8.1875);
    expect(JSON.stringify(await db.allBatches())).not.toContain('Mussarela');
    session.lock();
    const again = (await Session.unlock(db, PASSWORD, 'senha'))!;
    expect(again.catalogo.pizzas.map((p) => p.nome)).toEqual(['Mussarela', 'Calabresa', 'Sem Receita', 'Antiga']);
    expect(again.state.imports[0]!.fileName).toBe('ficha.xlsx');
    expect(again.chainProblems).toEqual([]);
  });

  it('compra nova troca o preço do insumo e refaz o CMV; compra antiga não volta o preço atrás', async () => {
    const { session } = await novo();
    await session.importCatalog(await catalogo(), 'ficha.xlsx');
    await session.addCompra({ id: 'c1', data: '2026-11-10', insumo: 'IB001', precoPago: 50, qtd: 1 });
    expect(session.catalogo.insumos.find((i) => i.id === 'IB001')).toMatchObject({ precoPago: 50, atualizadoEm: '2026-11-10' });
    expect(session.pizza('PZ001')!.M.comida).toBeCloseTo(8.1875 + 0.15 * 10);
    await session.addCompra({ id: 'c2', data: '2026-08-01', insumo: 'IB001', precoPago: 30, qtd: 1 });
    expect(session.catalogo.insumos.find((i) => i.id === 'IB001')!.precoPago).toBe(50);
    expect(session.catalogo.compras).toHaveLength(4);
  });

  it('reimportar troca o cadastro e mantém compras e vendas lançadas no app', async () => {
    const { session } = await novo();
    const cat = await catalogo();
    await session.importCatalog(cat, 'a.xlsx');
    await session.addCompra({ id: 'c1', data: '2026-11-10', insumo: 'IB001', precoPago: 50, qtd: 1 });
    await session.setVendas('2026-11', [{ periodo: '2026-11', pizza: 'PZ001', tamanho: 'M', canal: 'salao', qtd: 10 }]);
    await session.importCatalog(cat, 'b.xlsx');
    expect(session.catalogo.compras).toHaveLength(3);
    expect(session.catalogo.vendas.filter((v) => v.periodo === '2026-11')).toHaveLength(1);
    expect(session.catalogo.vendas).toHaveLength(4);
  });

  it('não apaga insumo que ainda está numa ficha', async () => {
    const { session } = await novo();
    await session.importCatalog(await catalogo(), 'a.xlsx');
    await expect(session.removeInsumo('IB001')).rejects.toThrow(/Mussarela/);
    await session.removeInsumo('IB008');
    expect(session.catalogo.insumos.some((i) => i.id === 'IB008')).toBe(false);
  });

  it('vendas do mês substituem as anteriores do mesmo mês', async () => {
    const { session } = await novo();
    await session.importCatalog(await catalogo(), 'a.xlsx');
    await session.setVendas('2026-10', [{ periodo: '2026-10', pizza: 'PZ001', tamanho: 'M', canal: 'salao', qtd: 5 }]);
    expect(session.engenharia('2026-10').qtdTotal).toBe(5);
    expect(session.periodosComVenda()).toEqual(['2026-10']);
  });

  it('cópia de segurança restaura em outro aparelho', async () => {
    const { session } = await novo();
    await session.importCatalog(await catalogo(), 'a.xlsx');
    const backup = await session.exportBackup(PASSWORD);
    const db2 = await LocalDb.open(`r-${Math.random()}`);
    const s2 = (await restoreBackup(db2, backup, PASSWORD, 'senha'))!;
    expect(s2.catalogo.insumos).toHaveLength(8);
    await expect(session.exportBackup('senha errada demais')).rejects.toThrow();
  });
});

describe('sincronização com o Drive', () => {
  it('leva as fichas de um aparelho para outro e de volta, sem nada em claro', async () => {
    const drive = new MemoryDrive();
    const { session: a, recoveryCodes } = await novo();
    await a.importCatalog(await catalogo(), 'a.xlsx');
    expect((await a.sync(drive, EMAIL)).uploaded).toBeGreaterThan(0);
    for (const f of drive.files.values()) expect(f.content).not.toContain('Mussarela');

    const dbB = await LocalDb.open(`b-${Math.random()}`);
    expect(await pullVault(dbB, drive, EMAIL)).toBe(true);
    const b = (await Session.unlock(dbB, recoveryCodes[0], 'recuperacao'))!;
    expect(b.catalogo.pizzas).toHaveLength(4);

    const p = b.catalogo.pizzas[0]!;
    await b.savePizza({ ...p, precos: { ...p.precos, salao: { M: 59, G: 79 } } });
    await b.sync(drive, EMAIL);
    const r = await a.sync(drive, EMAIL);
    expect(r.downloaded.length).toBeGreaterThan(0);
    expect(a.catalogo.pizzas[0]!.precos.salao).toEqual({ M: 59, G: 79 });
    expect(a.chainProblems).toEqual([]);
  });
});
