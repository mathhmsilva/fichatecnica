import { useEffect, useState } from 'react';
import type { Session } from '../app/service';
import { GoogleDrive } from '../sync/drive';
import { forgetGoogleLogin } from '../sync/oauth';
import { Section } from './common';
import { askConfirm, friendlyError } from './feedback';
import { driveConfigured, forgetGoogleToken, googleAccessToken } from './sync';

/** O que a pessoa digita para mostrar que leu (passo 2). */
export const RESET_PHRASE = 'APAGAR TUDO';

/** Apaga as preferências deste aparelho (as que começam com "cr."). */
function clearLocalPrefs() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('cr.')) localStorage.removeItem(k);
  } catch {
    /* sem armazenamento: nada a apagar */
  }
}

/**
 * Apagar tudo e começar do zero, com quatro travas contra engano: marcar que entendeu,
 * digitar APAGAR TUDO, a senha do cofre e uma última pergunta. O Drive só é apagado se
 * marcado (e vai para a lixeira dele, que guarda por 30 dias).
 */
export function ResetSection({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [secret, setSecret] = useState('');
  const [alsoDrive, setAlsoDrive] = useState(false);
  const [driveEmail, setDriveEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (open) void session.syncInfo().then((m) => setDriveEmail(m?.email ?? null));
  }, [open, session]);

  const ready = understood && phrase.trim().toUpperCase() === RESET_PHRASE && secret.length > 0 && !busy;

  const reset = async () => {
    if (!ready) return;
    const sure = await askConfirm('Apagar tudo agora?', {
      detail: alsoDrive && driveEmail
        ? `Os dados deste aparelho somem e a pasta do cofre no Drive de ${driveEmail} vai para a lixeira. O app volta para o primeiro acesso.`
        : 'Os dados deste aparelho somem. O app volta para o primeiro acesso.',
      confirm: 'Apagar tudo',
      danger: true,
    });
    if (!sure) return;
    setBusy(true);
    setErr('');
    try {
      let token: string | undefined;
      if (alsoDrive && driveEmail) token = await googleAccessToken(session);
      await session.resetEverything(secret, token ? new GoogleDrive(token) : undefined);
      forgetGoogleToken();
      await forgetGoogleLogin(token);
      clearLocalPrefs();
      window.location.replace('/');
    } catch (x) {
      setErr(friendlyError(x));
      setBusy(false);
    }
  };

  return (
    <Section title="Apagar tudo e começar do zero" id="ajustes-apagar" collapsible>
      {!open ? (
        <div className="stack gap-8">
          <p className="small muted">Apaga o cofre deste aparelho: lançamentos, regras, contas, caixa de entrada, PIN e login do Google. Não dá para desfazer.</p>
          <div><button className="btn danger" onClick={() => setOpen(true)}>Quero apagar tudo…</button></div>
        </div>
      ) : (
        <div className="stack reset-steps">
          <div className="notice" role="alert">
            <b>Atenção</b>
            <span>Tudo o que está neste aparelho some de vez: lançamentos, regras, contas, meses fechados, arquivos da caixa de entrada, PIN e o login do Google. Antes, se quiser guardar, faça uma <b>cópia de segurança</b> em Segurança, aqui em Ajustes.</span>
          </div>

          <label className="check">
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
            <span><b>1.</b> Entendo que isso não pode ser desfeito.</span>
          </label>

          {driveConfigured() && driveEmail && (
            <label className="check">
              <input type="checkbox" checked={alsoDrive} onChange={(e) => setAlsoDrive(e.target.checked)} />
              <span>Apagar também o cofre guardado no Google Drive de <b>{driveEmail}</b> (vai para a lixeira do Drive, que guarda por 30 dias). Sem marcar, a cópia no Drive continua lá e pode ser aberta de novo com "Já uso em outro aparelho".</span>
            </label>
          )}

          <label className="field" htmlFor="reset-phrase">
            <span><b>2.</b> Digite {RESET_PHRASE} para confirmar</span>
            <input id="reset-phrase" autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={!understood} value={phrase} onChange={(e) => setPhrase(e.target.value)} />
          </label>

          <label className="field" htmlFor="reset-secret">
            <span><b>3.</b> Senha do cofre (ou um código de recuperação)</span>
            <input id="reset-secret" type="password" autoComplete="current-password" disabled={!understood || phrase.trim().toUpperCase() !== RESET_PHRASE} value={secret} onChange={(e) => setSecret(e.target.value)} />
          </label>

          {err && <p className="error" role="alert">{err}</p>}
          <div className="row">
            <button className="btn danger-fill" disabled={!ready} aria-busy={busy} onClick={() => void reset()}>{busy ? <><span className="spinner" aria-hidden="true" />Apagando…</> : 'Apagar tudo'}</button>
            <button className="btn" disabled={busy} onClick={() => { setOpen(false); setUnderstood(false); setPhrase(''); setSecret(''); setAlsoDrive(false); setErr(''); }}>Cancelar</button>
          </div>
        </div>
      )}
    </Section>
  );
}
