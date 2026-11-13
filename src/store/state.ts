import { catalogoVazio, type Catalogo, type Compra, type Venda } from '../domain/ficha';
import type { ImportRecord, Settings, StoredEvent } from './events';

export interface State {
  ready: boolean;
  settings: Settings;
  catalogo: Catalogo;
  imports: ImportRecord[];
  lastRecoveryTest?: string;
  /** Último evento de cada aparelho, para continuar a corrente. */
  heads: Record<string, { seq: number; hash: string }>;
  /** Quando cada item foi mudado pela última vez (id → horário), para mostrar "mudou há pouco". */
  touched: Record<string, string>;
}

export function emptyState(): State {
  return { ready: false, settings: { businessName: '' }, catalogo: catalogoVazio(), imports: [], heads: {}, touched: {} };
}

/** Cópia rasa com coleções novas: o estado que a tela mostra nunca muda por baixo dela. */
export function cloneState(s: State): State {
  const c = s.catalogo;
  return {
    ...s,
    settings: { ...s.settings },
    catalogo: { ...c, insumos: [...c.insumos], preparos: [...c.preparos], pizzas: [...c.pizzas], canais: [...c.canais], config: { ...c.config }, compras: [...c.compras], vendas: [...c.vendas] },
    imports: [...s.imports],
    heads: { ...s.heads },
    touched: { ...s.touched },
  };
}

/** Troca o item de mesmo id (ou acrescenta no fim). */
function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i < 0) return [...list, item];
  const out = [...list];
  out[i] = item;
  return out;
}

const compraKey = (c: Compra) => `${c.data}|${c.insumo}|${c.precoPago}|${c.qtd}`;
const vendaKey = (v: Venda) => `${v.periodo}|${v.pizza}|${v.tamanho}|${v.canal}`;

/** Aplica um evento num estado já copiado (cloneState) e devolve o mesmo objeto. */
export function applyEvent(s: State, ev: StoredEvent): State {
  s.heads[ev.device] = { seq: ev.seq, hash: ev.hash };
  const d = ev.data;
  const c = s.catalogo;
  switch (d.type) {
    case 'setup':
      s.ready = true;
      s.settings = { ...d.settings };
      break;
    case 'settings.set':
      s.settings = { ...s.settings, ...d.settings };
      break;
    case 'catalog.import': {
      const n = d.catalog;
      // Compras e vendas que já estão no app ficam; as da planilha entram sem repetir.
      const compras = new Map(c.compras.map((x) => [compraKey(x), x]));
      for (const x of n.compras) if (!compras.has(compraKey(x))) compras.set(compraKey(x), x);
      const vendas = new Map(c.vendas.map((x) => [vendaKey(x), x]));
      for (const x of n.vendas) vendas.set(vendaKey(x), x);
      s.catalogo = { insumos: [...n.insumos], preparos: [...n.preparos], pizzas: [...n.pizzas], canais: [...n.canais], config: { ...n.config }, compras: [...compras.values()], vendas: [...vendas.values()] };
      s.imports.push(d.record);
      break;
    }
    case 'insumo.save':
      c.insumos = upsert(c.insumos, d.insumo);
      s.touched[d.insumo.id] = ev.at;
      break;
    case 'insumo.remove':
      c.insumos = c.insumos.filter((x) => x.id !== d.id);
      break;
    case 'preparo.save':
      c.preparos = upsert(c.preparos, d.preparo);
      s.touched[d.preparo.id] = ev.at;
      break;
    case 'preparo.remove':
      c.preparos = c.preparos.filter((x) => x.id !== d.id);
      break;
    case 'pizza.save':
      c.pizzas = upsert(c.pizzas, d.pizza);
      s.touched[d.pizza.id] = ev.at;
      break;
    case 'pizza.remove':
      c.pizzas = c.pizzas.filter((x) => x.id !== d.id);
      break;
    case 'canal.save':
      c.canais = upsert(c.canais, d.canal);
      break;
    case 'config.set':
      c.config = { ...c.config, ...d.config };
      break;
    case 'compra.add': {
      c.compras = upsert(c.compras, d.compra);
      const ins = c.insumos.find((x) => x.id === d.compra.insumo);
      // Só a compra mais recente muda o preço: lançar uma compra antiga não volta o preço atrás.
      if (d.atualizar && ins && (!ins.atualizadoEm || d.compra.data >= ins.atualizadoEm)) {
        c.insumos = upsert(c.insumos, { ...ins, precoPago: d.compra.precoPago, qtdComprada: d.compra.qtd, atualizadoEm: d.compra.data, ...(d.compra.fornecedor ? { fornecedor: d.compra.fornecedor } : {}) });
        s.touched[ins.id] = ev.at;
      }
      break;
    }
    case 'compra.remove':
      c.compras = c.compras.filter((x) => x.id !== d.id);
      break;
    case 'vendas.set':
      c.vendas = [...c.vendas.filter((v) => v.periodo !== d.periodo), ...d.vendas.filter((v) => v.qtd > 0).map((v) => ({ ...v, periodo: d.periodo }))];
      break;
    case 'recovery.tested':
      s.lastRecoveryTest = ev.at;
      break;
  }
  return s;
}

/** Estado do zero a partir de todos os eventos (já em ordem). */
export function replay(events: StoredEvent[]): State {
  const s = emptyState();
  for (const e of events) applyEvent(s, e);
  return s;
}
