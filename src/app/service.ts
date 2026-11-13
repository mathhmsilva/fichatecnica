import {
  createVault, unlockVault, enrollDevice, unlockWithPin, verifyRecoveryCode, changePassword, replaceRecoveryCode,
  seal, open as openSealed, type VaultHeader, type DeviceUnlock, type PinResult, type Sealed,
} from '../crypto/vault';
import { makeEvents, verifyChain, orderEvents, type EventData, type StoredEvent, type Settings, type ImportRecord, type ChainProblem } from '../store/events';
import { applyEvent, cloneState, emptyState, replay, type State } from '../store/state';
import { LocalDb, decryptBatches, openSnapshot, sealSnapshot, type BackupFile } from '../store/localdb';
import { pullVault, syncVault, type SyncResult } from '../sync/sync';
import type { DriveStore } from '../sync/drive';
import {
  Custos, calcularPizza, engenharia, pendencias,
  type Canal, type Catalogo, type Compra, type Config, type Insumo, type Pendencia, type Pizza, type PizzaCalculada, type Preparo, type Venda,
} from '../domain/ficha';
import type { IsoDate } from '../domain/date';

/** Lotes depois do retrato a partir dos quais vale refazer o retrato ao abrir. */
const SNAPSHOT_AFTER = 100;

export type Listener = () => void;

/** Id novo com prefixo e parte aleatória: dois aparelhos sem rede nunca criam o mesmo. */
export const novoId = (prefixo: string) => `${prefixo}-${crypto.randomUUID().slice(0, 8)}`;

const hojeIso = (): IsoDate => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Contas derivadas do catálogo, refeitas só quando o catálogo muda. */
interface Derivado {
  catalogo: Catalogo;
  custos: Custos;
  pizzas: Map<string, PizzaCalculada>;
  pendencias: Pendencia[];
}

/**
 * Sessão aberta do cofre. Guarda a chave só em memória; `lock()` descarta tudo.
 * Toda mudança vira um evento encadeado e cifrado antes de ir para o banco local.
 */
export class Session {
  state: State = emptyState();
  events: StoredEvent[] = [];
  chainProblems: ChainProblem[] = [];
  private listeners = new Set<Listener>();
  private derivado: Derivado | null = null;

  private constructor(
    private db: LocalDb,
    public header: VaultHeader,
    private key: CryptoKey,
    public deviceId: string,
  ) {}

  // ----- abrir e criar -----

  static async create(db: LocalDb, password: string, settings: Settings) {
    const vault = await createVault(password);
    const deviceId = await db.getDeviceId();
    await db.setHeader(vault.header);
    const s = new Session(db, vault.header, vault.key, deviceId);
    await s.dispatch([{ type: 'setup', settings }]);
    return { session: s, recoveryCodes: vault.recoveryCodes };
  }

  static async unlock(db: LocalDb, secret: string, kind: 'senha' | 'recuperacao'): Promise<Session | null> {
    const header = await db.getHeader();
    if (!header) return null;
    const v = await unlockVault(header, secret, kind);
    if (!v) return null;
    return Session.load(db, header, v.key);
  }

  static async unlockPin(db: LocalDb, pin: string): Promise<{ session: Session | null; result: PinResult }> {
    const header = await db.getHeader();
    const device = await db.getDevice();
    if (!header || !device) return { session: null, result: { ok: false, attemptsLeft: 0 } };
    const result = await unlockWithPin(device, pin);
    if (!result.ok) {
      // Depois de 5 erros, o embrulho do PIN é apagado e só a senha forte abre.
      await db.setDevice(result.attemptsLeft === 0 ? null : device);
      return { session: null, result };
    }
    await db.setDevice(device);
    return { session: await Session.load(db, header, result.key), result };
  }

  private static async load(db: LocalDb, header: VaultHeader, key: CryptoKey): Promise<Session> {
    const s = new Session(db, header, key, await db.getDeviceId());
    // Com retrato: um bloco com quase tudo, mais os lotes que chegaram depois dele.
    const snap = await db.getSnapshot();
    let base: StoredEvent[] = [];
    let upTo: Record<string, number> = {};
    if (snap) {
      try {
        base = await openSnapshot(key, header.vaultId, snap);
        upTo = snap.upTo;
      } catch {
        base = []; // retrato ilegível: abre pelos lotes, como sem retrato
      }
    }
    const ranges = await db.batchRanges();
    const rest = ranges.filter((b) => b.toSeq > (upTo[b.device] ?? 0)).map((b) => b.key);
    const after = await decryptBatches(key, header.vaultId, await db.getBatches(rest));
    const seen = new Set(base.map((e) => e.id));
    s.events = orderEvents([...base, ...after.filter((e) => !seen.has(e.id))]);
    s.chainProblems = await verifyChain(s.events, upTo);
    s.state = replay(s.events);
    if (rest.length >= SNAPSHOT_AFTER && !s.chainProblems.length) void s.saveSnapshot();
    return s;
  }

  /** Guarda o retrato deste aparelho (em segundo plano: o cofre já está aberto). */
  async saveSnapshot(): Promise<void> {
    const key = this.key as CryptoKey | null;
    if (!key || this.chainProblems.length) return;
    try {
      await this.db.setSnapshot(await sealSnapshot(key, this.header.vaultId, this.events));
    } catch {
      // Sem retrato o cofre só abre mais devagar.
    }
  }

  lock() {
    // Descarta a referência à chave e aos dados decifrados.
    (this as unknown as { key: CryptoKey | null }).key = null;
    this.state = emptyState();
    this.events = [];
    this.derivado = null;
    this.listeners.clear();
  }

  /** Cifra com a chave do cofre algo que fica só neste aparelho, fora dos eventos. */
  sealLocal(data: unknown, purpose: string): Promise<Sealed> {
    return seal(this.key, data, `ficharedonda|${this.header.vaultId}|local|${purpose}`);
  }

  openLocal<T>(sealed: Sealed, purpose: string): Promise<T> {
    return openSealed<T>(this.key, sealed, `ficharedonda|${this.header.vaultId}|local|${purpose}`);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  async dispatch(items: EventData[]): Promise<void> {
    if (items.length === 0) return;
    const head = this.state.heads[this.deviceId] ?? null;
    const seen = Object.fromEntries(Object.entries(this.state.heads).filter(([d]) => d !== this.deviceId).map(([d, h]) => [d, h.seq]));
    // Cada ação tem um horário só dela, e depois de tudo o que já existe.
    const last = this.events.length ? Date.parse(this.events[this.events.length - 1]!.at) : 0;
    const evs = await makeEvents(this.deviceId, head, items, new Date(Math.max(Date.now(), last + 1)), seen);
    await this.db.appendEvents(this.key, this.header.vaultId, evs);
    this.events.push(...evs);
    // Aplica numa cópia: o estado que a tela tem continua igual, e o novo é outra referência.
    let next = cloneState(this.state);
    for (const e of evs) next = applyEvent(next, e);
    this.state = next;
    this.emit();
  }

  // ----- consultas -----

  get catalogo(): Catalogo {
    return this.state.catalogo;
  }

  private calc(): Derivado {
    const cat = this.state.catalogo;
    if (this.derivado?.catalogo === cat) return this.derivado;
    const custos = new Custos(cat);
    const pizzas = new Map(cat.pizzas.map((p) => [p.id, calcularPizza(p, cat, custos)]));
    this.derivado = { catalogo: cat, custos, pizzas, pendencias: pendencias(cat, hojeIso(), custos) };
    return this.derivado;
  }

  custos(): Custos {
    return this.calc().custos;
  }

  pizza(id: string): PizzaCalculada | undefined {
    return this.calc().pizzas.get(id);
  }

  pizzasCalculadas(): Map<string, PizzaCalculada> {
    return this.calc().pizzas;
  }

  pendencias(): Pendencia[] {
    return this.calc().pendencias;
  }

  /** Pizzas e preparos que usam um insumo ou preparo (direto). */
  ondeUsa(ref: string): { pizzas: Pizza[]; preparos: Preparo[] } {
    const cat = this.state.catalogo;
    return {
      pizzas: cat.pizzas.filter((p) => p.linhas.some((l) => l.ref === ref || l.refG === ref)),
      preparos: cat.preparos.filter((p) => p.itens.some((i) => i.ref === ref)),
    };
  }

  engenharia(periodo: string, canal?: string) {
    const vendas = this.state.catalogo.vendas.filter((v) => (periodo === 'todos' || v.periodo === periodo) && (!canal || v.canal === canal));
    return engenharia(vendas, this.calc().pizzas);
  }

  periodosComVenda(): string[] {
    return [...new Set(this.state.catalogo.vendas.map((v) => v.periodo))].sort().reverse();
  }

  // ----- cadastros -----

  async importCatalog(catalog: Catalogo, fileName: string) {
    const record: ImportRecord = { at: new Date().toISOString(), fileName, pizzas: catalog.pizzas.length, insumos: catalog.insumos.length, preparos: catalog.preparos.length };
    await this.dispatch([{ type: 'catalog.import', catalog, record }]);
  }

  saveInsumo(insumo: Insumo) {
    return this.dispatch([{ type: 'insumo.save', insumo }]);
  }

  async removeInsumo(id: string) {
    const uso = this.ondeUsa(id);
    if (uso.pizzas.length || uso.preparos.length) throw new Error(`Esse insumo ainda está em ${[...uso.pizzas, ...uso.preparos].map((x) => x.nome).join(', ')}. Tire de lá antes de apagar.`);
    await this.dispatch([{ type: 'insumo.remove', id }]);
  }

  savePreparo(preparo: Preparo) {
    return this.dispatch([{ type: 'preparo.save', preparo }]);
  }

  async removePreparo(id: string) {
    const uso = this.ondeUsa(id);
    if (uso.pizzas.length || uso.preparos.length) throw new Error(`Esse preparo ainda está em ${[...uso.pizzas, ...uso.preparos].map((x) => x.nome).join(', ')}. Tire de lá antes de apagar.`);
    await this.dispatch([{ type: 'preparo.remove', id }]);
  }

  savePizza(pizza: Pizza) {
    return this.dispatch([{ type: 'pizza.save', pizza }]);
  }

  removePizza(id: string) {
    return this.dispatch([{ type: 'pizza.remove', id }]);
  }

  saveCanal(canal: Canal) {
    return this.dispatch([{ type: 'canal.save', canal }]);
  }

  setConfig(config: Partial<Config>) {
    return this.dispatch([{ type: 'config.set', config }]);
  }

  addCompra(compra: Compra, atualizar = true) {
    return this.dispatch([{ type: 'compra.add', compra, atualizar }]);
  }

  removeCompra(id: string) {
    return this.dispatch([{ type: 'compra.remove', id }]);
  }

  setVendas(periodo: string, vendas: Venda[]) {
    return this.dispatch([{ type: 'vendas.set', periodo, vendas }]);
  }

  async updateSettings(settings: Partial<Settings>) {
    await this.dispatch([{ type: 'settings.set', settings }]);
  }

  // ----- operações sensíveis: pedem a senha forte -----

  /**
   * Apaga tudo deste aparelho: cofre e PIN. Pede a senha do cofre (ou um código de recuperação).
   * Com `drive`, a pasta do cofre no Drive vai para a lixeira antes.
   */
  async resetEverything(secret: string, drive?: { trash(fileId: string): Promise<void> }): Promise<{ driveTrashed: boolean }> {
    const ok = (await unlockVault(this.header, secret, 'senha')) ?? (await unlockVault(this.header, secret, 'recuperacao').catch(() => null));
    if (!ok) throw new Error('Senha do cofre (ou código de recuperação) incorreta. Nada foi apagado.');
    const meta = await this.db.getSync();
    let driveTrashed = false;
    if (drive && meta?.folderId) {
      await drive.trash(meta.folderId);
      driveTrashed = true;
    }
    await this.db.wipe();
    this.lock();
    return { driveTrashed };
  }

  private async requirePassword(password: string) {
    const ok = await unlockVault(this.header, password, 'senha');
    if (!ok) throw new Error('Senha do cofre incorreta.');
  }

  async exportBackup(password: string): Promise<BackupFile> {
    await this.requirePassword(password);
    return { app: 'ficharedonda', format: 1, createdAt: new Date().toISOString(), header: this.header, batches: await this.db.allBatches() };
  }

  async rememberDevice(password: string, pin: string) {
    const device: DeviceUnlock = await enrollDevice(this.header, password, pin, this.deviceId);
    await this.db.setDevice(device);
  }

  /**
   * Sincroniza com o Drive e, se vieram lotes de outro aparelho, refaz o estado.
   * Lotes baixados são decifrados antes de gravar: um arquivo mexido no Drive é recusado.
   */
  async sync(drive: DriveStore, email: string, opts: { full?: boolean } = {}): Promise<SyncResult> {
    let arrived: StoredEvent[] = [];
    const result = await syncVault(this.db, drive, email, async (batches) => {
      arrived = await decryptBatches(this.key, this.header.vaultId, batches);
    }, opts);
    if (result.header) this.header = result.header;
    if (arrived.length && this.key) {
      const have = new Set(this.events.map((e) => e.id));
      this.events = orderEvents([...this.events, ...arrived.filter((e) => !have.has(e.id))]);
      this.chainProblems = await verifyChain(this.events);
      this.state = replay(this.events);
      this.emit();
    }
    return result;
  }

  /** Quantas mudanças deste aparelho ainda não foram para o Drive. */
  async pendingUploads(): Promise<number> {
    return (await this.db.pendingUploads()).length;
  }

  syncInfo() {
    return this.db.getSync();
  }

  async disconnectSync() {
    await this.db.setSync(null);
  }

  /** Troca o cofre deste aparelho pelo cofre guardado no Drive (abre depois com a senha dele). */
  async replaceWithDriveVault(drive: DriveStore, email: string) {
    const ok = await pullVault(this.db, drive, email);
    if (!ok) throw new Error(`Não achei um cofre no Drive de ${email}.`);
    this.lock();
  }

  async hasDevice(): Promise<boolean> {
    return !!(await this.db.getDevice());
  }

  async forgetDevice() {
    await this.db.setDevice(null);
  }

  async testRecovery(code: string): Promise<boolean> {
    const id = await verifyRecoveryCode(this.header, code);
    if (id) await this.dispatch([{ type: 'recovery.tested', wrapperId: id }]);
    return !!id;
  }

  async changePassword(current: string, next: string) {
    this.header = await changePassword(this.header, current, 'senha', next);
    await this.db.setHeader(this.header);
    await this.db.setDevice(null); // o PIN foi embrulhado com a chave antiga do aparelho: cadastre de novo
  }

  async replaceRecovery(password: string, wrapperId: string): Promise<string> {
    const { header, code } = await replaceRecoveryCode(this.header, password, wrapperId);
    this.header = header;
    await this.db.setHeader(header);
    return code;
  }
}

/** Restaura uma cópia de segurança neste aparelho (substitui o que houver). */
export async function restoreBackup(db: LocalDb, backup: BackupFile, secret: string, kind: 'senha' | 'recuperacao'): Promise<Session | null> {
  if (backup.app !== 'ficharedonda' || backup.format !== 1) throw new Error('Este arquivo não é uma cópia do Ficha Redonda.');
  const v = await unlockVault(backup.header, secret, kind);
  if (!v) return null;
  await decryptBatches(v.key, backup.header.vaultId, backup.batches); // confere antes de apagar o que existe
  await db.wipe();
  await db.setHeader(backup.header);
  await db.putBatches(backup.batches);
  return Session.unlock(db, secret, kind);
}
