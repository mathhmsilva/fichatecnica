import { friendlyError } from './feedback';
import { useState } from 'react';
import { Session, restoreBackup } from '../app/service';
import type { LocalDb, BackupFile } from '../store/localdb';
import { passwordProblems, pinProblems } from '../crypto/vault';
import { Choice, FilePick, readFile } from './common';
import { driveConfigured, PullFromGoogle } from './sync';
import { Wordmark } from './Brand';
import type { ReactNode } from 'react';

type Step = 'negocio' | 'senha' | 'codigos' | 'pin' | 'restaurar';

export function Setup({ db, onDone, onRestored, onPulled }: { db: LocalDb; onDone: (s: Session, codes: [string, string]) => void; onRestored: (s: Session) => void; onPulled: () => void }) {
  const [step, setStep] = useState<Step>('negocio');
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [codes, setCodes] = useState<[string, string] | null>(null);
  const [check1, setCheck1] = useState('');
  const [check2, setCheck2] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');

  const steps: Step[] = ['negocio', 'senha', 'codigos', 'pin'];
  const index = steps.indexOf(step);
  const progress = (
    <div className="stack gap-8">
      <span className="eyebrow">Passo {index + 1} de 4</span>
      <div className="progress" aria-hidden="true">{steps.map((x, i) => <span key={x} className={i <= index ? 'on' : ''} />)}</div>
    </div>
  );

  if (step === 'restaurar') return <Restore db={db} onBack={() => setStep('negocio')} onRestored={onRestored} onPulled={onPulled} />;

  return (
    <Onboard current={index}>
        {progress}
        {step === 'negocio' && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); setStep('senha'); }}>
            <div className="page-head">
              <h1>Conte sobre a pizzaria</h1>
              <p>Vamos preparar o cofre onde ficam as fichas técnicas, os custos e os preços. Leva uns 3 minutos e dá para mudar tudo depois.</p>
            </div>
            {driveConfigured() && (
              <div className="card soft returning">
                <div>
                  <b>Já usa o Ficha Redonda em outro aparelho?</b>
                  <p className="small muted">Entre com a conta Google em que o cofre está guardado. Depois o app pede a senha do cofre.</p>
                </div>
                <PullFromGoogle db={db} onPulled={onPulled} />
              </div>
            )}
            <label className="field" htmlFor="s-name"><span>Nome da pizzaria</span><input id="s-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></label>
            <label className="check toggle-card" htmlFor="s-shared">
              <input id="s-shared" type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
              <span>Este aparelho é usado por outras pessoas (por exemplo, o computador da pizzaria). <span className="muted small">Nesse caso ele não fica lembrado e trava mais rápido.</span></span>
            </label>
            <div className="actions-bar">
              <button className="btn primary big" disabled={!name.trim()}>Continuar</button>
              <button type="button" className="btn link" onClick={() => setStep('restaurar')}>{driveConfigured() ? 'Restaurar uma cópia de segurança' : 'Já uso em outro aparelho'}</button>
            </div>
          </form>
        )}

        {step === 'senha' && (
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setErr('');
              if (pw !== pw2) return setErr('As duas senhas estão diferentes.');
              const problems = passwordProblems(pw);
              if (problems.length) return setErr(problems[0]!);
              setBusy(true);
              try {
                const res = await Session.create(db, pw, { businessName: name.trim(), deviceShared: shared });
                setSession(res.session);
                setCodes(res.recoveryCodes);
                setStep('codigos');
              } catch (x) {
                setErr(friendlyError(x));
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="page-head">
            <h1>Crie a senha do cofre</h1>
            <p>Ela protege tudo. Você vai usá-la pouco: num aparelho novo, para trocar a senha e para tirar cópia de segurança. Uma frase com 3 ou 4 palavras é fácil de lembrar e difícil de adivinhar.</p>
            </div>
            <label className="field" htmlFor="s-pw"><span>Senha</span><input id="s-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></label>
            {pw && <Strength pw={pw} />}
            <label className="field" htmlFor="s-pw2"><span>Repita a senha</span><input id="s-pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
            {err && <p className="error" role="alert">{err}</p>}
            <div className="actions-bar"><button className="btn primary big" disabled={busy}>{busy ? 'Criando o cofre…' : 'Criar cofre'}</button><button type="button" className="btn link" onClick={() => setStep('negocio')}>Voltar</button></div>
          </form>
        )}

        {step === 'codigos' && codes && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const ok1 = check1.replace(/\W/g, '').toUpperCase() === codes[0].replace(/\W/g, '').slice(-4);
              const ok2 = check2.replace(/\W/g, '').toUpperCase() === codes[1].replace(/\W/g, '').slice(0, 4);
              if (!ok1 || !ok2) return setErr('Os caracteres não conferem. Olhe de novo no papel.');
              setErr('');
              setStep('pin');
            }}
          >
            <div className="page-head">
              <h1>Guarde seus dois códigos de recuperação</h1>
              <p>Se você esquecer a senha, só estes códigos abrem o cofre. <b className="fg">Ninguém, nem o suporte, consegue recuperar os dados sem eles.</b></p>
            </div>
            <div className="stack gap-10">
              <div className="ticket"><span className="eyebrow">Código 1 · fica com você</span><p className="codes">{codes[0]}</p><span className="small on-ink-muted">Gaveta de casa, cofre, carteira.</span></div>
              <div className="ticket alt"><span className="eyebrow">Código 2 · envelope lacrado</span><p className="codes">{codes[1]}</p><span className="small muted">Com um familiar de confiança.</span></div>
            </div>
            <div><button type="button" className="btn" onClick={() => window.print()}>Imprimir os códigos</button></div>
            <div className="print-only">
              <h1>Ficha Redonda: códigos de recuperação</h1>
              <p>{name}. Criado em {new Date().toLocaleDateString('pt-BR')}.</p>
              <p>Código 1 (fica com o dono): {codes[0]}</p>
              <p>Código 2 (envelope lacrado): {codes[1]}</p>
            </div>
            <div className="card flat">
              <h2>Confira que anotou certo</h2>
              <div className="grid narrow">
                <label className="field" htmlFor="s-c1"><span>4 últimos do código 1</span><input id="s-c1" value={check1} onChange={(e) => setCheck1(e.target.value)} maxLength={4} autoCapitalize="characters" className="codes" /></label>
                <label className="field" htmlFor="s-c2"><span>4 primeiros do código 2</span><input id="s-c2" value={check2} onChange={(e) => setCheck2(e.target.value)} maxLength={4} autoCapitalize="characters" className="codes" /></label>
              </div>
            </div>
            {err && <p className="error" role="alert">{err}</p>}
            <div className="actions-bar"><button className="btn primary big">Já guardei os dois</button></div>
          </form>
        )}

        {step === 'pin' && session && codes && (
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setErr('');
              if (shared) return onDone(session, codes);
              if (pin !== pin2) return setErr('Os dois PINs estão diferentes.');
              const problems = pinProblems(pin);
              if (problems.length) return setErr(problems[0]!);
              setBusy(true);
              try {
                await session.rememberDevice(pw, pin);
                onDone(session, codes);
              } catch (x) {
                setErr(friendlyError(x));
              } finally {
                setBusy(false);
              }
            }}
          >
            {shared ? (
              <>
                <div className="page-head"><h1>Tudo pronto</h1>
                <p>Como este aparelho é compartilhado, ele não fica lembrado: sempre vai pedir a senha do cofre e trava depois de 10 minutos parado.</p></div>
              </>
            ) : (
              <>
                <div className="page-head"><h1>Crie um PIN para o dia a dia</h1>
                <p>Neste aparelho, você abre o app com um PIN de 6 números. Depois de 5 erros, ele volta a pedir a senha forte, sem apagar nada.</p></div>
                <label className="field" htmlFor="s-pin"><span>PIN de 6 números</span><input id="s-pin" inputMode="numeric" type="password" autoComplete="new-password" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} autoFocus /></label>
                <label className="field" htmlFor="s-pin2"><span>Repita o PIN</span><input id="s-pin2" inputMode="numeric" type="password" autoComplete="new-password" maxLength={6} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} /></label>
              </>
            )}
            {err && <p className="error" role="alert">{err}</p>}
            <div className="actions-bar">
              <button className="btn primary big" disabled={busy}>{busy ? 'Guardando…' : 'Começar a usar'}</button>
              {!shared && <button type="button" className="btn link" onClick={() => onDone(session, codes)}>Agora não</button>}
            </div>
          </form>
        )}
    </Onboard>
  );
}

const STEP_NAMES = ['A pizzaria', 'Senha do cofre', 'Códigos de recuperação', 'PIN do dia a dia'];

/** Moldura do primeiro acesso: painel escuro com a marca e os passos, formulário ao lado. */
function Onboard({ current, children }: { current: number; children: ReactNode }) {
  return (
    <div className="onboard">
      <aside className="onboard-side">
        <Wordmark size="md" />
        <p className="claim">Ficha técnica e preço, <em>redondinhos.</em></p>
        <p className="lead">Receitas, custo de cada insumo, CMV por tamanho e o preço certo no salão, no iFood e na 99Food, num cofre que só você abre.</p>
        {current >= 0 && (
          <ol className="steps">
            {STEP_NAMES.map((n, i) => (
              <li key={n} className={i === current ? 'now' : i < current ? 'done' : ''} aria-current={i === current ? 'step' : undefined}>
                <span className="n">{i < current ? '✓' : i + 1}</span>{n}
              </li>
            ))}
          </ol>
        )}
      </aside>
      <div className="onboard-main"><div className="panel">{children}</div></div>
    </div>
  );
}

/** Régua de força da senha: só um guia visual; quem decide é passwordProblems. */
function Strength({ pw }: { pw: string }) {
  const words = pw.trim().split(/\s+/).filter(Boolean).length;
  const score = passwordProblems(pw).length ? (pw.length < 8 ? 1 : 2) : words >= 4 || pw.length >= 20 ? 4 : 3;
  const label = ['', 'Fraca', 'Quase lá', 'Boa', 'Ótima'][score];
  return (
    <div className="stack gap-6">
      <div className={`strength s${score}`} aria-hidden="true"><span /><span /><span /><span /></div>
      <span className="small muted">Força da senha: <b>{label}</b></span>
    </div>
  );
}

function Restore({ db, onBack, onRestored, onPulled }: { db: LocalDb; onBack: () => void; onRestored: (s: Session) => void; onPulled: () => void }) {
  const fromDrive = driveConfigured() && (
    <div className="card">
      <h2>Baixar do Google Drive</h2>
      <p className="muted">Se você já usa o Ficha Redonda em outro aparelho, entre com a conta Google em que o cofre está guardado. Depois o app pede a senha do cofre.</p>
      <PullFromGoogle db={db} onPulled={onPulled} />
    </div>
  );
  const [file, setFile] = useState<BackupFile | null>(null);
  const [fileName, setFileName] = useState('');
  const [secret, setSecret] = useState('');
  const [kind, setKind] = useState<'senha' | 'recuperacao'>('senha');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Onboard current={-1}>
      <div className="page-head"><h1>Já uso em outro aparelho</h1><p>Traga o cofre do Google Drive ou de uma cópia de segurança.</p></div>
      {fromDrive}
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!file) return;
          setBusy(true);
          setErr('');
          try {
            const s = await restoreBackup(db, file, secret, kind);
            if (!s) setErr(kind === 'senha' ? 'Senha incorreta para esta cópia.' : 'Código incorreto para esta cópia.');
            else onRestored(s);
          } catch (x) {
            setErr(friendlyError(x));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>{driveConfigured() ? 'Ou restaurar uma cópia de segurança' : 'Restaurar cópia de segurança'}</h2>
        <div className="field">
          <span className="label">Arquivo da cópia (.ficharedonda)</span>
          <FilePick accept=".ficharedonda,.json" label="Escolher a cópia" fileName={fileName} onFile={async (f) => {
            setFileName(f.name);
            try {
              setFile(JSON.parse(await readFile(f)) as BackupFile);
              setErr('');
            } catch {
              setFile(null);
              setErr('Não consegui ler esse arquivo. Ele precisa ser a cópia baixada em Ajustes (termina em .ficharedonda).');
            }
          }} />
        </div>
        <Choice label="Abrir com" value={kind} onChange={setKind} options={[['senha', 'Senha do cofre'], ['recuperacao', 'Código de recuperação']] as const} />
        <label className="field" htmlFor="r-secret"><span>{kind === 'senha' ? 'Senha' : 'Código'}</span><input id="r-secret" type={kind === 'senha' ? 'password' : 'text'} value={secret} onChange={(e) => setSecret(e.target.value)} /></label>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="row"><button className="btn primary" disabled={!file || !secret || busy}>{busy ? 'Restaurando…' : 'Restaurar'}</button><button type="button" className="btn" onClick={onBack}>Voltar</button></div>
      </form>
    </Onboard>
  );
}
