import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * Retorno de cada ação: um aviso curto embaixo da tela (com "Desfazer" quando dá),
 * uma pergunta de confirmação com a cara do app e um gancho para botões que gravam.
 */

type Toast = { id: number; text: string; undo?: () => Promise<unknown> | void; tone?: 'ok' | 'erro'; at: number };
let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function notify(text: string, opts: { undo?: Toast['undo']; tone?: Toast['tone'] } = {}) {
  const t: Toast = { id: ++seq, text, at: Date.now(), ...opts };
  // Um aviso por vez: o novo substitui o anterior, para não cobrir a tela.
  toasts = [t];
  emit();
  setTimeout(() => dismiss(t.id), opts.undo ? 8000 : 4500);
}

/** Fecha os avisos (ao trocar de tela: o "Desfazer" não faz sentido longe de onde a ação aconteceu). */
export function clearToasts() {
  // Um aviso que acabou de sair fica: salvar e já abrir outra tela não pode apagar o "Salvo".
  const keep = toasts.filter((t) => Date.now() - t.at < 600);
  if (keep.length === toasts.length) return;
  toasts = keep;
  emit();
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function Toaster() {
  const list = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => toasts);
  return (
    <div className="toaster no-print" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast${t.tone === 'erro' ? ' erro' : ''}`}>
          <span>{t.text}</span>
          {t.undo && (
            <button type="button" className="btn small-btn" onClick={async () => { dismiss(t.id); try { await t.undo!(); notify('Desfeito.'); } catch (x) { notify(friendlyError(x), { tone: 'erro' }); } }}>Desfazer</button>
          )}
          <button type="button" className="toast-x" aria-label="Fechar aviso" onClick={() => dismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}

/** Mensagem amigável para qualquer erro (nunca "Failed to fetch" em inglês). */
export function friendlyError(x: unknown): string {
  const m = x instanceof Error ? x.message : String(x);
  if (x instanceof TypeError && /fetch|network|load failed/i.test(m)) return 'Sem conexão com a internet agora. Tente de novo quando a internet voltar.';
  if (/QuotaExceeded/i.test(m)) return 'O celular está sem espaço para guardar. Libere espaço e tente de novo.';
  // Erro interno do navegador ou do código (em inglês): o dono vê uma frase simples; o detalhe fica no console.
  if (x instanceof TypeError || x instanceof ReferenceError || x instanceof RangeError || x instanceof SyntaxError || /\b(undefined|null|cannot|failed to|is not)\b/i.test(m)) {
    console.error(x);
    return 'Algo deu errado aqui. Tente de novo; se continuar, feche e abra o app.';
  }
  return m || 'Algo deu errado. Tente de novo.';
}

/** Botão que grava: fica travado enquanto trabalha e mostra o erro em português. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (running.current) return undefined;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (x) {
      setError(friendlyError(x));
      return undefined;
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return { run, busy, error, setError };
}

type Ask = { text: string; detail?: string; confirm: string; danger?: boolean; resolve: (ok: boolean) => void };
let ask: Ask | null = null;
const askListeners = new Set<() => void>();

/** Pergunta com a cara do app (no lugar do confirm() do navegador). */
export function askConfirm(text: string, opts: { detail?: string; confirm?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    ask?.resolve(false);
    ask = { text, confirm: opts.confirm ?? 'Confirmar', resolve, ...(opts.detail ? { detail: opts.detail } : {}), ...(opts.danger ? { danger: true } : {}) };
    askListeners.forEach((l) => l());
  });
}

export function ConfirmHost() {
  const current = useSyncExternalStore((cb) => { askListeners.add(cb); return () => askListeners.delete(cb); }, () => ask);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (current && !d.open) d.showModal?.();
    if (!current && d.open) d.close();
  }, [current]);
  const answer = (ok: boolean) => {
    const a = ask;
    ask = null;
    askListeners.forEach((l) => l());
    a?.resolve(ok);
  };
  return (
    <dialog ref={ref} className="confirm-dialog" onCancel={(e) => { e.preventDefault(); answer(false); }} aria-labelledby="confirm-title">
      {current && (
        <form method="dialog" onSubmit={(e) => { e.preventDefault(); answer(true); }}>
          <h3 id="confirm-title">{current.text}</h3>
          {current.detail && <p className="muted small">{current.detail}</p>}
          <div className="row">
            <button className={`btn ${current.danger ? 'danger-fill' : 'primary'}`} autoFocus>{current.confirm}</button>
            <button type="button" className="btn" onClick={() => answer(false)}>Cancelar</button>
          </div>
        </form>
      )}
    </dialog>
  );
}

/**
 * Campos que gravam ao sair: se o dono trocar de tela ou fechar o app sem tirar o foco,
 * grava mesmo assim, em vez de perder a edição calado.
 */
export function useSaveOnLeave(save: () => void) {
  const ref = useRef(save);
  useEffect(() => { ref.current = save; });
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') ref.current(); };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      ref.current();
    };
  }, []);
}
