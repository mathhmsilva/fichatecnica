import type { Session } from '../app/service';
import { Section, plural, useSessionState } from './common';
import type { Go } from './Main';
import type { Pendencia } from '../domain/ficha';

const ONDE: Record<Pendencia['onde'], string> = { pizza: 'Pizzas', insumo: 'Insumos', preparo: 'Preparos' };

export function PendenciasScreen({ session, go }: { session: Session; go: Go }) {
  useSessionState(session);
  const todas = session.pendencias();
  const faltas = todas.filter((p) => p.gravidade === 'falta');
  const alertas = todas.filter((p) => p.gravidade === 'alerta');
  const abrir = (p: Pendencia) => go(p.onde === 'pizza' ? 'pizzas' : p.onde === 'insumo' ? 'insumos' : 'preparos', p.alvo);
  const lista = (items: Pendencia[]) => {
    // Agrupa por item: uma pizza com três alertas vira uma linha com os três.
    const por = new Map<string, Pendencia[]>();
    for (const p of items) por.set(`${p.onde}:${p.alvo}`, [...(por.get(`${p.onde}:${p.alvo}`) ?? []), p]);
    return (
      <ul className="todo">
        {[...por.values()].map((ps) => (
          <li key={`${ps[0]!.onde}:${ps[0]!.alvo}`}>
            <span className="t"><span className="dot" aria-hidden="true" /><span><b>{ps[0]!.item}</b> <span className="small muted">{ONDE[ps[0]!.onde]}</span><span className="d-block small">{ps.map((p) => p.problema).join(' · ')}</span><span className="d-block small muted">{ps[0]!.oQueFazer}</span></span></span>
            <button className="btn" onClick={() => abrir(ps[0]!)}>Abrir</button>
          </li>
        ))}
      </ul>
    );
  };
  return (
    <>
      <div className="page-head"><h1>Pendências</h1><p>Lista automática do que falta preencher ou está fora da meta. Some sozinha quando você corrige.</p></div>
      <Section title={faltas.length ? `Falta preencher (${faltas.length})` : 'Falta preencher'}>
        {faltas.length ? lista(faltas) : <div className="notice ok"><b>Tudo preenchido</b><span>Nenhuma ficha incompleta.</span></div>}
      </Section>
      <Section title={alertas.length ? `Alertas (${alertas.length})` : 'Alertas'}>
        {alertas.length ? (
          <>
            <p className="small muted">{plural(alertas.length, 'alerta', 'alertas')}: margem abaixo da meta, CMV acima do máximo e preço de insumo sem data ou antigo.</p>
            {lista(alertas)}
          </>
        ) : <p className="muted">Nenhum alerta.</p>}
      </Section>
    </>
  );
}
