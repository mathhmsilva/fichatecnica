import { friendlyError } from './feedback';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Session } from '../app/service';
import { formatBRL, parseAmount, type Cents } from '../domain/money';
import { monthLabel } from '../domain/date';

export function useSessionState(session: Session) {
  return useSyncExternalStore(
    (cb) => session.subscribe(cb),
    () => session.state,
  );
}

export function Money({ value, signed = false }: { value: Cents; signed?: boolean }) {
  const cls = signed ? (value > 0 ? 'num pos' : value < 0 ? 'num neg' : 'num') : 'num';
  return <span className={cls}>{signed && value > 0 ? '+' : ''}{formatBRL(value)}</span>;
}

export function MoneyInput({ id, label, value, onChange, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const parsed = value.trim() ? parseAmount(value) : null;
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <input id={id} inputMode="decimal" autoComplete="off" placeholder="0,00" value={value} onChange={(e) => onChange(e.target.value)} />
      {value.trim() && parsed === null ? <small className="error">Valor inválido. Use o formato 1.234,56.</small> : hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function Help({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span>
      <button type="button" className="help" aria-label="O que é isso?" aria-expanded={open} onClick={() => setOpen(!open)}><span className="help-dot" aria-hidden="true">?</span></button>
      {open && <span className="small muted" role="note"> {text}</span>}
    </span>
  );
}

export function download(name: string, data: Uint8Array<ArrayBuffer> | string, type: string) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Texto de um arquivo de banco: UTF-8, ou Latin-1 quando aparecem caracteres inválidos. */
export function decodeText(buf: ArrayBuffer): string {
  const utf = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  return utf.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf;
}

export async function readFile(file: File): Promise<string> {
  // Muitos bancos exportam em Latin-1: decodeText relê nessa codificação se precisar.
  return decodeText(await file.arrayBuffer());
}

/** Pede a senha forte para uma operação sensível. */
export function PasswordGate({ action, onConfirm, onCancel }: { action: string; onConfirm: (password: string) => Promise<void>; onCancel: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr('');
        try {
          await onConfirm(pw);
        } catch (x) {
          setErr(friendlyError(x));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Confirme com a senha do cofre</h3>
      <p className="muted small">Para {action}, o app pede a senha forte. Assim você também não esquece dela.</p>
      <label className="field" htmlFor="gate-pw">
        <span>Senha do cofre</span>
        <input id="gate-pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
      </label>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="row">
        <button className="btn primary" disabled={busy || !pw}>{busy ? 'Conferindo…' : 'Confirmar'}</button>
        <button type="button" className="btn" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function Section({ title, children, actions, id, collapsible = false, hint }: { title: string; children: ReactNode; actions?: ReactNode; id?: string; collapsible?: boolean; hint?: string }) {
  if (collapsible) {
    // Fechada por padrão: a tela de Ajustes vira um índice curto, e o dono abre só o que precisa.
    return (
      <details className="card section-fold" id={id}>
        <summary>
          <span className="fold-title"><h2>{title}</h2>{hint && <span className="small muted">{hint}</span>}</span>
          <span className="fold-mark" aria-hidden="true">›</span>
        </summary>
        {actions && <div className="row">{actions}</div>}
        {children}
      </details>
    );
  }
  return (
    <section className="card" id={id} aria-label={title}>
      <div className="row between">
        <h2>{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Mês em português, com setas: "◀ outubro de 2026 ▶". Vazio (com allowAll) quer dizer todos os meses. */
export function MonthPicker({ label = 'Mês', value, onChange, allowAll = false, max = today().slice(0, 7) }: { label?: string; value: string; onChange: (v: string) => void; allowAll?: boolean; max?: string }) {
  const base = value || today().slice(0, 7);
  const [y, m] = base.split('-').map(Number) as [number, number];
  const text = value ? monthLabel(y, m) : 'Todos os meses';
  const atMax = !!value && value >= max;
  return (
    <div className="field month-picker" role="group" aria-label={label}>
      <span className="small">{label}</span>
      <div className="month-picker-row">
        <button type="button" className="btn" aria-label="Mês anterior" onClick={() => onChange(shiftMonth(base, value ? -1 : 0))}>‹</button>
        <output aria-live="polite">{text}</output>
        <button type="button" className="btn" aria-label="Próximo mês" disabled={atMax} onClick={() => onChange(value ? shiftMonth(base, 1) : base)}>›</button>
        {allowAll && value && <button type="button" className="btn small-btn" onClick={() => onChange('')}>Todos</button>}
      </div>
    </div>
  );
}

/** Escolha entre poucas opções, em botões grandes (melhor no celular do que bolinhas de rádio). */
export function Choice<T extends string>({ label, options, value, onChange }: { label: string; options: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void }) {
  return (
    // Até três opções curtas ficam sempre numa linha, mesmo no celular.
    <div className={options.length <= 3 && options.every(([, l]) => l.length <= 12) ? 'seg tight' : 'seg'} role="radiogroup" aria-label={label}>
      {options.map(([k, l]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

/** Botão de escolher arquivo, em português e do tamanho de um dedo. */
export function FilePick({ accept, label = 'Escolher arquivo', onFile, fileName, capture, secondary }: { accept: string; label?: string; onFile: (f: File) => void; fileName?: string; capture?: boolean; secondary?: boolean }) {
  return (
    <div className="row">
      <label className={`btn ${secondary ? '' : 'primary'} file-pick`}>
        <input type="file" accept={accept} {...(capture ? { capture: 'environment' as const } : {})} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
        {label}
      </label>
      {fileName !== undefined || !secondary ? <span className="muted small wrap-any">{fileName || 'Nenhum arquivo escolhido'}</span> : null}
    </div>
  );
}

/** "1 lançamento", "3 lançamentos": evita o "(s)". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
