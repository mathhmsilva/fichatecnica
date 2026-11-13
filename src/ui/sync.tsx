import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Session } from '../app/service';
import { GOOGLE_CLIENT_ID } from '../config';
import { GoogleDrive, googleEmail, DriveError } from '../sync/drive';
import { forgetGoogleLogin, renewGoogleToken, requestGoogleToken, type GoogleToken } from '../sync/oauth';
import { pullVault, SyncError, type SyncMeta } from '../sync/sync';
import { Fatal, NeedLogin, Offline, SyncScheduler, type AutoStatus } from '../sync/scheduler';
import type { LocalDb } from '../store/localdb';
import { Section } from './common';
import { askConfirm, notify } from './feedback';
import { Icon } from './Icon';

/**
 * Conexão com o Google e sincronização automática. O token de acesso fica só em memória
 * (some ao travar ou fechar o app). Com a renovação ligada no servidor, um token novo vem
 * sozinho quando o anterior vence, sem janela; sem ela, o dono toca para entrar a cada hora.
 */
type Token = (GoogleToken & { email: string }) | null;

interface Snapshot {
  token: Token;
  auto: AutoStatus;
  /** A conta Google escolhida já guarda outro cofre no Drive: o dono decide. */
  outro: string | null;
  /** O que a última sincronização trouxe ou levou, em palavras. */
  detail: string;
  /** Primeira vez guardando no Drive, ou outra ação manual em andamento. */
  manual: boolean;
}

/** O token do Google ainda vale? (Fora dos componentes: depende da hora, não do que está na tela.) */
const tokenLive = (tk: Token): tk is NonNullable<Token> => !!tk && tk.expiresAt > Date.now();
let token: Token = null;
let renewal: 'unknown' | 'on' | 'off' = 'unknown';
let snapshot: Snapshot = { token, auto: { kind: 'iniciando', pending: 0 }, outro: null, detail: '', manual: false };
const listeners = new Set<() => void>();
const publish = (patch: Partial<Snapshot>) => {
  snapshot = { ...snapshot, token, ...patch };
  listeners.forEach((l) => l());
};

export const driveConfigured = () => !!GOOGLE_CLIENT_ID;
const tokenValid = () => tokenLive(token);

export function useDriveStatus() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
  );
}

export const changes = (n: number) => (n === 1 ? '1 mudança' : `${n} mudanças`);

/**
 * Token válido sem abrir janela: o que está na memória ou um novo pelo servidor.
 * null quando precisa de um toque. Lança Offline se o servidor não respondeu.
 */
async function silentToken(expectedEmail?: string): Promise<string | null> {
  if (tokenValid()) return token!.accessToken;
  if (renewal === 'off') return null;
  const r = await renewGoogleToken();
  if (r.kind === 'off') renewal = 'off';
  if (r.kind === 'retry') throw new Offline('Sem resposta do servidor.');
  if (r.kind !== 'ok') return null;
  renewal = 'on';
  if (expectedEmail && r.email !== expectedEmail) return null; // login guardado é de outra conta
  token = { ...r.token, email: r.email };
  publish({});
  return token.accessToken;
}

/** Conecta (abre a janela do Google). Precisa vir de um toque do usuário. */
export async function connectGoogle(expectedEmail?: string, opts: { folders?: boolean } = {}): Promise<{ accessToken: string; email: string }> {
  const t = await requestGoogleToken(expectedEmail, opts);
  const email = await googleEmail(t.accessToken);
  if (expectedEmail && email !== expectedEmail) throw new Error(`Entre com a conta ${expectedEmail}, que é a deste cofre.`);
  token = { ...t, email };
  publish({});
  return { accessToken: t.accessToken, email };
}

/** Token do Google válido; renova sozinho ou abre o login se preciso (só a partir de um toque). */
export async function googleAccessToken(session: Session): Promise<string> {
  const meta = await session.syncInfo();
  const silent = await silentToken(meta?.email).catch(() => null);
  if (silent) return silent;
  const t = await connectGoogle(meta?.email);
  scheduler?.now(); // o login voltou: a fila sobe
  return t.accessToken;
}

const friendly = (x: unknown) => {
  if (!navigator.onLine) return 'Sem internet agora. O app guarda tudo aqui e sincroniza quando a conexão voltar.';
  const m = (x as Error).message ?? '';
  if (/fetch|network/i.test(m)) return 'Não consegui falar com o Google. Confira a internet e tente de novo.';
  // Mensagens nossas (em português) passam; erro interno vira texto simples, com o detalhe no console.
  if (x instanceof SyncError || x instanceof DriveError || x instanceof Fatal || /[ãçéêíóõú]|\b(n[aã]o|conta|cofre|senha|arquivo)\b/i.test(m)) return m;
  console.error(x);
  return 'Algo deu errado ao falar com o Google Drive. Tente de novo; se continuar, saia e entre de novo na conta.';
};

/** Uma sincronização com o token dado; guarda em palavras o que aconteceu. */
async function syncWith(session: Session, accessToken: string, email: string): Promise<void> {
  const r = await session.sync(new GoogleDrive(accessToken), email);
  const parts = [];
  if (r.uploaded) parts.push(`${changes(r.uploaded)} ${r.uploaded === 1 ? 'guardada' : 'guardadas'} no Drive`);
  if (r.downloaded.length) parts.push('Chegaram mudanças feitas em outro aparelho');
  if (r.header) parts.push('senha ou códigos atualizados');
  const detail = [...parts, ...r.warnings].join('. ');
  if (detail) publish({ detail });
}

/** Erros da sincronização no formato que o agendador entende (tentar de novo, pedir login ou parar). */
function classify(x: unknown): Error {
  if (x instanceof SyncError && x.code === 'outro-cofre') {
    publish({ outro: token?.email ?? '' });
    return new Fatal(x.message);
  }
  if (x instanceof SyncError && x.code === 'outra-conta') return new Fatal(x.message);
  if (x instanceof DriveError && x.status === 401) return new NeedLogin(x.message);
  if (!navigator.onLine || (x instanceof TypeError && /fetch|network|load/i.test(x.message))) return new Offline((x as Error).message ?? 'Sem internet.');
  return x instanceof Error ? x : new Error(String(x));
}

/** O que o agendador roda: pega o token sem janela e sincroniza. Sem cofre no Drive, não faz nada. */
async function runSync(session: Session): Promise<void> {
  const meta = await session.syncInfo();
  if (!meta || snapshot.outro) return;
  if (!navigator.onLine) throw new Offline('Sem internet.');
  let tk = await silentToken(meta.email);
  if (!tk) throw new NeedLogin('Entre com Google de novo.');
  try {
    await syncWith(session, tk, meta.email);
  } catch (x) {
    if (!(x instanceof DriveError && x.status === 401)) throw classify(x);
    // O Google recusou o token antes da hora: renova uma vez e tenta de novo.
    token = null;
    tk = await silentToken(meta.email);
    if (!tk) throw new NeedLogin('Entre com Google de novo.');
    await syncWith(session, tk, meta.email).catch((y) => {
      throw classify(y);
    });
  }
}

// ---------- agendador (um por cofre aberto) ----------

let scheduler: SyncScheduler | null = null;
let scheduled: Session | null = null;
let unwire: (() => void) | null = null;

function startAuto(session: Session) {
  if (scheduler && scheduled === session) return;
  stopAuto();
  scheduled = session;
  const sch = new SyncScheduler({
    run: () => runSync(session),
    pending: async () => ((await session.syncInfo()) ? session.pendingUploads() : 0),
    status: (auto) => publish({ auto }),
    describe: friendly,
    visible: () => document.visibilityState === 'visible',
  });
  scheduler = sch;
  const onVisibility = () => sch.visibility(document.visibilityState === 'visible');
  const onOnline = () => sch.now();
  const onHide = () => sch.visibility(false);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);
  window.addEventListener('pagehide', onHide);
  unwire = () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('pagehide', onHide);
  };
  sch.start();
}

function stopAuto() {
  scheduler?.stop();
  unwire?.();
  scheduler = scheduled = null;
  unwire = null;
}

/** Ao travar: esquece o token e para o agendador. */
export function forgetGoogleToken() {
  token = null;
  stopAuto();
  publish({ auto: { kind: 'iniciando', pending: 0 }, outro: null, detail: '', manual: false });
}

/**
 * Sincronizar agora. Com `interactive` (um toque), abre o login se preciso. Na primeira vez,
 * guarda o cofre no Drive; depois disso, o agendador cuida sozinho.
 */
export async function syncNow(session: Session, interactive: boolean): Promise<void> {
  if (snapshot.manual) return;
  const meta = await session.syncInfo();
  try {
    if (!tokenValid()) {
      const silent = await silentToken(meta?.email).catch(() => null);
      if (!silent) {
        if (!interactive) return;
        await connectGoogle(meta?.email);
      }
    }
    if (meta) {
      publish({ outro: null });
      startAuto(session);
      scheduler!.now();
      return;
    }
    publish({ manual: true, outro: null });
    await syncWith(session, token!.accessToken, token!.email);
    publish({ manual: false, auto: { kind: 'em-dia', at: new Date().toISOString() } });
    startAuto(session);
  } catch (x) {
    const e = classify(x);
    publish({ manual: false, auto: { kind: 'erro', message: friendly(e), pending: 0, retryAt: null } });
  }
}

/**
 * Entrar com Google (ou trocar de conta): abre a escolha de conta e sincroniza com o Drive dela.
 * Se for outra conta, este aparelho deixa de sincronizar com a anterior; os dados ficam aqui e no Drive antigo.
 */
export async function signInGoogle(session: Session): Promise<void> {
  const meta = await session.syncInfo();
  try {
    const t = await requestGoogleToken(); // sempre mostra a escolha de conta
    const email = await googleEmail(t.accessToken);
    if (meta && meta.email !== email) {
      stopAuto();
      await session.disconnectSync();
    }
    token = { ...t, email };
    renewal = 'unknown';
  } catch (x) {
    return publish({ auto: { kind: 'erro', message: friendly(x), pending: 0, retryAt: null } });
  }
  publish({ outro: null, detail: '' });
  await syncNow(session, false);
}

/** Sair da conta Google neste aparelho. Os dados continuam aqui e no Drive. */
export async function signOutGoogle(session: Session): Promise<void> {
  const t = token;
  stopAuto();
  await session.disconnectSync();
  token = null;
  renewal = 'unknown';
  publish({ auto: { kind: 'iniciando', pending: 0 }, outro: null, detail: '', manual: false });
  await forgetGoogleLogin(t?.accessToken);
}

/** Troca o cofre deste aparelho pelo que está no Drive da conta escolhida, e volta para a tela de entrada. */
export async function openDriveVault(session: Session, onLock: () => void): Promise<void> {
  if (!token) throw new Error('Entre com a conta Google de novo.');
  stopAuto();
  await session.replaceWithDriveVault(new GoogleDrive(token.accessToken), token.email);
  publish({ outro: null, auto: { kind: 'iniciando', pending: 0 } });
  onLock();
}

/**
 * Sincronização automática enquanto o cofre está aberto: começa ao abrir e avisa o agendador
 * de cada mudança. Só age depois que o dono escolheu guardar no Drive (entrar só para a IA
 * não manda o cofre para lá).
 */
export function useAutoSync(session: Session, stateVersion: unknown) {
  useEffect(() => {
    if (!driveConfigured()) return;
    startAuto(session);
    return () => {
      if (scheduled === session) stopAuto();
    };
  }, [session]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    scheduler?.changed();
  }, [stateVersion]);
}

function useSyncMeta(session: Session) {
  const snap = useDriveStatus();
  const [meta, setMeta] = useState<SyncMeta | null | undefined>(undefined);
  useEffect(() => {
    void session.syncInfo().then((m) => setMeta(m ?? null));
  }, [session, snap.auto.kind, snap.manual, snap.outro, snap.token]);
  return { ...snap, meta };
}

/** Texto curto do estado da nuvem. */
export function cloudText(auto: AutoStatus): string {
  switch (auto.kind) {
    case 'iniciando':
      return 'Conferindo o Drive…';
    case 'em-dia':
      return 'Tudo no Drive';
    case 'enviando':
      return `Enviando ${changes(auto.pending)}…`;
    case 'sem-internet':
      return auto.pending ? `Sem internet, ${changes(auto.pending)} esperando` : 'Sem internet agora';
    case 'entrar':
      return 'Precisa entrar de novo';
    case 'erro':
      return 'Problema na sincronização';
  }
}

/** Aviso no topo só quando o dono precisa agir: entrar de novo ou um erro que não passa sozinho. */
export function SyncBanner({ session }: { session: Session }) {
  const { auto, meta, outro } = useSyncMeta(session);
  if (!driveConfigured() || !meta || outro) return null;
  if (auto.kind === 'entrar') {
    return (
      <div className="notice no-print" role="status">
        <b>Drive</b>
        <span>
          O acesso ao Google venceu{auto.pending ? ` e ${changes(auto.pending)} ${auto.pending === 1 ? 'espera' : 'esperam'} para subir` : ''}. Nada se perde: fica guardado aqui.{' '}
          <button className="btn link" onClick={() => void syncNow(session, true)}>Entrar de novo</button>
        </span>
      </div>
    );
  }
  if (auto.kind === 'erro') {
    return (
      <div className="notice no-print" role="alert">
        <b>Drive</b>
        <span>
          {auto.message}
          {auto.retryAt ? ' O app tenta de novo sozinho.' : ''} <button className="btn link" onClick={() => void syncNow(session, true)}>Tentar agora</button>
        </span>
      </div>
    );
  }
  return null;
}

/**
 * No Início: o cofre não está guardado no Drive (nunca entrou, ou saiu da conta Google).
 * O aviso de "entrar de novo" quando o acesso venceu já aparece no topo de todas as telas.
 */
export function HomeDriveNotice({ session, onOpen }: { session: Session; onOpen: () => void }) {
  const { meta, manual, outro } = useSyncMeta(session);
  if (!driveConfigured() || meta !== null || manual || outro) return null;
  return (
    <div className="notice no-print" role="status">
      <b>Drive</b>
      <div className="stack gap-8">
        <span>Você está fora da conta Google: os dados ficam só neste aparelho e não sincronizam. Se o celular quebrar ou sumir, eles se perdem.</span>
        <div className="row">
          <button className="btn primary" onClick={() => void signInGoogle(session)}>Entrar com Google</button>
          <button className="btn link" onClick={onOpen}>Ver em Ajustes</button>
        </div>
      </div>
    </div>
  );
}

/** Estado da nuvem na barra de cima: toque leva para Ajustes, Conta Google. */
export function AccountChip({ session, onOpen, withLabel }: { session: Session; onOpen: () => void; withLabel?: boolean }) {
  const { token: tk, auto, meta, outro, manual } = useSyncMeta(session);
  if (!driveConfigured()) return null;
  const live = tokenLive(tk);
  const tone = outro ? 'erro'
    : !meta ? (manual ? 'busy' : live ? 'conectado' : 'fora')
    : auto.kind === 'em-dia' ? 'ok'
    : auto.kind === 'enviando' || auto.kind === 'iniciando' ? 'busy'
    : auto.kind === 'erro' ? 'erro' : 'pausa';
  const email = meta?.email ?? (live ? tk!.email : undefined);
  const text = outro ? 'Este Drive guarda outro cofre'
    : meta ? `${cloudText(auto)} (${meta.email})`
    : manual ? 'Guardando no Drive…'
    : live ? `Conta ${email ?? ''}: o cofre ainda não está no Drive` : 'Entrar com Google';
  const count = meta && 'pending' in auto && auto.pending > 0 && auto.kind !== 'iniciando' ? auto.pending : 0;
  return (
    <button type="button" className={`account-chip ${tone}`} onClick={onOpen} aria-label={text} title={text}>
      <Icon name="nuvem" size={20} />
      {withLabel || count === 0 ? <span className="dot" aria-hidden="true" /> : <span className="chip-count" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
      {withLabel && <span className="label-long">{meta ? cloudText(auto) : email ?? 'Entrar com Google'}</span>}
    </button>
  );
}

export function DriveSection({ session, onLock }: { session: Session; onLock: () => void }) {
  const { token: tk, auto, meta, outro, detail, manual } = useSyncMeta(session);
  const [busy, setBusy] = useState(false);

  if (!driveConfigured()) {
    return (
      <Section title="Conta Google" id="ajustes-drive">
        <p className="small muted">A entrada com Google ainda não foi ativada nesta instalação: falta o acesso ao Google Cloud. Enquanto isso, baixe a cópia de segurança uma vez por mês.</p>
      </Section>
    );
  }
  const live = tokenLive(tk);
  const email = meta?.email ?? (live ? tk!.email : null);
  const working = busy || manual || auto.kind === 'enviando';
  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const switchAccount = run(async () => {
    if (meta && !(await askConfirm('Entrar com outra conta Google?', { detail: `Este aparelho para de sincronizar com ${meta.email}. Nada é apagado: os dados continuam aqui e no Drive dessa conta.`, confirm: 'Escolher outra conta' }))) return;
    await signInGoogle(session);
  });
  const signOut = run(async () => {
    if (!(await askConfirm(`Sair da conta ${email ?? 'Google'}?`, { detail: 'Este aparelho para de sincronizar e a IA fica desligada até você entrar de novo. Nada é apagado: os dados continuam aqui e no Drive.', confirm: 'Sair da conta' }))) return;
    await signOutGoogle(session);
    notify('Você saiu da conta Google neste aparelho.');
  });
  const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const line = !meta ? 'Entrou (para a IA), mas o cofre ainda não foi para o Drive.'
    : auto.kind === 'em-dia' ? `Tudo no Drive. Cada mudança sobe sozinha em poucos segundos. Última sincronização: ${when(auto.at)}.`
    : auto.kind === 'iniciando' ? `Conferindo o Drive. Última sincronização: ${when(meta.lastSync)}.`
    : `${cloudText(auto)}. Última sincronização: ${when(meta.lastSync)}.`;

  return (
    <Section title="Conta Google" id="ajustes-drive">
      {outro !== null ? (
        <div className="stack">
          <p className="notice"><b>Atenção</b><span>O Drive de <b>{outro}</b> já guarda outro cofre do Ficha Redonda. Os dois não se misturam: escolha qual cofre usar neste aparelho.</span></p>
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={run(async () => {
              if (!(await askConfirm(`Abrir o cofre de ${outro} neste aparelho?`, { detail: 'O cofre que está aberto agora sai deste aparelho. Se ele não estiver no Drive de outra conta, baixe antes uma cópia de segurança (Ajustes, Segurança). Depois o app pede a senha do cofre do Drive.', confirm: 'Trocar de cofre', danger: true }))) return;
              await openDriveVault(session, onLock);
            })}>Usar o cofre de {outro}</button>
            <button className="btn" disabled={busy} onClick={switchAccount}>Escolher outra conta</button>
            <button className="btn link" disabled={busy} onClick={run(() => signOutGoogle(session))}>Cancelar</button>
          </div>
        </div>
      ) : email ? (
        <>
          <div className="account-card">
            <span className="avatar" aria-hidden="true">{email.slice(0, 1).toUpperCase()}</span>
            <div className="grow-1">
              <b className="wrap-any">{email}</b>
              <div className="small muted" role="status">{line}</div>
            </div>
          </div>
          {detail && auto.kind === 'em-dia' && <p className="small">{detail}.</p>}
          {auto.kind === 'erro' && <p className="error" role="alert">{auto.message}</p>}
          {auto.kind === 'entrar' && <p className="small" role="status">O acesso ao Google venceu. Toque em "Entrar de novo": o que está esperando sobe na hora.</p>}
          <div className="row">
            <button className="btn primary" disabled={working} onClick={() => void syncNow(session, true)}>
              {working ? 'Sincronizando…' : !meta ? 'Guardar no Drive' : auto.kind === 'entrar' ? 'Entrar de novo' : 'Sincronizar agora'}
            </button>
            <button className="btn" disabled={working} onClick={switchAccount}>Trocar de conta</button>
            <button className="btn link danger" disabled={working} onClick={signOut}>Sair da conta</button>
          </div>
          <details>
            <summary className="small">Como funciona com mais de um aparelho</summary>
            <ul className="small muted plain-list stack gap-6 mt-10">
              <li>Cada mudança sobe sozinha para o Drive poucos segundos depois. Sem internet, ela espera no aparelho e sobe quando a conexão voltar, mesmo que o app tenha sido fechado.</li>
              <li>O app busca o que mudou nos outros aparelhos ao abrir, ao voltar para ele e a cada minuto.</li>
              <li>Cada aparelho guarda só o que ele mesmo fez, em arquivos que nunca são reescritos. Por isso nada se perde quando dois aparelhos mexem ao mesmo tempo.</li>
              <li>O mesmo extrato enviado nos dois vira um lançamento só, sozinho.</li>
              <li>Se o mesmo lançamento for mudado nos dois antes de sincronizar, vale a mudança mais recente e ele aparece em Revisar, em "Mudado em dois aparelhos", para você escolher qual fica.</li>
              <li>Mudança num mês já fechado não entra: fica guardada em Fechar mês até você reabrir o mês.</li>
              <li>Se a senha for trocada nos dois ao mesmo tempo, vale a deste aparelho, e o app avisa.</li>
            </ul>
          </details>
        </>
      ) : (
        <>
          <p className="muted">Entre com sua conta Google para guardar o cofre, já cifrado, no seu Drive e usar o app no celular e no computador. A mesma conta liga a IA. O app só enxerga os arquivos que ele mesmo criou (e, se você permitir na Caixa de entrada, a pasta de extratos que escolher, só para ler).</p>
          {auto.kind === 'erro' && <p className="error" role="alert">{auto.message}</p>}
          <div>
            <button className="btn primary google-btn" disabled={working} onClick={run(() => signInGoogle(session))}>
              <GoogleMark /> {manual ? 'Guardando no Drive…' : 'Entrar com Google'}
            </button>
          </div>
        </>
      )}
    </Section>
  );
}

/** "G" do Google, só como sinal visual no botão de entrar. */
export function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/**
 * Entrar com Google num aparelho sem cofre aberto: baixa o cofre do Drive da conta escolhida.
 * Na tela de entrada, troca o cofre deste aparelho pelo dessa conta (depois de confirmar).
 */
export function PullFromGoogle({ db, onPulled, replacing, label = 'Entrar com Google', className = 'btn primary google-btn' }: { db: LocalDb; onPulled: () => void; replacing?: string | null; label?: string; className?: string }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (!driveConfigured()) return null;
  return (
    <div className="stack gap-8">
      <button type="button" className={className} disabled={busy} onClick={async () => {
        setErr('');
        if (replacing !== undefined && !(await askConfirm('Abrir o cofre de outra conta Google?', {
          detail: `O cofre deste aparelho${replacing ? ` (sincronizado com ${replacing})` : ''} sai daqui e entra o da conta que você escolher. ${replacing ? 'O que já foi para o Drive continua lá.' : 'Ele não está em nenhum Drive: se precisar dele, abra-o e baixe uma cópia de segurança antes.'}`,
          confirm: 'Escolher a conta', danger: !replacing,
        }))) return;
        setBusy(true);
        try {
          const t = await requestGoogleToken();
          const email = await googleEmail(t.accessToken);
          const ok = await pullVault(db, new GoogleDrive(t.accessToken), email);
          if (!ok) return setErr(`O Drive de ${email} ainda não tem um cofre do Ficha Redonda. No aparelho onde você já usa o app, entre com essa conta em Ajustes, Conta Google.`);
          token = { ...t, email };
          publish({ outro: null, auto: { kind: 'iniciando', pending: 0 } });
          onPulled();
        } catch (x) {
          setErr(friendly(x));
        } finally {
          setBusy(false);
        }
      }}><GoogleMark /> {busy ? 'Baixando o cofre…' : label}</button>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}
