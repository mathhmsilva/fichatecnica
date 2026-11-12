import { useState } from 'react';
import type { Session } from '../app/service';
import { meioAMeio, type RegraMeio, type Tamanho } from '../domain/ficha';
import { Choice, useSessionState } from './common';
import { fmt, pct } from './format';

export function MeioAMeioScreen({ session }: { session: Session }) {
  const state = useSessionState(session);
  const cat = state.catalogo;
  const ativas = cat.pizzas.filter((p) => p.ativa && p.linhas.length);
  const [a, setA] = useState(ativas[0]?.id ?? '');
  const [b, setB] = useState(ativas[1]?.id ?? '');
  const [t, setT] = useState<Tamanho>('M');
  const [canal, setCanal] = useState(cat.canais[0]?.id ?? '');
  const [regra, setRegra] = useState<RegraMeio>('maior');
  const pa = session.pizza(a);
  const pb = session.pizza(b);
  const k = cat.canais.find((x) => x.id === canal);
  const r = pa && pb && k ? meioAMeio(pa, pb, t, k, cat.config, regra) : null;
  const incompleta = !!(pa && pb && (pa[t].faltaQtd || pb[t].faltaQtd));
  const sabor = (id: string, set: (v: string) => void, label: string) => (
    <label className="field" htmlFor={`mm-${label}`}><span>{label}</span>
      <select id={`mm-${label}`} value={id} onChange={(e) => set(e.target.value)}>
        {ativas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
      </select>
    </label>
  );
  return (
    <>
      <div className="page-head"><h1>Meio a meio</h1><p>CMV = média da comida dos dois sabores + embalagem (só no delivery). O preço segue a regra escolhida.</p></div>
      {ativas.length < 2 ? <p className="muted">Precisa de pelo menos duas pizzas com ficha.</p> : (
        <>
          <section className="card">
            <div className="grid">
              {sabor(a, setA, 'Sabor 1')}
              {sabor(b, setB, 'Sabor 2')}
              <label className="field" htmlFor="mm-canal"><span>Canal</span>
                <select id="mm-canal" value={canal} onChange={(e) => setCanal(e.target.value)}>{cat.canais.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select>
              </label>
            </div>
            <div className="grid">
              <div className="field"><span className="label">Tamanho</span><Choice label="Tamanho" value={t} onChange={setT} options={[['M', 'Médio'], ['G', 'Grande']] as const} /></div>
              <div className="field"><span className="label">Regra de preço</span><Choice label="Regra de preço" value={regra} onChange={setRegra} options={[['maior', 'Maior preço'], ['media', 'Média dos preços']] as const} /></div>
            </div>
          </section>
          {r && (
            <section className="hero" aria-label="Resultado">
              <span className="eyebrow">{pa!.pizza.nome} + {pb!.pizza.nome}</span>
              {r.faltaPreco ? <p>Um dos sabores não é vendido no {k!.nome} nesse tamanho.</p> : (
                <>
                  <div className="stack gap-6"><span className="small on-ink-muted">Margem</span><span className="big num">{fmt(r.margem)}</span><span className="small on-ink-muted">{pct(r.margemPct)} do preço · meta do canal {pct(k!.margemAlvo, 0)}</span></div>
                  <div className="figures">
                    <div className="figure"><span className="lbl">Preço de venda</span><span className="val num">{fmt(r.preco)}</span></div>
                    <div className="figure"><span className="lbl">CMV ({pct(r.cmvPct)})</span><span className="val num">{fmt(r.cmv)}</span></div>
                    <div className="figure"><span className="lbl">Comida (média)</span><span className="val num">{fmt(r.comida)}</span></div>
                    <div className="figure"><span className="lbl">Embalagem</span><span className="val num">{fmt(r.embalagem)}</span></div>
                    <div className="figure"><span className="lbl">Comissão, taxas e impostos</span><span className="val num">{fmt(r.descontos)}</span></div>
                    <div className="figure"><span className="lbl">Custos por pedido</span><span className="val num">{fmt(r.fixos)}</span></div>
                  </div>
                  {incompleta && <p className="small">Atenção: uma das fichas está sem as quantidades do {t === 'M' ? 'Médio' : 'Grande'}.</p>}
                  {r.cmvPct !== null && r.cmvPct > cat.config.cmvMaximo && <p className="small">O CMV passa do máximo desejado ({pct(cat.config.cmvMaximo, 0)}).</p>}
                </>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
