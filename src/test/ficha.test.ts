import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readXlsxSheets } from '../import/xlsx';
import { lerPlanilha, num } from '../import/planilha';
import { Custos, calcularPizza, catalogoVazio, custoInsumo, engenharia, meioAMeio, pendencias, precoSugerido, type Catalogo } from '../domain/ficha';

async function exemplo(): Promise<{ cat: Catalogo; avisos: string[] }> {
  const buf = readFileSync(new URL('../../e2e/fixtures/ficha-exemplo.xlsx', import.meta.url));
  const { catalogo, avisos } = lerPlanilha(await readXlsxSheets(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
  return { cat: catalogo, avisos };
}

describe('leitura da planilha', () => {
  it('traz insumos, preparos, pizzas, canais, compras e vendas pelos títulos das colunas', async () => {
    const { cat, avisos } = await exemplo();
    expect(cat.insumos.map((i) => i.id)).toEqual(['IB001', 'IB002', 'IB003', 'IB004', 'IB005', 'IB006', 'IB007', 'IB008']);
    expect(cat.insumos.find((i) => i.id === 'IB008')!.precoPago).toBeNull(); // vazio na planilha
    expect(cat.insumos.find((i) => i.id === 'IB007')!.precoPago).toBe(0); // água: zero de propósito
    expect(cat.insumos.find((i) => i.id === 'IB004')!.perda).toBe(0.2);
    expect(cat.preparos.map((p) => [p.nome, p.itens.length])).toEqual([['Massa', 2], ['Molho', 1]]); // Molho achado pelo nome
    expect(cat.pizzas).toHaveLength(4);
    expect(cat.pizzas[3]!.ativa).toBe(false);
    expect(cat.pizzas[0]!.precos).toEqual({ salao: { M: 50, G: 70 }, ifood: { M: 55, G: 75 }, '99food': { M: 52, G: 72 } });
    expect(cat.pizzas[0]!.linhas[3]).toMatchObject({ etapa: 'Embalagem', ref: 'IB005', refG: 'IB006', qtdM: 1, qtdG: 1 });
    expect(cat.pizzas[1]!.linhas[0]!.qtdG).toBeNull();
    expect(cat.canais.map((k) => [k.id, k.usaEmbalagem, k.comissao, k.margemAlvo])).toEqual([['salao', false, 0, 0.65], ['ifood', true, 0.25, 0.25], ['99food', true, 0.2, 0.4]]);
    expect(cat.config).toEqual({ impostos: 0.04, cmvMaximo: 0.35, diasDesatualizado: 90 });
    expect(cat.compras.map((c) => [c.data, c.precoPago])).toEqual([['2026-09-01', 36], ['2026-10-01', 40]]);
    expect(cat.vendas).toHaveLength(3);
    expect(avisos.some((a) => a.includes('Cebola Roxa'))).toBe(true);
  });

  it('lê números do Excel e digitados à mão', () => {
    expect(num('0.005')).toBe(0.005);
    expect(num('0,35')).toBe(0.35);
    expect(num('1.234,50')).toBe(1234.5);
    expect(num('R$ 3,50')).toBe(3.5);
    expect(num('25%')).toBe(0.25);
    expect(num('')).toBeNull();
    expect(num('abc')).toBeNull();
  });

  it('recusa um arquivo que não é a ficha técnica', () => {
    expect(() => lerPlanilha(new Map([['Plan1', [['a', 'b']]]]))).toThrow(/Insumos_Brutos/);
  });
});

describe('custos e preços', () => {
  it('calcula custo do insumo com perda e do preparo com rendimento', async () => {
    const { cat } = await exemplo();
    const c = new Custos(cat);
    expect(custoInsumo(cat.insumos[1]!)).toBe(5); // R$ 25 por 5 kg
    expect(c.unitario('IB004')).toBeCloseTo(62.5); // R$ 50 ÷ (1 − 20%)
    expect(c.unitario('PR001')).toBeCloseTo(3.125); // R$ 5 ÷ 1,6 kg
    expect(c.unitario('PR002')).toBeCloseTo(12.5); // R$ 10 ÷ (1 kg − 20%)
  });

  it('monta o CMV por tamanho, com troca de embalagem no Grande, e o resultado por canal', async () => {
    const { cat } = await exemplo();
    const pc = calcularPizza(cat.pizzas[0]!, cat, new Custos(cat));
    expect(pc.M.comida).toBeCloseTo(8.1875);
    expect(pc.G.comida).toBeCloseTo(11.125);
    expect(pc.M.embalagem).toBe(2);
    expect(pc.G.embalagem).toBe(3);
    const salaoM = pc.resultados.find((r) => r.canal.id === 'salao' && r.tamanho === 'M')!;
    expect(salaoM.cmv).toBeCloseTo(8.1875); // salão sem embalagem
    expect(salaoM.margem).toBeCloseTo(50 - 8.1875 - 2); // 4% de imposto
    expect(salaoM.sugerido).toBeCloseTo(8.1875 / (1 - 0.04 - 0.65));
    const ifoodM = pc.resultados.find((r) => r.canal.id === 'ifood' && r.tamanho === 'M')!;
    expect(ifoodM.cmv).toBeCloseTo(10.1875);
    expect(ifoodM.margem).toBeCloseTo(55 - 10.1875 - 13.75 - 2.2);
  });

  it('preço sugerido soma os custos por pedido e recusa meta impossível', () => {
    const k = { ...catalogoVazio().canais[1]!, taxaFixaPedido: 1, custosExtrasPedido: 0.5 };
    expect(precoSugerido(10, k, { impostos: 0, cmvMaximo: 0.35, diasDesatualizado: 90 })).toBeCloseTo(11.5 / 0.5);
    expect(precoSugerido(10, { ...k, margemAlvo: 0.8 }, { impostos: 0, cmvMaximo: 0.35, diasDesatualizado: 90 })).toBeNull();
  });

  it('meio a meio: média da comida, embalagem só no delivery e preço pela regra', async () => {
    const { cat } = await exemplo();
    const c = new Custos(cat);
    const a = calcularPizza(cat.pizzas[0]!, cat, c);
    const b = calcularPizza(cat.pizzas[1]!, cat, c);
    const ifood = cat.canais[1]!;
    const r = meioAMeio(a, b, 'M', ifood, cat.config, 'maior');
    expect(r.comida).toBeCloseTo((8.1875 + 7.1875) / 2);
    expect(r.embalagem).toBe(2);
    expect(r.preco).toBe(60);
    expect(meioAMeio(a, b, 'M', ifood, cat.config, 'media').preco).toBe(57.5);
    expect(meioAMeio(a, b, 'M', cat.canais[0]!, cat.config, 'maior').embalagem).toBe(0);
    expect(meioAMeio(a, b, 'G', ifood, cat.config, 'maior').faltaPreco).toBe(true);
  });
});

describe('pendências', () => {
  it('acha receita faltando, Grande sem quantidade, preço igual e insumo sem preço', async () => {
    const { cat } = await exemplo();
    const ps = pendencias(cat, '2026-11-12');
    const de = (item: string) => ps.filter((p) => p.item === item).map((p) => p.problema);
    expect(de('Sem Receita')).toContain('Sem receita');
    expect(de('Calabresa')).toEqual(expect.arrayContaining(['Falta quantidade do Grande', 'Preço do Médio igual ao do Grande']));
    expect(de('Antiga')).toEqual([]); // inativa não conta
    expect(de('Manjericão')).toEqual(['Sem preço']);
    expect(de('Água')).not.toContain('Sem preço');
    expect(de('Queijo Mussarela')).toContain('Sem data da última compra');
  });

  it('avisa o Grande que não pesa mais que o Médio', async () => {
    const { cat } = await exemplo();
    const p = cat.pizzas[0]!;
    cat.pizzas[0] = { ...p, linhas: p.linhas.map((l) => ({ ...l, qtdG: l.qtdM })) };
    expect(pendencias(cat, '2026-11-12').some((x) => x.item === 'Mussarela' && x.problema === 'Grande não pesa mais que o Médio')).toBe(true);
  });
});

describe('engenharia de cardápio', () => {
  it('classifica pela participação nas vendas e pela margem de cada canal', async () => {
    const { cat } = await exemplo();
    const c = new Custos(cat);
    const calc = new Map(cat.pizzas.map((p) => [p.id, calcularPizza(p, cat, c)]));
    const e = engenharia(cat.vendas, calc);
    expect(e.qtdTotal).toBe(190);
    expect(e.linhas.find((l) => l.pizza.nome === 'Mussarela')!.classe).toBe('Estrela');
    expect(e.linhas.find((l) => l.pizza.nome === 'Calabresa')!.classe).toBe('Cão');
    expect(e.margemTotal).toBeCloseTo(120 * 39.8125 + 40 * 39.125 + 30 * 35.4125);
  });
});
