/**
 * Quando sincronizar, sem o dono precisar tocar em nada.
 *
 * - Depois de cada mudança espera um pouco (2 s) e junta o que vier junto num envio só.
 *   Se as mudanças não param, envia no máximo 10 s depois da primeira.
 * - Busca o que mudou em outros aparelhos ao abrir, ao voltar para o app e a cada minuto.
 * - Ao esconder o app (trocar de aba, bloquear o celular), envia na hora o que estiver esperando.
 * - Se falhar, tenta de novo em 5 s, 30 s, 2 min e depois a cada 10 min. A volta da internet
 *   tenta na hora.
 * - Só uma sincronização por vez; um pedido no meio de outra roda logo depois dela.
 *
 * A fila em si é o índice no aparelho (lotes que ainda não estão no Drive), então nada se
 * perde se o app fechar com mudanças esperando: elas sobem na próxima abertura.
 */

export const DEBOUNCE_MS = 2_000;
export const MAX_WAIT_MS = 10_000;
export const POLL_MS = 60_000;
export const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000];

export type AutoStatus =
  /** Ainda não sincronizou nesta abertura. */
  | { kind: 'iniciando'; pending: number }
  | { kind: 'em-dia'; at: string }
  | { kind: 'enviando'; pending: number }
  | { kind: 'sem-internet'; pending: number }
  /** O login do Google precisa de um toque (venceu e não deu para renovar sozinho). */
  | { kind: 'entrar'; pending: number }
  | { kind: 'erro'; message: string; pending: number; retryAt: number | null };

/** O login precisa de um toque: o agendador para até `now()` ser chamado de novo. */
export class NeedLogin extends Error {}
/** Sem internet ou o Google não respondeu. */
export class Offline extends Error {}
/** Erro que tentar de novo não resolve (outro cofre, outra conta): espera o dono. */
export class Fatal extends Error {}

export interface SchedulerDeps {
  run(): Promise<void>;
  pending(): Promise<number>;
  status(s: AutoStatus): void;
  /** Mensagem simples para um erro qualquer. */
  describe(e: unknown): string;
  visible?(): boolean;
  timers?: { set(fn: () => void, ms: number): unknown; clear(t: unknown): void; now(): number };
}

const realTimers = {
  set: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clear: (t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export class SyncScheduler {
  private timer: unknown = null;
  private pollTimer: unknown = null;
  private running = false;
  private again = false;
  private failures = 0;
  private firstChange: number | null = null;
  private waitingLogin = false;
  private stopped = true;
  private current: AutoStatus = { kind: 'iniciando', pending: 0 };
  private readonly t: NonNullable<SchedulerDeps['timers']>;

  constructor(private deps: SchedulerDeps) {
    this.t = deps.timers ?? realTimers;
  }

  get status(): AutoStatus {
    return this.current;
  }

  get busy(): boolean {
    return this.running;
  }

  /** Começa: sincroniza já (traz o que mudou fora) e liga a busca periódica. */
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
    this.armPoll();
  }

  stop() {
    this.stopped = true;
    if (this.timer) this.t.clear(this.timer);
    if (this.pollTimer) this.t.clear(this.pollTimer);
    this.timer = this.pollTimer = null;
  }

  /** Houve uma mudança neste aparelho. */
  changed() {
    if (this.stopped) return;
    const now = this.t.now();
    this.firstChange ??= now;
    const wait = Math.max(0, Math.min(DEBOUNCE_MS, this.firstChange + MAX_WAIT_MS - now));
    void this.deps.pending().then((n) => {
      if (n > 0 && (this.current.kind === 'em-dia' || this.current.kind === 'enviando' || this.current.kind === 'iniciando')) this.set({ kind: 'enviando', pending: n });
      else if (n > 0 && 'pending' in this.current) this.set({ ...this.current, pending: n });
    });
    // Esperando login ou em pausa depois de erro: a mudança fica na fila e vai junto na próxima vez.
    if (this.waitingLogin || (this.current.kind === 'erro' && this.failures > 0) || this.current.kind === 'sem-internet') return;
    this.schedule(wait);
  }

  /** Sincroniza agora (toque do dono, volta da internet, app escondido ou login feito). */
  now() {
    if (this.stopped) return;
    this.waitingLogin = false;
    this.failures = 0;
    this.schedule(0);
  }

  /** Voltou a ver o app: busca o que mudou fora. Escondeu: envia o que estiver esperando. */
  visibility(visible: boolean) {
    if (this.stopped || this.waitingLogin) return;
    if (visible) this.schedule(0);
    else if (this.firstChange !== null) this.schedule(0);
  }

  private set(s: AutoStatus) {
    this.current = s;
    this.deps.status(s);
  }

  private schedule(ms: number) {
    if (this.timer) this.t.clear(this.timer);
    this.timer = this.t.set(() => {
      this.timer = null;
      void this.tick();
    }, ms);
  }

  private armPoll() {
    if (this.pollTimer) this.t.clear(this.pollTimer);
    this.pollTimer = this.t.set(() => {
      this.pollTimer = null;
      if (this.stopped) return;
      const visible = this.deps.visible?.() ?? true;
      // Em pausa (erro, sem internet ou esperando login) quem manda é a nova tentativa, não a busca.
      if (visible && !this.waitingLogin && this.failures === 0 && !this.timer) void this.tick();
      this.armPoll();
    }, POLL_MS);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    this.firstChange = null;
    try {
      const n = await this.deps.pending();
      if (n > 0) this.set({ kind: 'enviando', pending: n });
      await this.deps.run();
      this.failures = 0;
      const left = await this.deps.pending();
      // Uma mudança feita durante o envio: entra logo em seguida.
      if (left > 0) this.again = true;
      else this.set({ kind: 'em-dia', at: new Date(this.t.now()).toISOString() });
    } catch (e) {
      const pending = await this.deps.pending().catch(() => 0);
      if (e instanceof NeedLogin) {
        this.waitingLogin = true;
        this.set({ kind: 'entrar', pending });
      } else if (e instanceof Fatal) {
        this.waitingLogin = true; // não tenta sozinho: o dono decide
        this.set({ kind: 'erro', message: this.deps.describe(e), pending, retryAt: null });
      } else {
        const wait = BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length - 1)]!;
        this.failures++;
        this.set(e instanceof Offline ? { kind: 'sem-internet', pending } : { kind: 'erro', message: this.deps.describe(e), pending, retryAt: this.t.now() + wait });
        this.again = false;
        this.schedule(wait);
      }
    } finally {
      this.running = false;
      if (this.again && !this.stopped) {
        this.again = false;
        if (!this.waitingLogin && this.failures === 0) this.schedule(0);
      }
    }
  }
}
