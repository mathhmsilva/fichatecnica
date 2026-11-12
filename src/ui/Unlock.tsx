import { useEffect, useState } from 'react';
import { Session } from '../app/service';
import type { LocalDb } from '../store/localdb';
import { LogoMark } from './Brand';
import { PullFromGoogle } from './sync';

export function Unlock({ db, hasPin, onOpen, onRefresh }: { db: LocalDb; hasPin: boolean; onOpen: (s: Session) => void; onRefresh: () => void }) {
  const [mode, setMode] = useState<'pin' | 'senha' | 'recuperacao'>(hasPin ? 'pin' : 'senha');
  const [pin, setPin] = useState('');
  const [secret, setSecret] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  // Conta Google com que este cofre sincroniza (para avisar antes de trocar de cofre).
  const [synced, setSynced] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void db.getSync().then((m) => setSynced(m?.email ?? null));
  }, [db]);

  const tryPin = async (value: string) => {
    setBusy(true);
    setErr('');
    const { session, result } = await Session.unlockPin(db, value);
    setBusy(false);
    setPin('');
    if (session) return onOpen(session);
    if (!result.ok && result.attemptsLeft === 0) {
      setErr('PIN errado 5 vezes. Por segurança, entre com a senha do cofre.');
      setMode('senha');
      onRefresh();
    } else if (!result.ok) {
      setErr(`PIN incorreto. ${result.attemptsLeft === 1 ? 'Resta 1 tentativa' : `Restam ${result.attemptsLeft} tentativas`}.`);
      setShake(true);
      setTimeout(() => setShake(false), 400);
    }
  };

  const press = (d: string) => {
    if (busy) return;
    const next = (pin + d).slice(0, 6);
    setPin(next);
    if (next.length === 6) void tryPin(next);
  };

  // No computador, o PIN também vai pelo teclado (números e Backspace).
  useEffect(() => {
    if (mode !== 'pin') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="lockscreen">
        <div className="who">
          <LogoMark size={64} />
          <h1>Bem-vindo de volta</h1>
          <p>{mode === 'pin' ? 'Digite seu PIN de 6 números' : mode === 'senha' ? 'Entre com a senha do cofre' : 'Entre com um código de recuperação'}</p>
        </div>
        {mode === 'pin' ? (
          <div className="stack center-items">
            <div className={`dots${shake ? ' shake' : ''}`} aria-label={`${pin.length} de 6 números digitados`}>{[0, 1, 2, 3, 4, 5].map((i) => <span key={i} className={i < pin.length ? 'on' : ''} />)}</div>
            <div className="pinpad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} type="button" onClick={() => press(d)}>{d}</button>)}
              <span />
              <button type="button" onClick={() => press('0')}>0</button>
              <button type="button" className="ghost" aria-label="Apagar" onClick={() => setPin(pin.slice(0, -1))}>⌫</button>
            </div>
            {busy && <p className="muted small">Abrindo…</p>}
            {err && <p className="error" role="alert">{err}</p>}
            <button type="button" className="btn link" onClick={() => setMode('senha')}>Entrar com a senha</button>
          </div>
        ) : (
          <form
            className="lock-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setErr('');
              const s = await Session.unlock(db, secret, mode);
              setBusy(false);
              if (s) onOpen(s);
              else setErr(mode === 'senha' ? 'Senha incorreta.' : 'Código incorreto.');
            }}
          >
            <label className="field" htmlFor="u-secret">
              <span>{mode === 'senha' ? 'Senha do cofre' : 'Código de recuperação'}</span>
              <input id="u-secret" type={mode === 'senha' ? 'password' : 'text'} autoComplete={mode === 'senha' ? 'current-password' : 'off'} value={secret} onChange={(e) => setSecret(e.target.value)} autoFocus />
            </label>
            {err && <p className="error" role="alert">{err}</p>}
            <button className="btn lime big" disabled={busy || !secret}>{busy ? 'Abrindo…' : 'Abrir'}</button>
            <div className="row">
              {hasPin && <button type="button" className="btn link" onClick={() => setMode('pin')}>Usar o PIN</button>}
              {mode === 'senha' ? (
                <button type="button" className="btn link" onClick={() => setMode('recuperacao')}>Esqueci a senha</button>
              ) : (
                <button type="button" className="btn link" onClick={() => setMode('senha')}>Usar a senha</button>
              )}
            </div>
            {mode === 'recuperacao' && <p className="muted small">Use o código 1 (com você) ou o código 2 (envelope lacrado). Depois de entrar, troque a senha em Ajustes.</p>}
          </form>
        )}
        {synced !== undefined && (
          <div className="lock-foot">
            {synced && <p className="small on-ink-muted">Cofre sincronizado com {synced}.</p>}
            <PullFromGoogle db={db} onPulled={onRefresh} replacing={synced} label="Entrar com outra conta Google" className="btn link on-ink" />
          </div>
        )}
    </div>
  );
}
