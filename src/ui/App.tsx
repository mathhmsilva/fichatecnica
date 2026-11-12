import { useCallback, useEffect, useRef, useState } from 'react';
import { LocalDb } from '../store/localdb';
import type { Session } from '../app/service';
import { Setup } from './Setup';
import { Unlock } from './Unlock';
import { Main } from './Main';
import { forgetGoogleToken } from './sync';
import { Splash } from './Brand';

/** A abertura fica pelo menos este tempo, para a marca não piscar. */
const SPLASH_MIN_MS = 900;

type Phase = { kind: 'loading' } | { kind: 'setup' } | { kind: 'locked'; hasPin: boolean } | { kind: 'open'; session: Session; codes?: [string, string] } | { kind: 'error'; message: string };

/** Tempo parado até travar: menor no computador compartilhado. */
const IDLE_MS = { proprio: 15 * 60_000, compartilhado: 10 * 60_000 };
const BACKGROUND_MS = 5 * 60_000;

export function App() {
  const [db, setDb] = useState<LocalDb | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  const refresh = useCallback(async (d: LocalDb) => {
    const header = await d.getHeader();
    if (!header) return setPhase({ kind: 'setup' });
    const device = await d.getDevice();
    setPhase({ kind: 'locked', hasPin: !!device });
  }, []);

  useEffect(() => {
    const started = Date.now();
    const wait = () => new Promise((r) => setTimeout(r, Math.max(0, SPLASH_MIN_MS - (Date.now() - started))));
    LocalDb.open()
      .then(async (d) => {
        setDb(d);
        await wait();
        await refresh(d);
      })
      .catch(() => setPhase({ kind: 'error', message: 'Este navegador não permite guardar dados (modo anônimo ou armazenamento bloqueado). Abra o app numa janela normal.' }));
  }, [refresh]);

  const lock = useCallback(() => {
    setPhase((p) => {
      if (p.kind === 'open') p.session.lock();
      forgetGoogleToken();
      return p;
    });
    if (db) void refresh(db);
  }, [db, refresh]);

  useIdleLock(phase.kind === 'open', phase.kind === 'open' && phase.session.state.settings.deviceShared ? IDLE_MS.compartilhado : IDLE_MS.proprio, lock);

  if (phase.kind === 'loading') return <Splash message="Preparando" />;
  if (phase.kind === 'error') return <div className="center"><div className="card"><h2>Não deu para abrir</h2><p>{phase.message}</p></div></div>;
  if (!db) return null;
  if (phase.kind === 'setup') return <Setup db={db} onDone={(session, codes) => setPhase({ kind: 'open', session, codes })} onRestored={(session) => setPhase({ kind: 'open', session })} onPulled={() => refresh(db)} />;
  if (phase.kind === 'locked') return <Unlock db={db} hasPin={phase.hasPin} onOpen={(session) => setPhase({ kind: 'open', session })} onRefresh={() => refresh(db)} />;
  return <Main session={phase.session} onLock={lock} />;
}

/** Trava depois de um tempo parado, ou quando o app fica escondido por mais de 5 minutos. */
function useIdleLock(active: boolean, idleMs: number, lock: () => void) {
  const last = useRef(0);
  const hiddenAt = useRef<number | null>(null);
  useEffect(() => {
    if (!active) return;
    last.current = Date.now();
    const touch = () => {
      last.current = Date.now();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current > BACKGROUND_MS) lock();
      else hiddenAt.current = null;
    };
    const timer = setInterval(() => {
      if (Date.now() - last.current > idleMs) lock();
    }, 15_000);
    const evs = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    evs.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      evs.forEach((e) => window.removeEventListener(e, touch));
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, idleMs, lock]);
}
