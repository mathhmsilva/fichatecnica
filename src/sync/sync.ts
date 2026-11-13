import type { VaultHeader } from '../crypto/vault';
import { canonicalJson } from '../store/events';
import type { EventBatch, LocalDb, RemoteFile } from '../store/localdb';
import { DriveError, type DriveFile, type DriveStore } from './drive';

export const FOLDER_NAME = 'Ficha Redonda';
const HEADER_FILE = 'cofre.json';
const batchFile = (b: Pick<EventBatch, 'device' | 'fromSeq' | 'toSeq'>) => `lote-${b.device}-${String(b.fromSeq).padStart(10, '0')}-${String(b.toSeq).padStart(10, '0')}.json`;
const BATCH_RE = /^lote-([0-9a-f-]{36})-(\d{10})-(\d{10})\.json$/;
/** Pacote: muitos lotes de um aparelho num arquivo só, para um aparelho novo baixar rápido. */
const PACK_RE = /^pacote-([0-9a-f-]{36})-(\d{10})-(\d{10})\.json$/;
const packFile = (device: string, fromSeq: number, toSeq: number) => `pacote-${device}-${String(fromSeq).padStart(10, '0')}-${String(toSeq).padStart(10, '0')}.json`;
/** Lotes por pacote. Os arquivos soltos continuam no Drive: o pacote só acelera quem baixa muito. */
export const PACK_SIZE = 500;
/** Só vale ler um pacote se ele trouxer pelo menos isto de lotes que faltam. */
const PACK_WORTH = 20;

/** O que o aparelho lembra da última sincronização. */
export interface SyncMeta {
  email: string;
  folderId: string;
  headerFileId: string;
  /** Cabeçalho como estava no Drive na última sincronização (para saber quem mudou). */
  headerSynced: string;
  headerVersion: string;
  lastSync: string;
  /** Marca da lista de mudanças do Drive: a próxima vez só pergunta o que mudou depois dela. */
  pageToken?: string;
  /** Última conferência completa da pasta (pega arquivo apagado à mão, por exemplo). */
  lastFull?: string;
  /** Até qual evento deste aparelho já há pacote no Drive. */
  packedTo?: number;
}

export interface SyncResult {
  uploaded: number;
  downloaded: EventBatch[];
  header: VaultHeader | null; // novo cabeçalho vindo do Drive, se mudou
  warnings: string[];
  /** Conferiu a pasta inteira (primeira vez, uma vez por dia, ou a marca de mudanças venceu). */
  full: boolean;
}

export class SyncError extends Error {
  constructor(message: string, public code?: 'outro-cofre' | 'outra-conta') {
    super(message);
  }
}

/** Uma conferência completa por dia; no resto, só as mudanças. */
export const FULL_EVERY_MS = 24 * 3600_000;
/** Envios e downloads em paralelo: rápido sem esbarrar no limite do Google. */
export const PARALLEL = 4;

const batchKey = (device: string, fromSeq: number) => `${device}:${String(fromSeq).padStart(10, '0')}`;
const keyOfName = (name: string) => {
  const m = BATCH_RE.exec(name);
  return m ? `${m[1]}:${m[2]}` : null;
};

function parseBatch(name: string, content: string): EventBatch {
  const m = BATCH_RE.exec(name);
  if (!m) throw new SyncError(`Arquivo inesperado na pasta do Drive: ${name}`);
  const b = JSON.parse(content) as EventBatch;
  // O nome do arquivo precisa bater com o conteúdo; a cifra (AAD) confere o resto.
  if (b.device !== m[1] || b.fromSeq !== Number(m[2]) || b.toSeq !== Number(m[3]) || !b.sealed?.iv || !b.sealed?.ct) {
    throw new SyncError(`O arquivo ${name} não confere com o conteúdo.`);
  }
  return { device: b.device, fromSeq: b.fromSeq, toSeq: b.toSeq, sealed: b.sealed, ...(b.z === 1 ? { z: 1 as const } : {}), key: batchKey(b.device, b.fromSeq) };
}

interface PackInfo {
  file: DriveFile;
  device: string;
  fromSeq: number;
  toSeq: number;
}

const packOf = (f: DriveFile): PackInfo | null => {
  const m = PACK_RE.exec(f.name);
  return m ? { file: f, device: m[1]!, fromSeq: Number(m[2]), toSeq: Number(m[3]) } : null;
};

function parsePack(p: PackInfo, content: string): EventBatch[] {
  const data = JSON.parse(content) as { device: string; fromSeq: number; toSeq: number; batches: Omit<EventBatch, 'key' | 'device'>[] };
  if (data.device !== p.device || data.fromSeq !== p.fromSeq || data.toSeq !== p.toSeq || !Array.isArray(data.batches)) {
    throw new SyncError(`O arquivo ${p.file.name} não confere com o conteúdo.`);
  }
  return data.batches.map((b) => {
    if (b.fromSeq < p.fromSeq || b.toSeq > p.toSeq || b.fromSeq > b.toSeq || !b.sealed?.iv || !b.sealed?.ct) throw new SyncError(`O arquivo ${p.file.name} não confere com o conteúdo.`);
    return { device: p.device, fromSeq: b.fromSeq, toSeq: b.toSeq, sealed: b.sealed, ...(b.z === 1 ? { z: 1 as const } : {}), key: batchKey(p.device, b.fromSeq) };
  });
}

/**
 * Baixa os lotes que faltam. Onde um pacote cobre muitos deles, lê o pacote (um arquivo em vez
 * de centenas); o resto vem arquivo por arquivo. Tudo em paralelo.
 */
async function fetchMissing(drive: DriveStore, missing: Map<string, DriveFile>, packs: PackInfo[]): Promise<EventBatch[]> {
  const out: EventBatch[] = [];
  const left = new Map(missing);
  const useful = packs
    .map((p) => {
      let n = 0;
      for (const key of left.keys()) {
        const [device, from] = key.split(':');
        if (device === p.device && Number(from) >= p.fromSeq && Number(from) <= p.toSeq) n++;
      }
      return { p, n };
    })
    .filter((x) => x.n >= PACK_WORTH)
    .map((x) => x.p);
  const fromPacks = await pool(useful, PARALLEL, async (p) => parsePack(p, await drive.read(p.file.id)));
  for (const b of fromPacks.flat()) {
    if (!left.has(b.key)) continue;
    out.push(b);
    left.delete(b.key);
  }
  out.push(...(await pool([...left.values()], PARALLEL, async (f) => parseBatch(f.name, await drive.read(f.id)))));
  return out;
}

/** Junta os lotes deste aparelho que já subiram em pacotes de PACK_SIZE. Devolve até onde empacotou. */
async function packOwn(db: LocalDb, drive: DriveStore, folderId: string, device: string, packedTo: number): Promise<number> {
  const remote = await db.remoteKeys();
  const own = (await db.batchRanges()).filter((b) => b.device === device && b.fromSeq > packedTo && remote.has(b.key)).sort((a, b) => a.fromSeq - b.fromSeq);
  let next = packedTo;
  for (let i = 0; i + PACK_SIZE <= own.length; i += PACK_SIZE) {
    const chunk = own.slice(i, i + PACK_SIZE);
    // Só pacotes sem buraco, começando logo depois do anterior.
    if (chunk[0]!.fromSeq !== next + 1 || chunk.some((b, j) => j > 0 && b.fromSeq !== chunk[j - 1]!.toSeq + 1)) break;
    const batches = await db.getBatches(chunk.map((b) => b.key));
    const last = chunk[chunk.length - 1]!.toSeq;
    const content = JSON.stringify({ device, fromSeq: next + 1, toSeq: last, batches: batches.map((b) => ({ fromSeq: b.fromSeq, toSeq: b.toSeq, sealed: b.sealed, ...(b.z ? { z: 1 } : {}) })) });
    await drive.create(folderId, packFile(device, next + 1, last), content);
    next = last;
  }
  return next;
}

const batchContent = (b: EventBatch) => JSON.stringify({ device: b.device, fromSeq: b.fromSeq, toSeq: b.toSeq, sealed: b.sealed, ...(b.z ? { z: 1 } : {}) });

/** Roda `fn` em até `n` itens ao mesmo tempo, na ordem da lista. Para no primeiro erro. */
export async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  let failed: unknown = null;
  const worker = async () => {
    while (next < items.length && !failed) {
      const i = next++;
      try {
        out[i] = await fn(items[i]!);
      } catch (e) {
        failed ??= e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  if (failed) throw failed instanceof Error ? failed : new Error(String(failed));
  return out;
}

async function findOrCreateFolder(drive: DriveStore): Promise<string> {
  return (await drive.findFolder(FOLDER_NAME)) ?? drive.createFolder(FOLDER_NAME);
}

/** A marca de mudanças venceu ou não vale mais: o Google responde 400, 404 ou 410. */
const staleToken = (e: unknown) => e instanceof DriveError && [400, 404, 410].includes(e.status);

/**
 * Sincroniza este aparelho com o Drive. Lotes de eventos nunca mudam depois de criados,
 * então cada aparelho só sobe os seus e baixa os que faltam: não há conflito de escrita.
 *
 * Para ser rápido com muitos arquivos, o aparelho guarda um índice do que já está no Drive
 * e a marca da lista de mudanças do Google. Numa sincronização comum ele só pergunta "o que
 * mudou desde a marca?", baixa os lotes novos e sobe os que faltam no índice (a fila de envio).
 * Uma vez por dia (ou se a marca vencer) confere a pasta inteira e refaz o índice.
 *
 * O cabeçalho do cofre (que muda ao trocar senha ou código) sobe se mudou aqui e desce se mudou lá.
 * `verify` confere os lotes baixados (decifra com a chave) antes de gravar no aparelho.
 */
export async function syncVault(db: LocalDb, drive: DriveStore, email: string, verify: (b: EventBatch[]) => Promise<void>, opts: { full?: boolean } = {}): Promise<SyncResult> {
  const header = await db.getHeader();
  if (!header) throw new SyncError('Este aparelho ainda não tem cofre.');
  const meta = await db.getSync();
  if (meta && meta.email !== email) throw new SyncError(`Este cofre sincroniza com ${meta.email}. Entre com essa conta Google.`, 'outra-conta');

  const folderId = meta?.folderId ?? (await findOrCreateFolder(drive));
  const full = !!opts.full || !meta?.pageToken || !meta.lastFull || Date.now() - Date.parse(meta.lastFull) > FULL_EVERY_MS;

  // 1. O que há de novo no Drive.
  let pageToken: string;
  let headerFile: DriveFile | undefined;
  let headerTouched: boolean; // o arquivo do cabeçalho pode ter mudado lá
  let seen: { key: string; file: DriveFile }[]; // lotes no Drive que o índice ainda não tem (ou todos, na conferência)
  let packs: PackInfo[];
  if (full) {
    // A marca vem antes da lista: o que mudar enquanto lista aparece na próxima vez.
    pageToken = await drive.startPageToken();
    const files = await drive.list(folderId);
    headerFile = files.find((f) => f.name === HEADER_FILE);
    headerTouched = !meta || !headerFile || headerFile.version !== meta.headerVersion;
    seen = files.flatMap((f) => {
      const key = keyOfName(f.name);
      return key ? [{ key, file: f }] : [];
    });
    packs = files.flatMap((f) => packOf(f) ?? []);
    await db.markRemote(seen.map((s) => ({ key: s.key, fileId: s.file.id })), true);
  } else {
    let ch: Awaited<ReturnType<DriveStore['changes']>>;
    try {
      ch = await drive.changes(meta!.pageToken!);
    } catch (e) {
      if (staleToken(e)) return syncVault(db, drive, email, verify, { full: true });
      throw e;
    }
    pageToken = ch.nextToken;
    // Arquivo apagado de vez chega sem nome nem pasta: só o id diz qual era.
    const here = ch.files.filter((f) => f.removed || f.parents.includes(folderId) || f.id === meta!.headerFileId);
    // Lote apagado do Drive à mão: sai do índice e sobe de novo, se este aparelho o tiver.
    await db.unmarkRemoteFiles(here.filter((f) => f.removed).map((f) => f.id));
    const h = here.find((f) => f.id === meta!.headerFileId || (f.name === HEADER_FILE && f.parents.includes(folderId)));
    if (h?.removed) {
      headerFile = undefined;
      headerTouched = true;
    } else {
      headerFile = h ?? { id: meta!.headerFileId, name: HEADER_FILE, version: meta!.headerVersion };
      headerTouched = !!h && h.version !== meta!.headerVersion;
    }
    seen = here.filter((f) => !f.removed).flatMap((f) => {
      const key = keyOfName(f.name);
      return key ? [{ key, file: f }] : [];
    });
    packs = here.filter((f) => !f.removed).flatMap((f) => packOf(f) ?? []);
  }

  // 2. Cabeçalho.
  const warnings: string[] = [];
  const localHeader = canonicalJson(header);
  let newHeader: VaultHeader | null = null;
  if (!headerFile) {
    headerFile = await drive.create(folderId, HEADER_FILE, localHeader);
  } else {
    const remoteCanon = headerTouched ? canonicalJson(JSON.parse(await drive.read(headerFile.id)) as VaultHeader) : meta!.headerSynced;
    const remote = JSON.parse(remoteCanon) as VaultHeader;
    if (remote.vaultId !== header.vaultId) {
      throw new SyncError('O Drive dessa conta Google já guarda outro cofre do Ficha Redonda.', 'outro-cofre');
    }
    const changedHere = !!meta && localHeader !== meta.headerSynced;
    const changedThere = !!meta && headerTouched && remoteCanon !== meta.headerSynced;
    if (remoteCanon !== localHeader) {
      if (changedHere && changedThere) {
        warnings.push('A senha ou um código foi trocado neste aparelho e em outro ao mesmo tempo. Valeu a troca deste aparelho.');
        headerFile = await drive.update(headerFile.id, localHeader);
      } else if (changedHere) {
        headerFile = await drive.update(headerFile.id, localHeader);
      } else {
        newHeader = remote;
        await db.setHeader(remote);
      }
    }
  }

  // 3. Baixa os lotes que este aparelho não tem (vários ao mesmo tempo).
  const localKeys = new Set(await db.batchKeys());
  const missing = new Map<string, DriveFile>();
  for (const s of seen) if (!localKeys.has(s.key) && !missing.has(s.key)) missing.set(s.key, s.file);
  const downloaded = await fetchMissing(drive, missing, packs);
  if (downloaded.length) {
    await verify(downloaded);
    await db.putBatches(downloaded);
  }
  if (!full) await db.markRemote(seen.map((s) => ({ key: s.key, fileId: s.file.id })));

  // 4. Sobe a fila: lotes deste aparelho que o índice não tem. Cada um entra no índice ao subir,
  // então uma queda no meio não repete o que já foi.
  const pending = await db.pendingUploads();
  let uploaded = 0;
  for (let i = 0; i < pending.length; i += 200) {
    const chunk = await db.getBatches(pending.slice(i, i + 200));
    await pool(chunk, PARALLEL, async (b) => {
      const f = await drive.create(folderId, batchFile(b), batchContent(b));
      await db.markRemote([{ key: b.key, fileId: f.id } satisfies RemoteFile]);
      uploaded++;
    });
  }

  // 5. Pacotes dos lotes deste aparelho, para um aparelho novo baixar tudo em poucos arquivos.
  const device = await db.getDeviceId();
  const packedTo = await packOwn(db, drive, folderId, device, meta?.packedTo ?? 0);

  const finalHeader = canonicalJson(newHeader ?? header);
  const now = new Date().toISOString();
  await db.setSync({ email, folderId, headerFileId: headerFile.id, headerSynced: finalHeader, headerVersion: headerFile.version, lastSync: now, pageToken, lastFull: full ? now : meta?.lastFull, packedTo });
  return { uploaded, downloaded, header: newHeader, warnings, full };
}

/** Aparelho novo: baixa o cofre do Drive (ainda trancado; abre com a senha ou um código). */
export async function pullVault(db: LocalDb, drive: DriveStore, email: string): Promise<boolean> {
  const folderId = await drive.findFolder(FOLDER_NAME);
  if (!folderId) return false;
  const pageToken = await drive.startPageToken();
  const files = await drive.list(folderId);
  const headerFile = files.find((f) => f.name === HEADER_FILE);
  if (!headerFile) return false;
  const headerText = await drive.read(headerFile.id);
  const header = JSON.parse(headerText) as VaultHeader;
  if (!header.vaultId || !Array.isArray(header.wrappers)) throw new SyncError('O cofre no Drive está incompleto.');
  const batchFiles = files.filter((f) => BATCH_RE.test(f.name));
  const batches = await fetchMissing(drive, new Map(batchFiles.map((f) => [keyOfName(f.name)!, f])), files.flatMap((f) => packOf(f) ?? []));
  await db.wipe();
  await db.setHeader(header);
  await db.putBatches(batches);
  await db.markRemote(batchFiles.map((f) => ({ key: keyOfName(f.name)!, fileId: f.id })));
  const now = new Date().toISOString();
  await db.setSync({ email, folderId, headerFileId: headerFile.id, headerSynced: canonicalJson(header), headerVersion: headerFile.version, lastSync: now, pageToken, lastFull: now });
  return true;
}
