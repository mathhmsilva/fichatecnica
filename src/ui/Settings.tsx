import { useEffect, useState } from 'react';
import type { Session } from '../app/service';
import { passwordProblems, pinProblems } from '../crypto/vault';
import type { Settings } from '../store/events';
import { PasswordGate, Section, download, useSessionState } from './common';
import { localStorageGet, localStorageSet } from './Main';
import { DriveSection } from './sync';
import { askConfirm, friendlyError, notify } from './feedback';
import { ResetSection } from './Reset';

export function SettingsScreen({ session, onLock, onImport }: { session: Session; onLock: () => void; onImport: () => void }) {
  return (
    <>
      <h1>Ajustes</h1>
      <DriveSection session={session} onLock={onLock} />
      <GeneralSection session={session} />
      <Section collapsible hint="Trazer pizzas, receitas e insumos de novo" title="Planilha" id="ajustes-planilha">
        <p className="small muted">Para trazer de novo a planilha de fichas técnicas (por exemplo, depois de mexer nela no Google Planilhas), use Importar planilha. O app mostra o que muda antes de gravar.</p>
        <div><button className="btn" onClick={onImport}>Importar planilha</button></div>
      </Section>
      <SecuritySection session={session} />
      <ResetSection session={session} />
    </>
  );
}

function SecuritySection({ session }: { session: Session }) {
  const state = useSessionState(session);
  const [remembered, setRemembered] = useState<boolean | null>(null);
  const [gate, setGate] = useState<null | 'backup' | 'pin' | 'codigo1' | 'codigo2'>(null);
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [newCode, setNewCode] = useState('');
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const recoveryWrappers = session.header.wrappers.filter((w) => w.kind === 'recuperacao');

  useEffect(() => {
    void session.hasDevice().then(setRemembered);
  }, [session, msg]);

  return (
    <Section collapsible hint="Senha, códigos de recuperação e cópia" title="Segurança e cópia" id="ajustes-seguranca">
      {msg && <div className="notice ok" role="status"><b>Feito</b><span>{msg}</span></div>}
      {err && <p className="error" role="alert">{err}</p>}
      {session.chainProblems.length > 0 && (
        <div className="notice"><b>Atenção</b><span>O histórico tem {session.chainProblems.length === 1 ? '1 ponto que não confere' : `${session.chainProblems.length} pontos que não conferem`} (pode ser arquivo mexido fora do app). Restaure a última cópia de segurança e fale com quem instalou o app.</span></div>
      )}

      <h3 className="sub-h">Este aparelho</h3>
      {state.settings.deviceShared ? (
        <p className="small muted">Marcado como compartilhado: não fica lembrado e pede a senha sempre.</p>
      ) : remembered ? (
        <div className="row">
          <span>Lembrado: abre com o PIN de 6 dígitos.</span>
          <button className="btn" onClick={async () => { if (!(await askConfirm('Esquecer este aparelho?', { detail: 'O PIN deixa de valer aqui. Na próxima vez, o cofre abre só com a senha.', confirm: 'Esquecer' }))) return; await session.forgetDevice(); setMsg('Aparelho esquecido. Na próxima vez, entra só com a senha.'); }}>Esquecer este aparelho</button>
        </div>
      ) : (
        <div className="row">
          <input aria-label="Novo PIN de 6 dígitos" inputMode="numeric" maxLength={6} placeholder="PIN de 6 dígitos" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className="pin-input" />
          <button className="btn" disabled={pinProblems(pin).length > 0} onClick={() => setGate('pin')}>Lembrar com PIN</button>
          {pin.length === 6 && pinProblems(pin).length > 0 && <span className="small error">{pinProblems(pin).join(' ')}</span>}
        </div>
      )}

      <h3 className="sub-h">Códigos de recuperação</h3>
      <p className="small muted">
        Último teste: {state.lastRecoveryTest ? new Date(state.lastRecoveryTest).toLocaleDateString('pt-BR') : 'nunca'}. Teste um dos códigos a cada 6 meses.
      </p>
      <form className="row" onSubmit={async (e) => { e.preventDefault(); setErr(''); const ok = await session.testRecovery(code); setCode(''); if (ok) setMsg('Código funcionando. Guarde de volta no mesmo lugar.'); else setErr('Esse código não abre o cofre. Confira as letras ou troque o código.'); }}>
        <input aria-label="Código de recuperação" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} className="grow-input" autoComplete="off" />
        <button className="btn" disabled={code.trim().length < 10}>Testar código</button>
      </form>
      <div className="row">
        {recoveryWrappers.map((w, i) => (
          <button key={w.id} className="btn" onClick={() => setGate(i === 0 ? 'codigo1' : 'codigo2')}>Trocar {w.label}</button>
        ))}
      </div>
      {newCode && (
        <div className="stack">
          <p className="small">Novo código. Anote ou imprima agora: ele não aparece de novo. O antigo deixou de funcionar.</p>
          <div className="codes">{newCode}</div>
          <div className="row"><button className="btn" onClick={() => window.print()}>Imprimir</button><button className="btn" onClick={() => setNewCode('')}>Já guardei</button></div>
        </div>
      )}

      <h3 className="sub-h">Senha do cofre</h3>
      <form className="grid" onSubmit={async (e) => {
        e.preventDefault();
        setErr('');
        try {
          if (next !== next2) return setErr('As duas vezes da nova senha não são iguais. Digite de novo.');
          await session.changePassword(cur, next);
          setCur(''); setNext(''); setNext2('');
          setMsg('Senha trocada. Se usava PIN neste aparelho, cadastre de novo.');
        } catch (x) { setErr(friendlyError(x)); }
      }}>
        <label className="field" htmlFor="pw-cur"><span>Senha atual</span><input id="pw-cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></label>
        <label className="field" htmlFor="pw-next"><span>Nova senha</span><input id="pw-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          {next && passwordProblems(next).length > 0 && <small className="error">{passwordProblems(next).join(' ')}</small>}
        </label>
        <label className="field" htmlFor="pw-next2"><span>Nova senha de novo</span><input id="pw-next2" type="password" autoComplete="new-password" value={next2} onChange={(e) => setNext2(e.target.value)} />
          {next2 && next2 !== next && <small className="error">Ainda não é igual à nova senha.</small>}
        </label>
        <div className="end"><button className="btn" disabled={!cur || passwordProblems(next).length > 0 || next !== next2}>Trocar senha</button></div>
      </form>

      <h3 className="sub-h">Cópia de segurança</h3>
      <p className="small muted">Baixa um arquivo cifrado com tudo. Sem a senha ou um código de recuperação, ninguém consegue abrir. Com o Drive conectado ela é opcional; guarde uma num pen drive de vez em quando.</p>
      <div><button className="btn" onClick={() => setGate('backup')}>Baixar cópia de segurança</button></div>

      {gate && (
        <PasswordGate
          action={gate === 'backup' ? 'baixar a cópia completa' : gate === 'pin' ? 'lembrar este aparelho' : 'trocar o código de recuperação'}
          onCancel={() => setGate(null)}
          onConfirm={async (pw) => {
            setErr('');
            if (gate === 'backup') {
              const b = await session.exportBackup(pw);
              download(`ficharedonda-copia-${new Date().toISOString().slice(0, 10)}.ficharedonda`, JSON.stringify(b), 'application/octet-stream');
              setMsg('Cópia baixada.');
            } else if (gate === 'pin') {
              try { await session.rememberDevice(pw, pin); } catch { throw new Error('Senha do cofre incorreta.'); }
              setPin('');
              setMsg('Aparelho lembrado. Da próxima vez, entre com o PIN.');
            } else {
              const w = recoveryWrappers[gate === 'codigo1' ? 0 : 1];
              if (w) setNewCode(await session.replaceRecovery(pw, w.id));
            }
            setGate(null);
          }}
        />
      )}
    </Section>
  );
}

function GeneralSection({ session }: { session: Session }) {
  const state = useSessionState(session);
  const s = state.settings;
  const [name, setName] = useState(s.businessName);
  const [big, setBig] = useState(localStorageGet('bigText') === '1');
  const save = (patch: Partial<Settings>) => session.updateSettings(patch);
  return (
    <Section collapsible hint="Nome, aparelho compartilhado e letra maior" title="Geral" id="ajustes-geral">
      <label className="field" htmlFor="g-name"><span>Nome da pizzaria</span><input id="g-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => { if (name.trim() && name !== s.businessName) void save({ businessName: name.trim() }).then(() => notify('Nome salvo.')); }} /></label>
      <label className="check"><input type="checkbox" checked={!!s.deviceShared} onChange={async (e) => { await save({ deviceShared: e.target.checked }); if (e.target.checked) await session.forgetDevice(); }} /><span>Este aparelho é compartilhado (trava em 10 minutos e não fica lembrado)</span></label>
      <label className="check"><input type="checkbox" checked={big} onChange={(e) => { setBig(e.target.checked); localStorageSet('bigText', e.target.checked ? '1' : '0'); document.body.classList.toggle('big-text', e.target.checked); }} /><span>Letra maior</span></label>
    </Section>
  );
}
