import type { Canal, Catalogo, Compra, Config, Insumo, Pizza, Preparo, Venda } from '../domain/ficha';
import { toHex, utf8 } from '../crypto/encoding';

export interface Settings {
  businessName: string;
  deviceShared?: boolean;
}

/** Registro de uma planilha importada. */
export interface ImportRecord {
  at: string;
  fileName: string;
  pizzas: number;
  insumos: number;
  preparos: number;
}

/**
 * Toda mudança vira um evento. Cadastros são gravados inteiros (o item como ficou), então o
 * evento mais recente de cada item vale, inclusive quando vem de outro aparelho.
 */
export type EventData =
  | { type: 'setup'; settings: Settings }
  | { type: 'settings.set'; settings: Partial<Settings> }
  /** Planilha importada: substitui o cadastro inteiro (e junta compras e vendas sem repetir). */
  | { type: 'catalog.import'; catalog: Catalogo; record: ImportRecord }
  | { type: 'insumo.save'; insumo: Insumo }
  | { type: 'insumo.remove'; id: string }
  | { type: 'preparo.save'; preparo: Preparo }
  | { type: 'preparo.remove'; id: string }
  | { type: 'pizza.save'; pizza: Pizza }
  | { type: 'pizza.remove'; id: string }
  | { type: 'canal.save'; canal: Canal }
  | { type: 'config.set'; config: Partial<Config> }
  /** Compra lançada. Com `atualizar`, o preço do insumo passa a ser o desta compra. */
  | { type: 'compra.add'; compra: Compra; atualizar: boolean }
  | { type: 'compra.remove'; id: string }
  /** Vendas de um período (AAAA-MM): substitui as que havia nele. */
  | { type: 'vendas.set'; periodo: string; vendas: Venda[] }
  | { type: 'recovery.tested'; wrapperId: string };

export interface StoredEvent {
  id: string;
  device: string;
  seq: number;
  at: string;
  prev: string | null;
  hash: string;
  data: EventData;
  /**
   * Até onde este aparelho já tinha visto os outros quando criou o evento (aparelho → último número).
   * Serve para reconhecer mudanças feitas ao mesmo tempo em dois aparelhos. Eventos antigos não têm.
   */
  seen?: Record<string, number>;
}

/** JSON com chaves ordenadas, para que o hash não dependa da ordem dos campos. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}

export async function hashEvent(e: Omit<StoredEvent, 'hash'>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8(canonicalJson({ id: e.id, device: e.device, seq: e.seq, at: e.at, prev: e.prev, data: e.data, seen: e.seen })));
  return toHex(digest);
}

/** Cria eventos encadeados: cada um carrega o hash do anterior do mesmo aparelho. */
export async function makeEvents(device: string, last: { seq: number; hash: string } | null, items: EventData[], now = new Date(), seen?: Record<string, number>): Promise<StoredEvent[]> {
  const out: StoredEvent[] = [];
  let seq = last?.seq ?? 0;
  let prev = last?.hash ?? null;
  for (const data of items) {
    seq += 1;
    const base: Omit<StoredEvent, 'hash'> = { id: crypto.randomUUID(), device, seq, at: now.toISOString(), prev, data, ...(seen ? { seen } : {}) };
    const hash = await hashEvent(base);
    out.push({ ...base, hash });
    prev = hash;
  }
  return out;
}

export interface ChainProblem {
  device: string;
  seq: number;
  message: string;
}

/**
 * Confere se nenhum evento foi apagado, trocado de ordem ou alterado. `trusted` diz, por aparelho,
 * até onde os hashes já foram conferidos numa abertura anterior (o retrato do aparelho).
 */
export async function verifyChain(events: StoredEvent[], trusted: Record<string, number> = {}): Promise<ChainProblem[]> {
  const problems: ChainProblem[] = [];
  const byDevice = new Map<string, StoredEvent[]>();
  for (const e of events) byDevice.set(e.device, [...(byDevice.get(e.device) ?? []), e]);
  for (const [device, list] of byDevice) {
    list.sort((a, b) => a.seq - b.seq);
    let expectedSeq = 1;
    let prev: string | null = null;
    for (const e of list) {
      if (e.seq !== expectedSeq) {
        problems.push({ device, seq: e.seq, message: e.seq > expectedSeq ? `Faltam registros ${expectedSeq} a ${e.seq - 1}.` : `Registro ${e.seq} repetido.` });
        expectedSeq = e.seq;
      }
      if (e.prev !== prev) problems.push({ device, seq: e.seq, message: `O registro ${e.seq} não aponta para o anterior.` });
      // Até `trusted` a conta já foi feita e guardada no retrato cifrado: só confere a ligação.
      if (e.seq > (trusted[device] ?? 0) && (await hashEvent(e)) !== e.hash) problems.push({ device, seq: e.seq, message: `O registro ${e.seq} foi alterado.` });
      prev = e.hash;
      expectedSeq += 1;
    }
  }
  return problems;
}

/** Ordem global de aplicação: data, aparelho, sequência. */
export function orderEvents(events: StoredEvent[]): StoredEvent[] {
  return [...events].sort((a, b) => (a.at !== b.at ? (a.at < b.at ? -1 : 1) : a.device !== b.device ? (a.device < b.device ? -1 : 1) : a.seq - b.seq));
}
