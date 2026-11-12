import { useState } from 'react';
import type { Session } from '../app/service';
import { formatDateBR } from '../domain/date';
import { Section, useSessionState } from './common';
import { askConfirm, notify } from './feedback';
import type { Go } from './Main';
import { fmt, numText, pct } from './format';

export function HistoricoScreen({ session, go, open }: { session: Session; go: Go; open?: string }) {
  const state = useSessionState(session);
  const cat = state.catalogo;
  const comCompra = cat.insumos.filter((i) => cat.compras.some((c) => c.insumo === i.id)).sort((a, b) => a.nome.localeCompare(b.nome));
  const [sel, setSel] = useState(open && comCompra.some((i) => i.id === open) ? open : '');
  const compras = cat.compras.filter((c) => !sel || c.insumo === sel).sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
  const ins = cat.insumos.find((i) => i.id === sel);
  // Variação de cada compra contra a anterior do mesmo insumo.
  const anterior = (id: string, data: string, cid: string) => cat.compras.filter((c) => c.insumo === id && (c.data < data || (c.data === data && c.id < cid))).sort((a, b) => (a.data < b.data ? 1 : -1))[0];
  const serie = ins ? [...compras].reverse().map((c) => ({ data: c.data, v: c.precoPago / (c.qtd || 1) })) : [];
  return (
    <>
      <div className="row between">
        <h1>Histórico de preços</h1>
        <button className="btn primary" onClick={() => go('insumos', sel ? `compra:${sel}` : 'compra')}>Lançar compra</button>
      </div>
      {comCompra.length === 0 ? <p className="muted">Nenhuma compra lançada ainda. Cada compra lançada em Insumos entra aqui, com a variação contra a anterior.</p> : (
        <>
          <select aria-label="Insumo" value={sel} onChange={(e) => setSel(e.target.value)}>
            <option value="">Todos os insumos</option>
            {comCompra.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
          </select>
          {ins && serie.length > 1 && <Sparkline pontos={serie} unidade={ins.unidade} />}
          <Section title={ins ? ins.nome : 'Todas as compras'}>
            <div className="table-wrap">
              <table className="compact">
                <thead><tr><th>Data</th>{!ins && <th>Insumo</th>}<th className="r">Pago</th><th className="r">Qtd.</th><th className="r">Por unidade</th><th className="r">Variação</th><th>Fornecedor</th><th></th></tr></thead>
                <tbody>
                  {compras.map((c) => {
                    const i = cat.insumos.find((x) => x.id === c.insumo);
                    const prev = anterior(c.insumo, c.data, c.id);
                    const u = c.precoPago / (c.qtd || 1);
                    const v = prev ? u / (prev.precoPago / (prev.qtd || 1)) - 1 : null;
                    return (
                      <tr key={c.id}>
                        <td>{formatDateBR(c.data)}</td>
                        {!ins && <td><button className="btn link" onClick={() => setSel(c.insumo)}>{i?.nome ?? 'Insumo apagado'}</button></td>}
                        <td className="r num">{fmt(c.precoPago)}</td>
                        <td className="r num">{numText(c.qtd, 3)} {i?.unidade}</td>
                        <td className="r num">{fmt(u)}</td>
                        <td className={`r num ${v === null ? '' : v > 0.0005 ? 'neg' : v < -0.0005 ? 'pos' : ''}`}>{v === null ? '—' : `${v > 0 ? '+' : ''}${pct(v)}`}</td>
                        <td>{c.fornecedor ?? ''}</td>
                        <td><button className="btn link small" aria-label="Apagar esta compra" onClick={async () => {
                          if (!(await askConfirm('Apagar esta compra do histórico?', { detail: 'O preço atual do insumo não muda.', confirm: 'Apagar' }))) return;
                          await session.removeCompra(c.id);
                          notify('Compra apagada.', { undo: () => session.addCompra(c, false) });
                        }}>Apagar</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </>
  );
}

/** Linha simples do preço por unidade ao longo das compras. */
function Sparkline({ pontos, unidade }: { pontos: { data: string; v: number }[]; unidade: string }) {
  const W = 600;
  const H = 120;
  const min = Math.min(...pontos.map((p) => p.v));
  const max = Math.max(...pontos.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => 16 + (i * (W - 32)) / Math.max(1, pontos.length - 1);
  const y = (v: number) => H - 20 - ((v - min) / span) * (H - 40);
  const d = pontos.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  const last = pontos[pontos.length - 1]!;
  return (
    <section className="card spark" aria-label={`Preço por ${unidade} de ${formatDateBR(pontos[0]!.data)} a ${formatDateBR(last.data)}: de ${fmt(pontos[0]!.v)} para ${fmt(last.v)}`}>
      <div className="row between small muted"><span>Preço por {unidade}</span><span>mín. {fmt(min)} · máx. {fmt(max)}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-hidden="true" preserveAspectRatio="none">
        <path d={d} className="spark-line" />
        {pontos.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.v)} r={4} className="spark-dot" />)}
      </svg>
      <div className="row between small muted"><span>{formatDateBR(pontos[0]!.data)}</span><span>{formatDateBR(last.data)}</span></div>
    </section>
  );
}
