import { useEffect, useState } from 'react';
import type { Session } from '../app/service';
import { useSessionState } from './common';
import { SettingsScreen } from './Settings';
import { AccountChip, HomeDriveNotice, SyncBanner, useAutoSync } from './sync';
import { Icon, type IconName } from './Icon';
import { Wordmark } from './Brand';
import { clearToasts, ConfirmHost, Toaster } from './feedback';
import { Home } from './Home';
import { PizzasScreen } from './Pizzas';
import { InsumosScreen } from './Insumos';
import { PreparosScreen } from './Preparos';
import { CanaisScreen } from './Canais';
import { MeioAMeioScreen } from './MeioAMeio';
import { VendasScreen } from './Vendas';
import { HistoricoScreen } from './Historico';
import { PendenciasScreen } from './Pendencias';
import { ImportarScreen } from './Importar';

export type Screen = 'inicio' | 'pizzas' | 'insumos' | 'canais' | 'preparos' | 'meio' | 'vendas' | 'precos' | 'pendencias' | 'importar' | 'ajustes';

/** Para onde ir, e opcionalmente qual item abrir lá (uma pizza, um insumo). */
export type Go = (s: Screen, item?: string) => void;

/** No celular, só as quatro primeiras ficam na barra; o resto vai em "Mais". */
const NAV: { id: Screen; label: string; short?: string; primary?: boolean; icon: IconName }[] = [
  { id: 'inicio', label: 'Início', primary: true, icon: 'inicio' },
  { id: 'pizzas', label: 'Pizzas e fichas', short: 'Pizzas', primary: true, icon: 'pizzas' },
  { id: 'insumos', label: 'Insumos', primary: true, icon: 'insumos' },
  { id: 'canais', label: 'Canais e preços', short: 'Preços', primary: true, icon: 'canais' },
  { id: 'pendencias', label: 'Pendências', icon: 'pendencias' },
  { id: 'preparos', label: 'Preparos', icon: 'preparos' },
  { id: 'meio', label: 'Meio a meio', icon: 'meio' },
  { id: 'vendas', label: 'Vendas e cardápio', icon: 'vendas' },
  { id: 'precos', label: 'Histórico de preços', icon: 'precos' },
  { id: 'ajustes', label: 'Ajustes', icon: 'ajustes' },
];

export function Main({ session, onLock }: { session: Session; onLock: () => void }) {
  const state = useSessionState(session);
  const [screen, setScreen] = useState<Screen>('inicio');
  const [item, setItem] = useState<string | undefined>(undefined);
  const [more, setMore] = useState(false);
  const pend = session.pendencias().filter((p) => p.gravidade === 'falta').length;
  const go: Go = (s, it) => {
    setScreen(s);
    setItem(it);
    setMore(false);
  };
  const openAccount = () => {
    go('ajustes');
    setTimeout(() => document.getElementById('ajustes-drive')?.setAttribute('open', ''), 30);
    setTimeout(() => document.getElementById('ajustes-drive')?.scrollIntoView({ block: 'start' }), 60);
  };
  const inMore = !NAV.find((n) => n.id === screen)?.primary;
  useAutoSync(session, state);

  useEffect(() => {
    document.body.classList.toggle('big-text', localStorageGet('bigText') === '1');
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
    clearToasts();
  }, [screen, item]);

  // Menu "Mais": Esc fecha e o foco vai para a primeira opção.
  useEffect(() => {
    if (!more) return;
    const first = document.querySelector<HTMLButtonElement>('.more-sheet button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMore(false); document.querySelector<HTMLButtonElement>('.more-btn')?.focus(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [more]);

  const badge = (id: Screen) => (id === 'pendencias' && pend > 0 ? <span className="badge" aria-label={`${pend} pendências`}>{pend}</span> : null);

  return (
    <div className="shell">
      <a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
      <nav className="nav no-print" aria-label="Menu principal">
        <div className="brand"><Wordmark size="sm" /></div>
        {NAV.map((n) => (
          <button key={n.id} type="button" className={n.primary ? '' : 'secondary'} aria-current={screen === n.id ? 'page' : undefined} onClick={() => go(n.id)}>
            <Icon name={n.icon} />
            <span className="label-long">{n.label}</span>
            {n.short && <span className="label-short">{n.short}</span>}
            {badge(n.id)}
          </button>
        ))}
        <button type="button" className="more-btn" aria-expanded={more} aria-current={inMore ? 'page' : undefined} onClick={() => setMore(!more)}>
          <Icon name="mais" />
          <span>Mais</span>
          {pend > 0 && <span className="badge" aria-label={`${pend} pendências`}>{pend}</span>}
        </button>
        <div className="spacer" />
        <div className="nav-foot">
          <AccountChip session={session} onOpen={openAccount} withLabel />
          <button type="button" onClick={onLock}><Icon name="travar" /><span className="label-long">Travar agora</span></button>
        </div>
      </nav>
      {more && (
        <>
          <button type="button" className="scrim no-print" aria-label="Fechar menu" onClick={() => setMore(false)} />
          <div className="more-sheet no-print" role="dialog" aria-modal="true" aria-label="Mais opções">
            {NAV.filter((n) => !n.primary).map((n) => (
              <button key={n.id} type="button" aria-current={screen === n.id ? 'page' : undefined} onClick={() => go(n.id)}><Icon name={n.icon} />{n.label}{badge(n.id)}</button>
            ))}
            <button type="button" onClick={onLock}><Icon name="travar" />Travar agora</button>
          </div>
        </>
      )}
      <main id="conteudo" tabIndex={-1}>
        <div className="topbar no-print">
          <Wordmark size="sm" />
          <div className="row gap-8">
            <AccountChip session={session} onOpen={openAccount} />
            <button type="button" className="lock" aria-label="Travar agora" onClick={onLock}><Icon name="travar" size={20} /></button>
          </div>
        </div>
        <SyncBanner session={session} />
        {screen === 'inicio' && <HomeDriveNotice session={session} onOpen={openAccount} />}
        {screen === 'inicio' && <Home session={session} go={go} />}
        {screen === 'pizzas' && <PizzasScreen key={item ?? ''} session={session} go={go} open={item} />}
        {screen === 'insumos' && <InsumosScreen key={item ?? ''} session={session} go={go} open={item} />}
        {screen === 'preparos' && <PreparosScreen key={item ?? ''} session={session} go={go} open={item} />}
        {screen === 'canais' && <CanaisScreen session={session} go={go} />}
        {screen === 'meio' && <MeioAMeioScreen session={session} />}
        {screen === 'vendas' && <VendasScreen session={session} go={go} />}
        {screen === 'precos' && <HistoricoScreen session={session} go={go} open={item} />}
        {screen === 'pendencias' && <PendenciasScreen session={session} go={go} />}
        {screen === 'importar' && <ImportarScreen session={session} go={go} />}
        {screen === 'ajustes' && <SettingsScreen session={session} onLock={onLock} onImport={() => go('importar')} />}
        <p className="muted small no-print page-foot">Fecha sozinho depois de {state.settings.deviceShared ? 10 : 15} minutos parado.</p>
      </main>
      <Toaster />
      <ConfirmHost />
    </div>
  );
}

export function localStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(`cr.${key}`);
  } catch {
    return null;
  }
}
export function localStorageSet(key: string, value: string) {
  try {
    localStorage.setItem(`cr.${key}`, value);
  } catch {
    /* sem armazenamento: só não lembra a preferência */
  }
}
