import type { Session } from '../app/service';
import { TAMANHO_NOME, type Compra } from '../domain/ficha';
import { Section, plural, today, useSessionState } from './common';
import { Icon } from './Icon';
import type { Go } from './Main';
import { fmt, pct } from './format';

/** Variação de preço por unidade de cada insumo: última compra contra a anterior. */
export function variacoes(compras: Compra[]): Map<string, { atual: Compra; anterior: Compra; variacao: number }> {
  const por = new Map<string, Compra[]>();
  for (const c of compras) por.set(c.insumo, [...(por.get(c.insumo) ?? []), c]);
  const out = new Map<string, { atual: Compra; anterior: Compra; variacao: number }>();
  for (const [id, list] of por) {
    const s = [...list].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
    const atual = s[s.length - 1];
    const anterior = s[s.length - 2];
    if (!atual || !anterior) continue;
    const ua = atual.precoPago / (atual.qtd || 1);
    const ub = anterior.precoPago / (anterior.qtd || 1);
    if (ub > 0) out.set(id, { atual, anterior, variacao: ua / ub - 1 });
  }
  return out;
}

export function Home({ session, go }: { session: Session; go: Go }) {
  const state = useSessionState(session);
  const cat = state.catalogo;
  const calc = session.pizzasCalculadas();
  const pend = session.pendencias();
  const faltas = pend.filter((p) => p.gravidade === 'falta');
  const ativas = cat.pizzas.filter((p) => p.ativa);
  const salao = cat.canais.find((c) => !c.usaEmbalagem) ?? cat.canais[0];

  // CMV % médio do Médio em cada canal (só pizzas com ficha e preço ali).
  const medias = cat.canais.map((k) => {
    const vals = ativas.map((p) => calc.get(p.id)?.resultados.find((r) => r.canal.id === k.id && r.tamanho === 'M')).filter((r) => r && r.cmvPct !== null && r.cmv > 0).map((r) => r!.cmvPct!);
    return { canal: k, cmv: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
  });
  const principal = medias.find((m) => m.canal.id === salao?.id) ?? medias[0];

  // Abaixo da meta: maior distância entre a margem e a meta primeiro.
  const abaixo = ativas.flatMap((p) => {
    const pc = calc.get(p.id);
    if (!pc || !p.linhas.length) return [];
    return pc.resultados.filter((r) => r.preco !== null && r.margemPct !== null && !pc[r.tamanho].faltaQtd && r.margemPct < r.canal.margemAlvo).map((r) => ({ p, r, gap: r.canal.margemAlvo - r.margemPct! }));
  }).sort((a, b) => b.gap - a.gap);

  const subiram = [...variacoes(cat.compras).entries()].filter(([, v]) => v.variacao > 0.005).sort((a, b) => b[1].variacao - a[1].variacao).slice(0, 5);

  const todayIso = today();
  const made = session.header.wrappers.filter((w) => w.kind === 'recuperacao').map((w) => w.createdAt).sort()[0];
  const recovery = state.lastRecoveryTest ?? made;
  const testar = !recovery || Date.parse(todayIso) - Date.parse(recovery) > 182 * 86_400_000;

  if (!cat.pizzas.length && !cat.insumos.length) {
    return (
      <>
        <section className="hero" aria-label="Começo">
          <span className="eyebrow">{state.settings.businessName || 'Sua pizzaria'}</span>
          <h1 className="hero-title">Vamos trazer as suas fichas técnicas</h1>
          <p className="on-ink-muted">Baixe a planilha de fichas técnicas como Excel (.xlsx) e importe aqui. Pizzas, receitas, insumos, preparos e canais entram de uma vez; dá para conferir antes de gravar.</p>
          <div className="actions two">
            <button className="btn primary" onClick={() => go('importar')}><Icon name="importar" size={18} />Importar planilha</button>
            <button className="btn" onClick={() => go('insumos')}><Icon name="mais_um" size={18} />Começar do zero</button>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <section className="hero" aria-label="Resumo">
        <span className="eyebrow">{state.settings.businessName || 'Sua pizzaria'}</span>
        <div className="stack gap-6">
          <span className="small on-ink-muted">CMV médio no {principal?.canal.nome ?? 'salão'} (Médio)</span>
          <span className="big num">{pct(principal?.cmv ?? null)}</span>
          <span className="small on-ink-muted">Máximo desejado: {pct(cat.config.cmvMaximo, 0)}</span>
        </div>
        <div className="figures">
          {medias.filter((m) => m !== principal).slice(0, 2).map((m) => (
            <div key={m.canal.id} className="figure"><span className="lbl">CMV no {m.canal.nome}</span><span className="val num">{pct(m.cmv)}</span></div>
          ))}
          <div className="figure"><span className="lbl">Pizzas ativas</span><span className="val num">{ativas.length}</span></div>
          <div className="figure"><span className="lbl">Pendências</span><span className="val num">{faltas.length}</span></div>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => go('pizzas')}><Icon name="pizzas" size={18} />Fichas</button>
          <button className="btn" onClick={() => go('insumos', 'compra')}><Icon name="insumos" size={18} />Compra</button>
          <button className="btn" onClick={() => go('meio')}><Icon name="meio" size={18} />Meio a meio</button>
        </div>
      </section>

      <Section title="O que precisa da sua atenção" actions={pend.length ? <button className="btn link" onClick={() => go('pendencias')}>Ver todas</button> : undefined}>
        {faltas.length === 0 && !testar ? (
          <div className="notice ok"><b>Fichas em dia</b><span>Nenhuma ficha incompleta.{pend.length ? ` ${plural(pend.length, 'alerta', 'alertas')} de margem ou de preço em Pendências.` : ''}</span></div>
        ) : (
          <ul className="todo">
            {faltas.slice(0, 6).map((p) => (
              <li key={p.id}>
                <span className="t"><span className="dot" aria-hidden="true" /><span><b>{p.item}</b>: {p.problema.toLowerCase()}.</span></span>
                <button className="btn" onClick={() => go(p.onde === 'pizza' ? 'pizzas' : p.onde === 'insumo' ? 'insumos' : 'preparos', p.alvo)}>Abrir</button>
              </li>
            ))}
            {faltas.length > 6 && (
              <li><span className="t"><span className="dot" aria-hidden="true" />E mais {plural(faltas.length - 6, 'pendência', 'pendências')}.</span><button className="btn" onClick={() => go('pendencias')}>Ver</button></li>
            )}
            {testar && (
              <li><span className="t"><span className="dot" aria-hidden="true" />Teste um código de recuperação (a cada 6 meses).</span><button className="btn" onClick={() => go('ajustes')}>Testar</button></li>
            )}
          </ul>
        )}
      </Section>

      <Section title="Abaixo da margem-alvo" actions={<button className="btn link" onClick={() => go('canais')}>Comparar canais</button>}>
        {abaixo.length === 0 ? (
          <p className="muted">Todas as pizzas com ficha completa estão na meta de cada canal.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Pizza</th><th>Canal</th><th className="r">Margem</th><th className="r">Meta</th><th className="r">Sugerido</th></tr></thead>
              <tbody>
                {abaixo.slice(0, 8).map(({ p, r }) => (
                  <tr key={`${p.id}-${r.canal.id}-${r.tamanho}`} className="clickable" onClick={() => go('pizzas', p.id)}>
                    <td>{p.nome} <span className="muted small">{TAMANHO_NOME[r.tamanho]}</span></td>
                    <td>{r.canal.nome}</td>
                    <td className="r num neg">{pct(r.margemPct)}</td>
                    <td className="r num">{pct(r.canal.margemAlvo, 0)}</td>
                    <td className="r num">{fmt(r.sugerido)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {abaixo.length > 8 && <p className="small muted">E mais {abaixo.length - 8}.</p>}
          </div>
        )}
      </Section>

      <Section title="Insumos que subiram" actions={<button className="btn link" onClick={() => go('precos')}>Histórico de preços</button>}>
        {subiram.length === 0 ? (
          <p className="muted">{cat.compras.length ? 'Nenhum insumo subiu na última compra.' : 'Quando você lançar as compras, aparece aqui o que subiu de preço e quanto isso mexe no CMV.'}</p>
        ) : (
          <ul className="plain-list">
            {subiram.map(([id, v]) => {
              const ins = cat.insumos.find((i) => i.id === id);
              return (
                <li key={id} className="row between">
                  <button className="btn link" onClick={() => go('precos', id)}>{ins?.nome ?? id}</button>
                  <span className="num neg">+{pct(v.variacao)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}
