import type { VaultHeader, DeviceUnlock, Sealed } from '../crypto/vault';
import { seal, open, sealCompressed, openCompressed, canCompress, COMPRESS_FROM } from '../crypto/vault';
import type { StoredEvent } from './events';
import type { SyncMeta } from '../sync/sync';

/**
 * Banco local no navegador (IndexedDB). Só guarda dados cifrados: o cabeçalho do cofre
 * (sem segredos), o desbloqueio por PIN deste aparelho e lotes de eventos cifrados.
 */
const DB_NAME = 'ficharedonda';
const DB_VERSION = 2;

/**
 * Retrato do cofre neste aparelho: todos os eventos até `upTo` (por aparelho) num bloco só,
 * compactado e cifrado. Abre o cofre grande com uma decifragem em vez de milhares.
 */
export interface Snapshot {
  sealed: Sealed;
  z?: 1;
  at: string;
  /** Último evento de cada aparelho que está no retrato (os hashes até ali já foram conferidos). */
  upTo: Record<string, number>;
  count: number;
}

export const snapshotAad = (vaultId: string) => `ficharedonda|${vaultId}|retrato`;

export async function sealSnapshot(key: CryptoKey, vaultId: string, events: StoredEvent[]): Promise<Snapshot> {
  const upTo: Record<string, number> = {};
  for (const e of events) upTo[e.device] = Math.max(upTo[e.device] ?? 0, e.seq);
  const z = canCompress();
  const sealed = z ? await sealCompressed(key, events, snapshotAad(vaultId)) : await seal(key, events, snapshotAad(vaultId));
  return { sealed, ...(z ? { z: 1 as const } : {}), at: new Date().toISOString(), upTo, count: events.length };
}

export async function openSnapshot(key: CryptoKey, vaultId: string, s: Snapshot): Promise<StoredEvent[]> {
  return s.z ? openCompressed<StoredEvent[]>(key, s.sealed, snapshotAad(vaultId)) : open<StoredEvent[]>(key, s.sealed, snapshotAad(vaultId));
}

/** Um lote que já está no Drive: a chave do lote e o arquivo de lá. */
export interface RemoteFile {
  key: string;
  fileId: string;
}

export interface EventBatch {
  key: string; // `${device}:${fromSeq}`
  device: string;
  fromSeq: number;
  toSeq: number;
  sealed: Sealed;
  /** 1 = compactado (gzip) antes de cifrar. Lotes antigos não têm. */
  z?: 1;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function openDb(name = DB_NAME): Promise<IDBDatabase> {
  const r = indexedDB.open(name, DB_VERSION);
  r.onupgradeneeded = () => {
    const db = r.result;
    if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    if (!db.objectStoreNames.contains('batches')) db.createObjectStore('batches', { keyPath: 'key' });
    // Índice do que já está no Drive (chave do lote → arquivo). O que falta nele é a fila de envio.
    if (!db.objectStoreNames.contains('remote')) db.createObjectStore('remote', { keyPath: 'key' });
  };
  return req(r);
}

export const batchAad = (vaultId: string, device: string, fromSeq: number, toSeq: number) => `ficharedonda|${vaultId}|${device}|${fromSeq}|${toSeq}`;

export class LocalDb {
  constructor(private db: IDBDatabase) {}

  static async open(name?: string): Promise<LocalDb> {
    return new LocalDb(await openDb(name));
  }

  private async getMeta<T>(key: string): Promise<T | undefined> {
    const tx = this.db.transaction('meta', 'readonly');
    return req(tx.objectStore('meta').get(key)) as Promise<T | undefined>;
  }

  private async setMeta(key: string, value: unknown): Promise<void> {
    const tx = this.db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(value, key);
    await txDone(tx);
  }

  getHeader() {
    return this.getMeta<VaultHeader>('header');
  }
  setHeader(h: VaultHeader) {
    return this.setMeta('header', h);
  }
  getDevice() {
    return this.getMeta<DeviceUnlock>('device');
  }
  setDevice(d: DeviceUnlock | null) {
    return this.setMeta('device', d ?? undefined);
  }
  getSnapshot() {
    return this.getMeta<Snapshot>('snapshot');
  }
  setSnapshot(s: Snapshot | null) {
    return this.setMeta('snapshot', s ?? undefined);
  }
  /** Só o que o retrato precisa saber dos lotes: aparelho e números, sem o conteúdo cifrado. */
  async batchRanges(): Promise<{ key: string; device: string; fromSeq: number; toSeq: number }[]> {
    return (await this.allBatches()).map((b) => ({ key: b.key, device: b.device, fromSeq: b.fromSeq, toSeq: b.toSeq }));
  }
  getSync() {
    return this.getMeta<SyncMeta>('sync');
  }
  async setSync(m: SyncMeta | null) {
    await this.setMeta('sync', m ?? undefined);
    if (!m) await this.markRemote([], true); // sem Drive, nada conta como enviado
  }
  async getDeviceId(): Promise<string> {
    let id = await this.getMeta<string>('deviceId');
    if (!id) {
      id = crypto.randomUUID();
      await this.setMeta('deviceId', id);
    }
    return id;
  }

  async appendEvents(key: CryptoKey, vaultId: string, events: StoredEvent[]): Promise<void> {
    if (events.length === 0) return;
    const device = events[0]!.device;
    if (events.some((e) => e.device !== device)) throw new Error('Lote com aparelhos diferentes.');
    const fromSeq = events[0]!.seq;
    const toSeq = events[events.length - 1]!.seq;
    const z = canCompress() && JSON.stringify(events).length >= COMPRESS_FROM;
    const aad = batchAad(vaultId, device, fromSeq, toSeq);
    const sealed = z ? await sealCompressed(key, events, aad) : await seal(key, events, aad);
    const tx = this.db.transaction('batches', 'readwrite');
    tx.objectStore('batches').put({ key: `${device}:${String(fromSeq).padStart(10, '0')}`, device, fromSeq, toSeq, sealed, ...(z ? { z: 1 as const } : {}) } satisfies EventBatch);
    await txDone(tx);
  }

  async allBatches(): Promise<EventBatch[]> {
    const tx = this.db.transaction('batches', 'readonly');
    return req(tx.objectStore('batches').getAll()) as Promise<EventBatch[]>;
  }

  async putBatches(batches: EventBatch[]): Promise<void> {
    const tx = this.db.transaction('batches', 'readwrite');
    for (const b of batches) tx.objectStore('batches').put(b);
    await txDone(tx);
  }

  /** Só as chaves dos lotes: barato mesmo com muitos lotes. */
  async batchKeys(): Promise<string[]> {
    const tx = this.db.transaction('batches', 'readonly');
    return req(tx.objectStore('batches').getAllKeys()) as Promise<string[]>;
  }

  async getBatches(keys: string[]): Promise<EventBatch[]> {
    const tx = this.db.transaction('batches', 'readonly');
    const store = tx.objectStore('batches');
    const out = await Promise.all(keys.map((k) => req(store.get(k)) as Promise<EventBatch | undefined>));
    return out.filter((b): b is EventBatch => !!b);
  }

  async remoteKeys(): Promise<Set<string>> {
    const tx = this.db.transaction('remote', 'readonly');
    return new Set((await req(tx.objectStore('remote').getAllKeys())) as string[]);
  }

  /** Lotes deste aparelho (ou baixados) que já estão no Drive. `replace` troca o índice inteiro. */
  async markRemote(entries: RemoteFile[], replace = false): Promise<void> {
    const tx = this.db.transaction('remote', 'readwrite');
    const store = tx.objectStore('remote');
    if (replace) store.clear();
    for (const e of entries) store.put(e);
    await txDone(tx);
  }

  /** Arquivos que sumiram do Drive: os lotes deles voltam para a fila de envio. */
  async unmarkRemoteFiles(fileIds: string[]): Promise<void> {
    if (!fileIds.length) return;
    const gone = new Set(fileIds);
    const tx = this.db.transaction('remote', 'readwrite');
    const store = tx.objectStore('remote');
    for (const r of (await req(store.getAll())) as RemoteFile[]) if (gone.has(r.fileId)) store.delete(r.key);
    await txDone(tx);
  }

  /** Quantos lotes ainda não foram para o Drive. */
  async pendingUploads(): Promise<string[]> {
    const [local, remote] = await Promise.all([this.batchKeys(), this.remoteKeys()]);
    return local.filter((k) => !remote.has(k));
  }

  async readEvents(key: CryptoKey, vaultId: string): Promise<StoredEvent[]> {
    return decryptBatches(key, vaultId, await this.allBatches());
  }

  async wipe(): Promise<void> {
    const tx = this.db.transaction(['meta', 'batches', 'remote'], 'readwrite');
    tx.objectStore('meta').clear();
    tx.objectStore('batches').clear();
    tx.objectStore('remote').clear();
    await txDone(tx);
  }
}

export async function decryptBatches(key: CryptoKey, vaultId: string, batches: EventBatch[]): Promise<StoredEvent[]> {
  const out: StoredEvent[] = [];
  for (const b of batches) {
    const aad = batchAad(vaultId, b.device, b.fromSeq, b.toSeq);
    const events = b.z ? await openCompressed<StoredEvent[]>(key, b.sealed, aad) : await open<StoredEvent[]>(key, b.sealed, aad);
    // O AAD prende o lote ao aparelho e às sequências: trocar lotes de lugar falha na decifragem.
    if (events.length !== b.toSeq - b.fromSeq + 1 || events[0]?.seq !== b.fromSeq) throw new Error('Lote de eventos inconsistente.');
    out.push(...events);
  }
  return out;
}

/** Arquivo de cópia de segurança: cabeçalho do cofre + lotes cifrados. Ilegível sem senha ou código. */
export interface BackupFile {
  app: 'ficharedonda';
  format: 1;
  createdAt: string;
  header: VaultHeader;
  batches: EventBatch[];
}
