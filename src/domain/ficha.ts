/**
 * Ficha técnica, CMV e preço: as mesmas contas da planilha "Fichas_Tecnicas_CMV", em código.
 *
 * Valores em reais (number, sem arredondar: a ficha tem custos de frações de centavo, como
 * R$ 0,0045 de sal). Só a tela arredonda. Quantidades na unidade base do insumo (kg, L ou un).
 */
import type { IsoDate } from './date';

export type Unidade = 'kg' | 'L' | 'un';
export type Etapa = 'Antes' | 'Depois' | 'Embalagem';
export type Tamanho = 'M' | 'G';

export const UNIDADES: readonly Unidade[] = ['kg', 'L', 'un'];
export const ETAPAS: readonly Etapa[] = ['Antes', 'Depois', 'Embalagem'];
export const TAMANHOS: readonly Tamanho[] = ['M', 'G'];
export const TAMANHO_NOME: Record<Tamanho, string> = { M: 'Médio', G: 'Grande' };
export const ETAPA_NOME: Record<Etapa, string> = { Antes: 'Antes do forno', Depois: 'Depois do forno', Embalagem: 'Embalagem' };

/** Insumo comprado (bruto). */
export interface Insumo {
  id: string;
  nome: string;
  categoria: string;
  unidade: Unidade;
  /** Preço pago na compra (R$). `null` = ainda sem preço. */
  precoPago: number | null;
  /** Quanto veio na compra, na unidade base (ex.: caixa com 50 embalagens = 50). */
  qtdComprada: number;
  /** Perda na limpeza ou no preparo, de 0 a 1. */
  perda: number;
  atualizadoEm?: IsoDate;
  fornecedor?: string;
}

/** Ingrediente de um preparo: um insumo ou outro preparo. */
export interface ItemPreparo {
  ref: string;
  qtd: number;
}

/** Preparo feito na cozinha (massa, molho, pesto). Entra nas pizzas como se fosse um insumo. */
export interface Preparo {
  id: string;
  nome: string;
  unidade: Unidade;
  /** Perda de produção (evaporação, sobra), de 0 a 1. */
  perda: number;
  itens: ItemPreparo[];
  obs?: string;
}

/** Uma linha da receita da pizza. */
export interface LinhaPizza {
  id: string;
  etapa: Etapa;
  /** Insumo ou preparo. */
  ref: string;
  /** Quantidade no Médio e no Grande. `null` = não preenchida. */
  qtdM: number | null;
  qtdG: number | null;
  /** Outro item no Grande (ex.: Embalagem 35cm no lugar da de 30cm). */
  refG?: string;
}

export interface PrecoTamanho {
  M?: number | null;
  G?: number | null;
}

export interface Pizza {
  id: string;
  nome: string;
  categoria: string;
  ativa: boolean;
  /** Preço de venda por canal e tamanho. Vazio = não vende ali. */
  precos: Record<string, PrecoTamanho>;
  linhas: LinhaPizza[];
  obs?: string;
}

export interface Canal {
  id: string;
  nome: string;
  /** Delivery leva embalagem no CMV; no salão a pizza vai na mesa. */
  usaEmbalagem: boolean;
  /** Percentuais sobre o preço, de 0 a 1. */
  comissao: number;
  taxaPagamento: number;
  desconto: number;
  /** Valores por pedido (R$). */
  taxaFixaPedido: number;
  custosExtrasPedido: number;
  /** Margem que o preço sugerido busca, de 0 a 1. */
  margemAlvo: number;
}

export interface Config {
  /** Impostos sobre a venda (ex.: alíquota do Simples), de 0 a 1. */
  impostos: number;
  /** CMV % máximo desejado, de 0 a 1. */
  cmvMaximo: number;
  /** Preço de insumo fica desatualizado depois de tantos dias. */
  diasDesatualizado: number;
}

/** Uma compra lançada: vira histórico de preço do insumo. */
export interface Compra {
  id: string;
  data: IsoDate;
  insumo: string;
  precoPago: number;
  qtd: number;
  fornecedor?: string;
}

/** Quantidade vendida de uma pizza, num tamanho e canal, num período (AAAA-MM). */
export interface Venda {
  periodo: string;
  pizza: string;
  tamanho: Tamanho;
  canal: string;
  qtd: number;
}

export interface Catalogo {
  insumos: Insumo[];
  preparos: Preparo[];
  pizzas: Pizza[];
  canais: Canal[];
  config: Config;
  compras: Compra[];
  vendas: Venda[];
}

export const CONFIG_PADRAO: Config = { impostos: 0, cmvMaximo: 0.35, diasDesatualizado: 90 };

export const CANAIS_PADRAO: Canal[] = [
  { id: 'salao', nome: 'Salão', usaEmbalagem: false, comissao: 0, taxaPagamento: 0, desconto: 0, taxaFixaPedido: 0, custosExtrasPedido: 0, margemAlvo: 0.65 },
  { id: 'ifood', nome: 'iFood', usaEmbalagem: true, comissao: 0.25, taxaPagamento: 0, desconto: 0, taxaFixaPedido: 0, custosExtrasPedido: 0, margemAlvo: 0.25 },
  { id: '99food', nome: '99Food', usaEmbalagem: true, comissao: 0.2, taxaPagamento: 0, desconto: 0, taxaFixaPedido: 0, custosExtrasPedido: 0, margemAlvo: 0.4 },
];

export function catalogoVazio(): Catalogo {
  return { insumos: [], preparos: [], pizzas: [], canais: CANAIS_PADRAO.map((c) => ({ ...c })), config: { ...CONFIG_PADRAO }, compras: [], vendas: [] };
}

// ----- custos -----

/** Custo de uma unidade base do insumo, já com a perda: preço ÷ quantidade ÷ (1 − perda). */
export function custoInsumo(i: Insumo): number {
  if (i.precoPago === null || !(i.qtdComprada > 0)) return 0;
  const util = 1 - clampPerda(i.perda);
  return i.precoPago / i.qtdComprada / util;
}

const clampPerda = (p: number) => (Number.isFinite(p) ? Math.min(Math.max(p, 0), 0.99) : 0);

/** Índices para achar insumo e preparo pelo id, e custos já calculados. */
export class Custos {
  readonly insumos = new Map<string, Insumo>();
  readonly preparos = new Map<string, Preparo>();
  private cache = new Map<string, number>();

  constructor(cat: Pick<Catalogo, 'insumos' | 'preparos'>) {
    for (const i of cat.insumos) this.insumos.set(i.id, i);
    for (const p of cat.preparos) this.preparos.set(p.id, p);
  }

  existe(ref: string): boolean {
    return this.insumos.has(ref) || this.preparos.has(ref);
  }

  nome(ref: string): string {
    return this.insumos.get(ref)?.nome ?? this.preparos.get(ref)?.nome ?? 'Item apagado';
  }

  unidade(ref: string): Unidade {
    return this.insumos.get(ref)?.unidade ?? this.preparos.get(ref)?.unidade ?? 'un';
  }

  tipo(ref: string): 'Bruto' | 'Preparo' | null {
    return this.insumos.has(ref) ? 'Bruto' : this.preparos.has(ref) ? 'Preparo' : null;
  }

  /** Custo por unidade base de um insumo ou preparo. Item que não existe custa 0 (e vira pendência). */
  unitario(ref: string, visitando: Set<string> = new Set()): number {
    const hit = this.cache.get(ref);
    if (hit !== undefined) return hit;
    const ins = this.insumos.get(ref);
    if (ins) return this.guarda(ref, custoInsumo(ins));
    const prep = this.preparos.get(ref);
    if (!prep || visitando.has(ref)) return 0; // preparo dentro dele mesmo: não conta duas vezes
    visitando.add(ref);
    const r = this.resumoPreparo(prep, visitando);
    visitando.delete(ref);
    return this.guarda(ref, r.custoUnidade);
  }

  private guarda(ref: string, v: number) {
    this.cache.set(ref, v);
    return v;
  }

  /** Rendimento bruto = soma das quantidades da receita; o líquido desconta a perda de produção. */
  resumoPreparo(p: Preparo, visitando: Set<string> = new Set([p.id])) {
    let custoTotal = 0;
    let bruto = 0;
    const linhas = p.itens.map((it) => {
      const unit = this.unitario(it.ref, visitando);
      const custo = unit * it.qtd;
      custoTotal += custo;
      bruto += it.qtd;
      return { ...it, unit, custo };
    });
    const liquido = bruto * (1 - clampPerda(p.perda));
    return { linhas, custoTotal, bruto, liquido, custoUnidade: liquido > 0 ? custoTotal / liquido : 0 };
  }
}

/** Linha da receita resolvida para um tamanho: qual item, quanto e quanto custa. */
export interface LinhaCalculada {
  linha: LinhaPizza;
  ref: string;
  qtd: number | null;
  unit: number;
  custo: number;
}

export interface FichaTamanho {
  tamanho: Tamanho;
  linhas: LinhaCalculada[];
  /** CMV só da comida (sem embalagem). */
  comida: number;
  embalagem: number;
  /** Peso dos ingredientes de comida em kg/L (para conferir se o Grande pesa mais). */
  peso: number;
  /** Alguma linha sem quantidade nesse tamanho. */
  faltaQtd: boolean;
}

export function fichaTamanho(p: Pizza, t: Tamanho, c: Custos): FichaTamanho {
  let comida = 0;
  let embalagem = 0;
  let peso = 0;
  let faltaQtd = false;
  const linhas = p.linhas.map((l) => {
    const ref = t === 'G' && l.refG ? l.refG : l.ref;
    const qtd = t === 'M' ? l.qtdM : l.qtdG;
    if (qtd === null || !Number.isFinite(qtd)) faltaQtd = true;
    const unit = c.unitario(ref);
    const custo = (qtd ?? 0) * unit;
    if (l.etapa === 'Embalagem') embalagem += custo;
    else {
      comida += custo;
      if (c.unidade(ref) !== 'un') peso += qtd ?? 0;
    }
    return { linha: l, ref, qtd, unit, custo };
  });
  return { tamanho: t, linhas, comida, embalagem, peso, faltaQtd };
}

export function precoDe(p: Pizza, canal: string, t: Tamanho): number | null {
  const v = p.precos[canal]?.[t];
  return typeof v === 'number' && v > 0 ? v : null;
}

/** A pizza é vendida nesse tamanho em algum canal? */
export function vendeTamanho(p: Pizza, t: Tamanho): boolean {
  return Object.keys(p.precos).some((c) => precoDe(p, c, t) !== null);
}

/** Percentuais que saem do preço em um canal: comissão, taxa de pagamento, impostos e desconto. */
export function variaveis(canal: Canal, config: Config): number {
  return canal.comissao + canal.taxaPagamento + config.impostos + canal.desconto;
}

export function fixosPedido(canal: Canal): number {
  return canal.taxaFixaPedido + canal.custosExtrasPedido;
}

/** Preço sugerido = (CMV + custos por pedido) ÷ (1 − % variáveis − margem-alvo). */
export function precoSugerido(cmv: number, canal: Canal, config: Config): number | null {
  const div = 1 - variaveis(canal, config) - canal.margemAlvo;
  if (div <= 0) return null; // meta impossível: os percentuais somam 100% ou mais
  return (cmv + fixosPedido(canal)) / div;
}

export interface Resultado {
  canal: Canal;
  tamanho: Tamanho;
  preco: number | null;
  cmv: number;
  comissao: number;
  taxaPagamento: number;
  impostos: number;
  desconto: number;
  fixos: number;
  margem: number | null;
  margemPct: number | null;
  cmvPct: number | null;
  sugerido: number | null;
}

/** Resultado de uma pizza (já calculada) num canal e tamanho. */
export function resultado(f: FichaTamanho, preco: number | null, canal: Canal, config: Config): Resultado {
  const cmv = f.comida + (canal.usaEmbalagem ? f.embalagem : 0);
  const base = { canal, tamanho: f.tamanho, cmv, sugerido: precoSugerido(cmv, canal, config), fixos: fixosPedido(canal) };
  if (preco === null) return { ...base, preco, comissao: 0, taxaPagamento: 0, impostos: 0, desconto: 0, margem: null, margemPct: null, cmvPct: null };
  const comissao = preco * canal.comissao;
  const taxaPagamento = preco * canal.taxaPagamento;
  const impostos = preco * config.impostos;
  const desconto = preco * canal.desconto;
  const margem = preco - cmv - comissao - taxaPagamento - impostos - desconto - base.fixos;
  return { ...base, preco, comissao, taxaPagamento, impostos, desconto, margem, margemPct: margem / preco, cmvPct: cmv / preco };
}

/** Tudo de uma pizza: as duas fichas e o resultado em cada canal e tamanho. */
export interface PizzaCalculada {
  pizza: Pizza;
  M: FichaTamanho;
  G: FichaTamanho;
  resultados: Resultado[];
}

export function calcularPizza(p: Pizza, cat: Pick<Catalogo, 'canais' | 'config'>, c: Custos): PizzaCalculada {
  const M = fichaTamanho(p, 'M', c);
  const G = fichaTamanho(p, 'G', c);
  const resultados: Resultado[] = [];
  for (const canal of cat.canais) for (const f of [M, G]) resultados.push(resultado(f, precoDe(p, canal.id, f.tamanho), canal, cat.config));
  return { pizza: p, M, G, resultados };
}

// ----- meio a meio -----

export type RegraMeio = 'maior' | 'media';

export interface MeioAMeio {
  preco: number | null;
  comida: number;
  embalagem: number;
  cmv: number;
  descontos: number;
  fixos: number;
  margem: number | null;
  margemPct: number | null;
  cmvPct: number | null;
  /** Um dos sabores não é vendido nesse canal e tamanho. */
  faltaPreco: boolean;
}

/** CMV = média da comida dos dois sabores + embalagem (só no delivery). Preço pela regra escolhida. */
export function meioAMeio(a: PizzaCalculada, b: PizzaCalculada, t: Tamanho, canal: Canal, config: Config, regra: RegraMeio): MeioAMeio {
  const fa = a[t];
  const fb = b[t];
  const comida = (fa.comida + fb.comida) / 2;
  const embalagem = canal.usaEmbalagem ? Math.max(fa.embalagem, fb.embalagem) : 0;
  const cmv = comida + embalagem;
  const pa = precoDe(a.pizza, canal.id, t);
  const pb = precoDe(b.pizza, canal.id, t);
  const fixos = fixosPedido(canal);
  if (pa === null || pb === null) return { preco: null, comida, embalagem, cmv, descontos: 0, fixos, margem: null, margemPct: null, cmvPct: null, faltaPreco: true };
  const preco = regra === 'maior' ? Math.max(pa, pb) : (pa + pb) / 2;
  const descontos = preco * variaveis(canal, config);
  const margem = preco - cmv - descontos - fixos;
  return { preco, comida, embalagem, cmv, descontos, fixos, margem, margemPct: margem / preco, cmvPct: cmv / preco, faltaPreco: false };
}

// ----- engenharia de cardápio -----

export type Classe = 'Estrela' | 'Burro de carga' | 'Quebra-cabeça' | 'Cão';

export const CLASSE_DICA: Record<Classe, string> = {
  Estrela: 'Vende muito e dá boa margem. Mantenha e destaque no cardápio.',
  'Burro de carga': 'Vende muito, mas a margem é baixa. Reveja o custo ou suba um pouco o preço.',
  'Quebra-cabeça': 'Dá boa margem, mas vende pouco. Divulgue, mude a foto ou a posição no cardápio.',
  Cão: 'Vende pouco e dá pouca margem. Pense em tirar ou refazer a receita.',
};

export interface LinhaEngenharia {
  pizza: Pizza;
  qtd: number;
  faturamento: number;
  cmvTotal: number;
  margemTotal: number;
  margemUnit: number;
  mix: number;
  classe: Classe;
}

export interface Engenharia {
  linhas: LinhaEngenharia[];
  qtdTotal: number;
  faturamento: number;
  cmvTotal: number;
  margemTotal: number;
  /** Corte de popularidade: 70% da participação média (1 ÷ número de pizzas). */
  corteMix: number;
  /** Corte de margem: margem média ponderada pelas vendas. */
  corteMargem: number;
}

/**
 * Engenharia de cardápio clássica (Kasavana e Smith): popularidade pela participação nas vendas
 * (alta se ≥ 70% da média) e lucratividade pela margem de contribuição unitária (alta se ≥ média ponderada).
 * Margem de cada venda = a do canal e tamanho em que foi vendida.
 */
export function engenharia(vendas: Venda[], calc: Map<string, PizzaCalculada>): Engenharia {
  const por = new Map<string, { qtd: number; fat: number; cmv: number; margem: number }>();
  for (const v of vendas) {
    const pc = calc.get(v.pizza);
    if (!pc || !(v.qtd > 0)) continue;
    const r = pc.resultados.find((x) => x.canal.id === v.canal && x.tamanho === v.tamanho);
    if (!r) continue;
    const acc = por.get(v.pizza) ?? { qtd: 0, fat: 0, cmv: 0, margem: 0 };
    acc.qtd += v.qtd;
    acc.fat += (r.preco ?? 0) * v.qtd;
    acc.cmv += r.cmv * v.qtd;
    acc.margem += (r.margem ?? -r.cmv) * v.qtd;
    por.set(v.pizza, acc);
  }
  const qtdTotal = [...por.values()].reduce((s, x) => s + x.qtd, 0);
  const margemTotal = [...por.values()].reduce((s, x) => s + x.margem, 0);
  const n = por.size;
  const corteMix = n ? 0.7 / n : 0;
  const corteMargem = qtdTotal ? margemTotal / qtdTotal : 0;
  const linhas: LinhaEngenharia[] = [...por.entries()].map(([id, x]) => {
    const mix = qtdTotal ? x.qtd / qtdTotal : 0;
    const margemUnit = x.qtd ? x.margem / x.qtd : 0;
    const popular = mix >= corteMix;
    const lucrativa = margemUnit >= corteMargem;
    const classe: Classe = popular ? (lucrativa ? 'Estrela' : 'Burro de carga') : lucrativa ? 'Quebra-cabeça' : 'Cão';
    return { pizza: calc.get(id)!.pizza, qtd: x.qtd, faturamento: x.fat, cmvTotal: x.cmv, margemTotal: x.margem, margemUnit, mix, classe };
  });
  linhas.sort((a, b) => b.margemTotal - a.margemTotal);
  return {
    linhas, qtdTotal, margemTotal, corteMix, corteMargem,
    faturamento: linhas.reduce((s, l) => s + l.faturamento, 0),
    cmvTotal: linhas.reduce((s, l) => s + l.cmvTotal, 0),
  };
}

// ----- pendências -----

export type Gravidade = 'falta' | 'alerta';

export interface Pendencia {
  id: string;
  onde: 'pizza' | 'insumo' | 'preparo';
  alvo: string;
  item: string;
  problema: string;
  oQueFazer: string;
  gravidade: Gravidade;
}

/**
 * Lista automática do que precisa de atenção. As mesmas regras da aba Pendências da planilha,
 * mais os alertas de margem: margem abaixo da meta e CMV acima do máximo.
 */
export function pendencias(cat: Catalogo, hoje: IsoDate, c = new Custos(cat)): Pendencia[] {
  const out: Pendencia[] = [];
  const add = (p: Omit<Pendencia, 'id'>) => out.push({ ...p, id: `${p.onde}:${p.alvo}:${p.problema}` });
  for (const p of cat.pizzas) {
    if (!p.ativa) continue;
    const pc = calcularPizza(p, cat, c);
    const vendeM = vendeTamanho(p, 'M');
    const vendeG = vendeTamanho(p, 'G');
    const base = { onde: 'pizza' as const, alvo: p.id, item: p.nome };
    if (p.linhas.length === 0) add({ ...base, problema: 'Sem receita', oQueFazer: 'Lançar os ingredientes e as quantidades na ficha.', gravidade: 'falta' });
    if (!vendeM && !vendeG) add({ ...base, problema: 'Sem preço em nenhum canal', oQueFazer: 'Informar o preço onde ela é vendida.', gravidade: 'falta' });
    if (p.linhas.length) {
      if (vendeM && pc.M.faltaQtd) add({ ...base, problema: 'Falta quantidade do Médio', oQueFazer: 'Completar as quantidades do Médio na ficha.', gravidade: 'falta' });
      if (vendeG && pc.G.faltaQtd) add({ ...base, problema: 'Falta quantidade do Grande', oQueFazer: 'Completar as quantidades do Grande na ficha.', gravidade: 'falta' });
      if (vendeM && vendeG && !pc.G.faltaQtd && !pc.M.faltaQtd && pc.G.peso <= pc.M.peso) add({ ...base, problema: 'Grande não pesa mais que o Médio', oQueFazer: 'Conferir as quantidades do Grande.', gravidade: 'falta' });
      for (const l of p.linhas) {
        for (const ref of [l.ref, l.refG].filter((x): x is string => !!x)) {
          if (!c.existe(ref)) add({ ...base, problema: 'Ingrediente que não existe mais', oQueFazer: 'Trocar ou tirar a linha da ficha.', gravidade: 'falta' });
        }
      }
    }
    const iguais = cat.canais.filter((k) => {
      const m = precoDe(p, k.id, 'M');
      const g = precoDe(p, k.id, 'G');
      return m !== null && g !== null && Math.abs(m - g) < 0.005;
    });
    if (iguais.length) add({ ...base, problema: 'Preço do Médio igual ao do Grande', oQueFazer: `Conferir o preço em ${iguais.map((k) => k.nome).join(', ')}.`, gravidade: 'falta' });
    if (p.linhas.length && !pc.M.faltaQtd) {
      for (const r of pc.resultados) {
        if (r.preco === null || r.margemPct === null) continue;
        if (r.tamanho === 'G' && pc.G.faltaQtd) continue;
        const onde = `${r.canal.nome}, ${TAMANHO_NOME[r.tamanho]}`;
        if (r.margem !== null && r.margem < 0) add({ ...base, problema: `Margem negativa (${onde})`, oQueFazer: 'Subir o preço ou rever a ficha.', gravidade: 'alerta' });
        else if (r.margemPct < r.canal.margemAlvo) add({ ...base, problema: `Margem abaixo da meta (${onde})`, oQueFazer: `Preço sugerido para a meta: ${fmt(r.sugerido)}.`, gravidade: 'alerta' });
        if (r.cmvPct !== null && r.cmvPct > cat.config.cmvMaximo) add({ ...base, problema: `CMV acima do máximo (${onde})`, oQueFazer: 'Rever as quantidades ou o preço.', gravidade: 'alerta' });
      }
    }
  }
  const usados = new Set<string>();
  for (const p of cat.pizzas) for (const l of p.linhas) { usados.add(l.ref); if (l.refG) usados.add(l.refG); }
  for (const p of cat.preparos) for (const it of p.itens) usados.add(it.ref);
  for (const i of cat.insumos) {
    const base = { onde: 'insumo' as const, alvo: i.id, item: i.nome };
    if (i.precoPago === null) add({ ...base, problema: 'Sem preço', oQueFazer: 'Informar o preço pago.', gravidade: usados.has(i.id) ? 'falta' : 'alerta' });
    if (!usados.has(i.id)) continue;
    if (!i.atualizadoEm) add({ ...base, problema: 'Sem data da última compra', oQueFazer: 'Conferir o preço com o fornecedor e lançar a compra.', gravidade: 'alerta' });
    else if (diasEntre(i.atualizadoEm, hoje) > cat.config.diasDesatualizado) add({ ...base, problema: `Preço com mais de ${cat.config.diasDesatualizado} dias`, oQueFazer: 'Conferir o preço com o fornecedor e lançar a compra.', gravidade: 'alerta' });
  }
  for (const p of cat.preparos) {
    const base = { onde: 'preparo' as const, alvo: p.id, item: p.nome };
    if (p.itens.length === 0) add({ ...base, problema: 'Sem receita', oQueFazer: 'Lançar os ingredientes do preparo.', gravidade: 'falta' });
    if (p.itens.some((it) => !c.existe(it.ref))) add({ ...base, problema: 'Ingrediente que não existe mais', oQueFazer: 'Trocar ou tirar a linha do preparo.', gravidade: 'falta' });
  }
  // Uma pendência por problema e item (o mesmo ingrediente sumido em duas linhas conta uma vez).
  return [...new Map(out.map((p) => [p.id, p])).values()];
}

function diasEntre(a: IsoDate, b: IsoDate): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
/** Reais com 2 casas; `null` vira travessão. */
export function fmt(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : BRL.format(v);
}

/** Próximo id livre com prefixo (PZ014, IB030...). */
export function proximoId(prefixo: string, existentes: Iterable<string>): string {
  let max = 0;
  for (const id of existentes) {
    const m = new RegExp(`^${prefixo}(\\d+)$`).exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefixo}${String(max + 1).padStart(3, '0')}`;
}
