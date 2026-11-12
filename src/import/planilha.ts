/**
 * Lê a planilha "Fichas_Tecnicas_CMV" (baixada do Google Planilhas como .xlsx) e monta o catálogo.
 *
 * Acha cada coluna pelo título (não pela posição), então colunas novas ou trocadas de lugar não
 * atrapalham. Usa só os valores digitados (preço, quantidade, perda); os custos são recalculados
 * pelo app. Abas que faltam ficam vazias ou com o padrão.
 */
import { parseDate } from '../domain/date';
import {
  CANAIS_PADRAO, CONFIG_PADRAO,
  type Canal, type Catalogo, type Compra, type Config, type Etapa, type Insumo, type LinhaPizza, type Pizza, type Preparo, type Tamanho, type Unidade, type Venda,
} from '../domain/ficha';

export type Abas = Map<string, string[][]>;

export interface Importacao {
  catalogo: Catalogo;
  /** O que não deu para trazer, em palavras (ingrediente com nome desconhecido, por exemplo). */
  avisos: string[];
}

/** Minúsculas, sem acento e com espaços simples: "Preço Pago\n(R$)" → "preco pago (r$)". */
export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const slug = (s: string) => norm(s).replace(/[^a-z0-9]+/g, '');

/** Número cru da planilha ("0.35", "12,5", "R$ 3,50", "25%"). Vazio vira `null`. */
export function num(s: string | undefined): number | null {
  if (s === undefined) return null;
  let t = s.trim();
  if (!t) return null;
  const pct = t.endsWith('%');
  t = t.replace(/R\$|%|\s/g, '');
  // Com vírgula é o jeito brasileiro (1.234,56); sem vírgula, o ponto é decimal (como vem do Excel).
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return pct ? n / 100 : n;
}

/** Percentual: aceita 0,25 ou 25 (vira 0,25). */
const pct = (s: string | undefined) => {
  const n = num(s);
  if (n === null) return null;
  return n > 1 ? n / 100 : n;
};

function findSheet(abas: Abas, ...names: string[]): string[][] | undefined {
  const want = names.map(slug);
  for (const [name, rows] of abas) if (want.includes(slug(name))) return rows;
  return undefined;
}

/** Tabela a partir da linha de títulos que começa com `first`. `col(…)` acha a coluna pelo começo do título. */
function table(rows: string[][] | undefined, first: string) {
  if (!rows) return null;
  const hi = rows.findIndex((r) => norm(r[0] ?? '') === first || norm(r[0] ?? '').startsWith(`${first} `));
  if (hi < 0) return null;
  const head = rows[hi]!.map(norm);
  const col = (...starts: string[]) => head.findIndex((h) => starts.some((s) => h.startsWith(s)));
  return { head, col, body: rows.slice(hi + 1) };
}

const unidade = (s: string): Unidade => {
  const n = norm(s);
  if (n === 'l' || n.startsWith('litro') || n === 'ml') return 'L';
  if (n === 'un' || n.startsWith('unid') || n === 'u') return 'un';
  return 'kg';
};

const etapa = (s: string): Etapa => {
  const n = norm(s);
  if (n.startsWith('emb')) return 'Embalagem';
  if (n.startsWith('dep')) return 'Depois';
  return 'Antes';
};

const tamanho = (s: string): Tamanho | null => {
  const n = norm(s);
  if (n.startsWith('m')) return 'M';
  if (n.startsWith('g')) return 'G';
  return null;
};

const sim = (s: string) => !/^(nao|n|false|falso|0)$/.test(norm(s));

const isoDate = (s: string | undefined) => (s ? parseDate(s) ?? undefined : undefined);

export function lerPlanilha(abas: Abas): Importacao {
  const avisos: string[] = [];
  const insumos: Insumo[] = [];
  const preparos: Preparo[] = [];
  const pizzas: Pizza[] = [];

  // ----- configurações gerais (aba Início) -----
  const config: Config = { ...CONFIG_PADRAO };
  const inicio = findSheet(abas, 'Início', 'Inicio');
  const valorDe = (rows: string[][] | undefined, label: string) => {
    const r = rows?.find((x) => x.some((c) => norm(c).startsWith(label)));
    if (!r) return undefined;
    const at = r.findIndex((c) => norm(c).startsWith(label));
    return r.slice(at + 1).find((c) => num(c) !== null);
  };
  const imp = pct(valorDe(inicio, 'impostos sobre a venda'));
  if (imp !== null) config.impostos = imp;
  const cmvMax = pct(valorDe(inicio, 'cmv % maximo'));
  if (cmvMax !== null) config.cmvMaximo = cmvMax;
  const dias = num(valorDe(inicio, 'preco de insumo desatualizado'));
  if (dias !== null && dias > 0) config.diasDesatualizado = Math.round(dias);

  // ----- canais (abas Salão, iFood, 99Food...) -----
  const canais: Canal[] = [];
  const listas = findSheet(abas, 'Listas');
  const nomesCanais = (() => {
    const t = listas?.[0]?.findIndex((c) => norm(c) === 'canais') ?? -1;
    const out = t >= 0 ? listas!.slice(1).map((r) => r[t] ?? '').filter(Boolean) : [];
    return out.length ? out : CANAIS_PADRAO.map((c) => c.nome);
  })();
  for (const nome of nomesCanais) {
    const rows = findSheet(abas, nome);
    const padrao = CANAIS_PADRAO.find((c) => slug(c.nome) === slug(nome));
    const id = padrao?.id ?? slug(nome);
    const base: Canal = padrao ? { ...padrao } : { id, nome, usaEmbalagem: true, comissao: 0, taxaPagamento: 0, desconto: 0, taxaFixaPedido: 0, custosExtrasPedido: 0, margemAlvo: 0.3 };
    base.nome = nome;
    if (rows) {
      const texto = norm(rows.slice(0, 3).map((r) => r.join(' ')).join(' '));
      base.usaEmbalagem = !/nao inclui embalagem/.test(texto);
      const set = <K extends keyof Canal>(k: K, label: string, f: (s: string | undefined) => number | null) => {
        const v = f(valorDe(rows, label));
        if (v !== null) (base[k] as number) = v;
      };
      set('comissao', 'comissao da plataforma', pct);
      set('taxaPagamento', 'taxa de pagamento', pct);
      set('desconto', 'desconto', pct);
      set('taxaFixaPedido', 'taxa fixa por pedido', num);
      set('custosExtrasPedido', 'custos extras por pedido', num);
      set('margemAlvo', 'margem-alvo', pct);
    } else {
      avisos.push(`Não achei a aba do canal ${nome}: ficou com os valores padrão.`);
    }
    canais.push(base);
  }

  // ----- insumos -----
  const ti = table(findSheet(abas, 'Insumos_Brutos', 'Insumos'), 'id');
  if (!ti) avisos.push('Não achei a aba Insumos_Brutos.');
  else {
    const c = {
      id: ti.col('id'), nome: ti.col('nome'), cat: ti.col('categoria'), un: ti.col('unidade'), preco: ti.col('preco pago'),
      qtd: ti.col('qtd'), perda: ti.col('% perda', 'perda'), data: ti.col('ultima'), forn: ti.col('fornecedor'),
    };
    for (const r of ti.body) {
      const id = r[c.id]?.trim();
      const nome = r[c.nome]?.trim();
      if (!id || !nome) continue;
      const qtd = num(r[c.qtd]);
      insumos.push({
        id, nome,
        categoria: r[c.cat]?.trim() ?? '',
        unidade: unidade(r[c.un] ?? ''),
        precoPago: num(r[c.preco]),
        qtdComprada: qtd && qtd > 0 ? qtd : 1,
        perda: pct(r[c.perda]) ?? 0,
        ...(isoDate(r[c.data]) ? { atualizadoEm: isoDate(r[c.data]) } : {}),
        ...(r[c.forn]?.trim() ? { fornecedor: r[c.forn]!.trim() } : {}),
      });
    }
  }

  // ----- preparos -----
  const tp = table(findSheet(abas, 'Preparos_Cadastro', 'Preparos'), 'id');
  if (tp) {
    const c = { id: tp.col('id'), nome: tp.col('nome'), un: tp.col('unidade'), perda: tp.col('% perda', 'perda'), obs: tp.col('observ') };
    for (const r of tp.body) {
      const id = r[c.id]?.trim();
      const nome = r[c.nome]?.trim();
      if (!id || !nome) continue;
      preparos.push({ id, nome, unidade: unidade(r[c.un] ?? ''), perda: pct(r[c.perda]) ?? 0, itens: [], ...(r[c.obs]?.trim() ? { obs: r[c.obs]!.trim() } : {}) });
    }
  }

  // Ingrediente pelo id (colunas "id Ing.") ou pelo nome.
  const porNome = new Map<string, string>();
  for (const x of [...insumos, ...preparos]) porNome.set(norm(x.nome), x.id);
  const ids = new Set([...insumos, ...preparos].map((x) => x.id));
  const ref = (id: string | undefined, nome: string | undefined, onde: string): string | null => {
    if (id?.trim() && ids.has(id.trim())) return id.trim();
    const n = nome?.trim();
    if (!n) return null;
    const found = porNome.get(norm(n));
    if (!found) avisos.push(`${onde}: não achei o ingrediente "${n}" nos insumos nem nos preparos. A linha ficou de fora.`);
    return found ?? null;
  };

  const tpr = table(findSheet(abas, 'Preparos_Receita'), 'preparo');
  if (tpr) {
    const c = { prep: tpr.col('preparo'), ing: tpr.col('ingrediente'), qtd: tpr.col('quantidade', 'qtd'), idPrep: tpr.head.findIndex((h) => h === 'id preparo'), idIng: tpr.head.findIndex((h) => h.startsWith('id ing')) };
    for (const r of tpr.body) {
      const nomePrep = r[c.prep]?.trim();
      if (!nomePrep) continue;
      const p = preparos.find((x) => (c.idPrep >= 0 && x.id === r[c.idPrep]?.trim()) || norm(x.nome) === norm(nomePrep));
      if (!p) {
        avisos.push(`Preparos_Receita: não achei o preparo "${nomePrep}" no cadastro.`);
        continue;
      }
      const qtd = num(r[c.qtd]);
      const id = ref(c.idIng >= 0 ? r[c.idIng] : undefined, r[c.ing], p.nome);
      if (!id || qtd === null) continue;
      p.itens.push({ ref: id, qtd });
    }
  }

  // ----- pizzas -----
  const tz = table(findSheet(abas, 'Pizzas_Cadastro', 'Pizzas'), 'id');
  if (!tz) avisos.push('Não achei a aba Pizzas_Cadastro.');
  else {
    const c = { id: tz.col('id'), nome: tz.col('nome'), cat: tz.col('categoria'), ativa: tz.col('ativa'), obs: tz.col('observ') };
    // Colunas de preço: "Salão Médio", "iFood Grande"...
    const precoCols: { canal: string; t: Tamanho; i: number }[] = [];
    tz.head.forEach((h, i) => {
      if (h.startsWith('cmv')) return;
      for (const k of canais) {
        const nk = norm(k.nome);
        if (!h.startsWith(`${nk} `)) continue;
        const t = tamanho(h.slice(nk.length + 1));
        if (t) precoCols.push({ canal: k.id, t, i });
      }
    });
    for (const r of tz.body) {
      const id = r[c.id]?.trim();
      const nome = r[c.nome]?.trim();
      if (!id || !nome) continue;
      const precos: Pizza['precos'] = {};
      for (const pc of precoCols) {
        const v = num(r[pc.i]);
        if (v !== null && v > 0) precos[pc.canal] = { ...precos[pc.canal], [pc.t]: v };
      }
      pizzas.push({ id, nome, categoria: r[c.cat]?.trim() ?? '', ativa: c.ativa < 0 || sim(r[c.ativa] ?? 'Sim'), precos, linhas: [], ...(c.obs >= 0 && r[c.obs]?.trim() ? { obs: r[c.obs]!.trim() } : {}) });
    }
  }

  const tr = table(findSheet(abas, 'Pizzas_Receita'), 'pizza');
  if (tr) {
    const c = {
      pizza: tr.col('pizza'), ing: tr.col('ingrediente'), etapa: tr.col('etapa'), m: tr.col('qtd. medio', 'qtd medio'), g: tr.col('qtd. grande', 'qtd grande'), troca: tr.col('trocar item'),
      idPizza: tr.head.findIndex((h) => h === 'id pizza'), idIng: tr.head.findIndex((h) => h === 'id ing.' || h === 'id ing'), idIngG: tr.head.findIndex((h) => h === 'id ing.g' || h === 'id ing g'),
    };
    const seq = new Map<string, number>();
    for (const r of tr.body) {
      const nomePizza = r[c.pizza]?.trim();
      if (!nomePizza) continue;
      const p = pizzas.find((x) => (c.idPizza >= 0 && x.id === r[c.idPizza]?.trim()) || norm(x.nome) === norm(nomePizza));
      if (!p) {
        avisos.push(`Pizzas_Receita: não achei a pizza "${nomePizza}" no cadastro.`);
        continue;
      }
      const id = ref(c.idIng >= 0 ? r[c.idIng] : undefined, r[c.ing], p.nome);
      if (!id) continue;
      const troca = r[c.troca]?.trim() || (c.idIngG >= 0 ? r[c.idIngG]?.trim() : '');
      const refG = troca ? ref(c.idIngG >= 0 ? r[c.idIngG] : undefined, r[c.troca], `${p.nome} (Grande)`) : null;
      const n = (seq.get(p.id) ?? 0) + 1;
      seq.set(p.id, n);
      const linha: LinhaPizza = { id: `${p.id}-L${n}`, etapa: etapa(r[c.etapa] ?? ''), ref: id, qtdM: num(r[c.m]), qtdG: num(r[c.g]), ...(refG && refG !== id ? { refG } : {}) };
      p.linhas.push(linha);
    }
  }

  // ----- histórico de preços -----
  const compras: Compra[] = [];
  const th = table(findSheet(abas, 'Histórico_Preços', 'Historico_Precos'), 'data');
  if (th) {
    const c = { data: th.col('data'), ins: th.col('insumo'), preco: th.col('preco pago'), qtd: th.col('qtd'), forn: th.col('fornecedor') };
    th.body.forEach((r, i) => {
      const data = isoDate(r[c.data]);
      const nome = r[c.ins]?.trim();
      const preco = num(r[c.preco]);
      if (!data || !nome || preco === null) return;
      const ins = insumos.find((x) => norm(x.nome) === norm(nome) || x.id === nome);
      if (!ins) return void avisos.push(`Histórico_Preços: não achei o insumo "${nome}".`);
      compras.push({ id: `H${i + 1}-${data}-${ins.id}`, data, insumo: ins.id, precoPago: preco, qtd: num(r[c.qtd]) || 1, ...(r[c.forn]?.trim() ? { fornecedor: r[c.forn]!.trim() } : {}) });
    });
  }

  // ----- vendas -----
  const vendas: Venda[] = [];
  const tv = table(findSheet(abas, 'Vendas'), 'periodo');
  if (tv) {
    const c = { per: tv.col('periodo'), pizza: tv.col('pizza'), t: tv.col('tamanho'), canal: tv.col('canal'), qtd: tv.col('qtd') };
    for (const r of tv.body) {
      const periodo = (r[c.per] ?? '').trim();
      const qtd = num(r[c.qtd]);
      const p = pizzas.find((x) => norm(x.nome) === norm(r[c.pizza] ?? ''));
      const t = tamanho(r[c.t] ?? '');
      const k = canais.find((x) => norm(x.nome) === norm(r[c.canal] ?? ''));
      const m = /^(\d{4})-(\d{1,2})/.exec(periodo) ?? /^(\d{1,2})\/(\d{4})$/.exec(periodo);
      if (!p || !t || !k || !qtd || !m) continue;
      const per = m[0].includes('/') ? `${m[2]}-${m[1]!.padStart(2, '0')}` : `${m[1]}-${m[2]!.padStart(2, '0')}`;
      vendas.push({ periodo: per, pizza: p.id, tamanho: t, canal: k.id, qtd });
    }
  }

  if (!insumos.length && !pizzas.length) throw new Error('Essa planilha não tem as abas de insumos e pizzas da ficha técnica (Insumos_Brutos e Pizzas_Cadastro).');
  return { catalogo: { insumos, preparos, pizzas, canais, config, compras, vendas }, avisos: [...new Set(avisos)] };
}
