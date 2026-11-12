import { useState } from 'react';
import type { Session } from '../app/service';
import { CLASSE_DICA, TAMANHOS, TAMANHO_NOME, precoDe, type Classe, type Venda } from '../domain/ficha';
import { Choice, Section, today, useSessionState } from './common';
import { notify, useAction } from './feedback';
import type { Go } from './Main';
import { fmt, parseNum, pct, periodoLabel } from './format';

const CLASSES: Classe[] = ['Estrela', 'Quebra-cabeça', 'Burro de carga', 'Cão'];

export function VendasScreen({ session, go }: { session: Session; go: Go }) {
  const state = useSessionState(session);
  const [tab, setTab] = useState<'lancar' | 'cardapio'>(state.catalogo.vendas.length ? 'cardapio' : 'lancar');
  return (
    <>
      <div className="page-head"><h1>Vendas e engenharia de cardápio</h1><p>Lance quanto vendeu de cada pizza no mês. O app cruza com a margem de cada canal e classifica o cardápio.</p></div>
      <Choice label="Ver" value={tab} onChange={setTab} options={[['lancar', 'Lançar vendas'], ['cardapio', 'Engenharia de cardápio']] as const} />
      {tab === 'lancar' ? <Lancar key={state.catalogo.vendas.length} session={session} onDone={() => setTab('cardapio')} /> : <Cardapio session={session} go={go} />}
    </>
  );
}

function Lancar({ session, onDone }: { session: Session; onDone: () => void }) {
  const cat = session.catalogo;
  const [periodo, setPeriodo] = useState(session.periodosComVenda()[0] ?? today().slice(0, 7));
  const key = (p: string, k: string, t: string) => `${p}|${k}|${t}`;
  const load = (per: string) => Object.fromEntries(cat.vendas.filter((v) => v.periodo === per).map((v) => [key(v.pizza, v.canal, v.tamanho), String(v.qtd)]));
  const [q, setQ] = useState<Record<string, string>>(() => load(periodo));
  const act = useAction();
  const pizzas = cat.pizzas.filter((p) => p.ativa);
  const cols = cat.canais.flatMap((k) => TAMANHOS.map((t) => ({ k, t }))).filter(({ k, t }) => pizzas.some((p) => precoDe(p, k.id, t) !== null));
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); void act.run(async () => {
      const vendas: Venda[] = [];
      for (const p of pizzas) for (const { k, t } of cols) {
        const n = parseNum(q[key(p.id, k.id, t)] ?? '');
        if (n && n > 0) vendas.push({ periodo, pizza: p.id, canal: k.id, tamanho: t, qtd: Math.round(n) });
      }
      await session.setVendas(periodo, vendas);
      notify(`Vendas de ${periodoLabel(periodo)} salvas.`);
      onDone();
    }); }}>
      <section className="card">
        <label className="field" htmlFor="v-per"><span>Mês</span><input id="v-per" type="month" value={periodo} max={today().slice(0, 7)} onChange={(e) => { setPeriodo(e.target.value); setQ(load(e.target.value)); }} /></label>
        <div className="table-wrap">
          <table className="compact inputs">
            <thead>
              <tr><th>Pizza</th>{cols.map(({ k, t }) => <th key={`${k.id}${t}`} className="r">{k.nome}<span className="d-block small muted">{TAMANHO_NOME[t]}</span></th>)}</tr>
            </thead>
            <tbody>
              {pizzas.map((p) => (
                <tr key={p.id}>
                  <td>{p.nome}</td>
                  {cols.map(({ k, t }) => (
                    <td key={`${k.id}${t}`}>{precoDe(p, k.id, t) === null ? <span className="muted">—</span> : <input aria-label={`${p.nome}, ${k.nome}, ${TAMANHO_NOME[t]}`} inputMode="numeric" value={q[key(p.id, k.id, t)] ?? ''} onChange={(e) => setQ({ ...q, [key(p.id, k.id, t)]: e.target.value.replace(/\D/g, '') })} placeholder="0" />}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">Quantidade de pizzas vendidas no mês (meio a meio conta meia para cada sabor, se quiser ser exato). Só aparecem os canais e tamanhos com preço.</p>
      </section>
      {act.error && <p className="error" role="alert">{act.error}</p>}
      <div className="actions-bar"><button className="btn primary big" disabled={act.busy}>Salvar vendas do mês</button></div>
    </form>
  );
}

function Cardapio({ session, go }: { session: Session; go: Go }) {
  const periodos = session.periodosComVenda();
  const [periodo, setPeriodo] = useState(periodos[0] ?? 'todos');
  const [canal, setCanal] = useState('');
  const eng = session.engenharia(periodo, canal || undefined);
  if (!periodos.length) return <p className="muted">Ainda não há vendas lançadas. Lance as quantidades do mês para ver a classificação.</p>;
  return (
    <>
      <div className="row">
        <select aria-label="Período" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
          {periodos.map((p) => <option key={p} value={p}>{periodoLabel(p)}</option>)}
          {periodos.length > 1 && <option value="todos">Todos os meses</option>}
        </select>
        <select aria-label="Canal" value={canal} onChange={(e) => setCanal(e.target.value)}>
          <option value="">Todos os canais</option>
          {session.catalogo.canais.map((k) => <option key={k.id} value={k.id}>{k.nome}</option>)}
        </select>
      </div>
      <div className="grid stats-4">
        <div className="stat card flat"><span className="small muted">Pizzas vendidas</span><span className="value num">{eng.qtdTotal}</span></div>
        <div className="stat card flat"><span className="small muted">Faturamento</span><span className="value num small-value">{fmt(eng.faturamento)}</span></div>
        <div className="stat card flat"><span className="small muted">CMV ponderado</span><span className="value num">{pct(eng.faturamento ? eng.cmvTotal / eng.faturamento : null)}</span></div>
        <div className="stat card flat"><span className="small muted">Margem total</span><span className="value num small-value">{fmt(eng.margemTotal)}</span></div>
      </div>
      <div className="matrix">
        {CLASSES.map((c) => {
          const ls = eng.linhas.filter((l) => l.classe === c);
          return (
            <section key={c} className={`card matrix-cell m-${c === 'Estrela' ? 'estrela' : c === 'Cão' ? 'cao' : c === 'Burro de carga' ? 'burro' : 'quebra'}`} aria-label={c}>
              <h2>{c} <span className="small muted">{ls.length}</span></h2>
              <p className="small muted">{CLASSE_DICA[c]}</p>
              <ul className="plain-list">{ls.map((l) => <li key={l.pizza.id}><button className="btn link" onClick={() => go('pizzas', l.pizza.id)}>{l.pizza.nome}</button></li>)}</ul>
            </section>
          );
        })}
      </div>
      <Section title="Detalhe">
        <div className="table-wrap">
          <table className="compact">
            <thead><tr><th>Pizza</th><th className="r">Vendidas</th><th className="r">Mix</th><th className="r">Margem unit.</th><th className="r">Margem total</th><th>Classe</th></tr></thead>
            <tbody>
              {eng.linhas.map((l) => (
                <tr key={l.pizza.id}><td>{l.pizza.nome}</td><td className="r num">{l.qtd}</td><td className="r num">{pct(l.mix)}</td><td className="r num">{fmt(l.margemUnit)}</td><td className="r num">{fmt(l.margemTotal)}</td><td>{l.classe}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">Popular: mix de pelo menos {pct(eng.corteMix)} (70% da participação média). Lucrativa: margem por pizza de pelo menos {fmt(eng.corteMargem)} (a média ponderada).</p>
      </Section>
    </>
  );
}
