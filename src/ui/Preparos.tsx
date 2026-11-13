import { useMemo, useState } from 'react';
import { novoId, type Session } from '../app/service';
import { Custos, UNIDADES, type ItemPreparo, type Preparo, type Unidade } from '../domain/ficha';
import { Section, useSessionState } from './common';
import { askConfirm, notify, useAction } from './feedback';
import type { Go } from './Main';
import { fatorDigitado, fmt, numText, parseNum, pct, qtd, unidadeDigitada } from './format';
import { Icon } from './Icon';

export function PreparosScreen({ session, go, open }: { session: Session; go: Go; open?: string }) {
  const state = useSessionState(session);
  const c = session.custos();
  const preparos = state.catalogo.preparos;
  if (open === 'novo') return <PreparoEditor session={session} preparo={null} onDone={(id) => go('preparos', id)} onCancel={() => go('preparos')} />;
  const sel = open ? preparos.find((p) => p.id === open) : undefined;
  if (sel) return <PreparoDetail session={session} preparo={sel} go={go} />;
  return (
    <>
      <div className="row between">
        <h1>Preparos</h1>
        <button className="btn primary" onClick={() => go('preparos', 'novo')}><Icon name="mais_um" size={18} />Novo preparo</button>
      </div>
      <p className="muted">Massa, molho, pesto: o que é feito na cozinha e entra nas pizzas como um ingrediente. O custo por quilo vem da receita e do rendimento.</p>
      {preparos.length === 0 ? <p className="muted">Nenhum preparo ainda.</p> : (
        <ul className="pizza-grid">
          {preparos.map((p) => {
            const r = c.resumoPreparo(p);
            return (
              <li key={p.id}>
                <button className="pizza-card" onClick={() => go('preparos', p.id)}>
                  <span className="pizza-name">{p.nome}</span>
                  <span className="small muted">Rende {qtd(r.liquido, p.unidade)}{p.perda ? ` (perda de ${pct(p.perda, 0)})` : ''}</span>
                  <span className="pizza-figs">
                    <span><span className="lbl">Custo da receita</span><span className="num">{fmt(r.custoTotal)}</span></span>
                    <span><span className="lbl">Por {p.unidade}</span><span className="num">{fmt(r.custoUnidade)}</span></span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function PreparoDetail({ session, preparo, go }: { session: Session; preparo: Preparo; go: Go }) {
  const [editing, setEditing] = useState(false);
  const c = session.custos();
  const r = c.resumoPreparo(preparo);
  const uso = session.ondeUsa(preparo.id);
  if (editing) return <PreparoEditor session={session} preparo={preparo} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} onRemoved={() => go('preparos')} />;
  return (
    <>
      <div className="crumbs"><button className="btn link" onClick={() => go('preparos')}>‹ Preparos</button></div>
      <div className="page-head"><h1>{preparo.nome}</h1></div>
      <div className="grid stats-4">
        <div className="stat card flat"><span className="small muted">Custo da receita</span><span className="value num">{fmt(r.custoTotal)}</span></div>
        <div className="stat card flat"><span className="small muted">Rendimento bruto</span><span className="value num small-value">{qtd(r.bruto, preparo.unidade)}</span></div>
        <div className="stat card flat"><span className="small muted">Rendimento líquido</span><span className="value num small-value">{qtd(r.liquido, preparo.unidade)}</span><span className="small muted">perda {pct(preparo.perda, 0)}</span></div>
        <div className="stat card flat"><span className="small muted">Custo por {preparo.unidade}</span><span className="value num">{fmt(r.custoUnidade)}</span></div>
      </div>
      <div className="row"><button className="btn" onClick={() => setEditing(true)}>Editar</button></div>
      <Section title="Receita">
        {r.linhas.length === 0 ? <p className="muted">Sem ingredientes ainda.</p> : (
          <div className="table-wrap">
            <table className="compact">
              <thead><tr><th>Ingrediente</th><th className="r">Quantidade</th><th className="r">Custo unit.</th><th className="r">Custo</th></tr></thead>
              <tbody>
                {r.linhas.map((l, i) => (
                  <tr key={i}><td>{c.nome(l.ref)}</td><td className="r num">{qtd(l.qtd, c.unidade(l.ref))}</td><td className="r num">{fmt(l.unit)}</td><td className="r num">{fmt(l.custo)}</td></tr>
                ))}
                <tr className="total"><td>Total</td><td className="r num">{qtd(r.bruto, preparo.unidade)}</td><td /><td className="r num">{fmt(r.custoTotal)}</td></tr>
              </tbody>
            </table>
          </div>
        )}
        {preparo.obs && <p className="small"><b>Observações:</b> {preparo.obs}</p>}
      </Section>
      <Section title="Onde é usado">
        {uso.pizzas.length + uso.preparos.length === 0 ? <p className="muted">Não está em nenhuma ficha.</p> : (
          <div className="chips">
            {uso.preparos.map((p) => <button key={p.id} className="chip-btn" onClick={() => go('preparos', p.id)}>{p.nome}</button>)}
            {uso.pizzas.map((p) => <button key={p.id} className="chip-btn" onClick={() => go('pizzas', p.id)}>{p.nome}</button>)}
          </div>
        )}
      </Section>
    </>
  );
}

function PreparoEditor({ session, preparo, onDone, onCancel, onRemoved }: { session: Session; preparo: Preparo | null; onDone: (id: string) => void; onCancel: () => void; onRemoved?: () => void }) {
  const cat = session.catalogo;
  const c = session.custos();
  const [nome, setNome] = useState(preparo?.nome ?? '');
  const [unidade, setUnidade] = useState<Unidade>(preparo?.unidade ?? 'kg');
  const [perda, setPerda] = useState(numText(preparo ? preparo.perda * 100 : 0, 1));
  const [obs, setObs] = useState(preparo?.obs ?? '');
  const [itens, setItens] = useState<{ ref: string; q: string }[]>(() => preparo?.itens.map((i) => ({ ref: i.ref, q: numText(i.qtd * fatorDigitado(c.unidade(i.ref)), 2) })) ?? []);
  const act = useAction();
  const build = (id: string): Preparo => ({
    id, nome: nome.trim(), unidade, perda: Math.min(Math.max((parseNum(perda) ?? 0) / 100, 0), 0.99),
    itens: itens.filter((i) => i.ref && parseNum(i.q) !== null).map((i): ItemPreparo => ({ ref: i.ref, qtd: parseNum(i.q)! / fatorDigitado(c.unidade(i.ref)) })),
    ...(obs.trim() ? { obs: obs.trim() } : {}),
  });
  const id = preparo?.id ?? 'rascunho';
  const resumo = useMemo(() => new Custos({ insumos: cat.insumos, preparos: [...cat.preparos.filter((p) => p.id !== id), build(id)] }).resumoPreparo(build(id)), [nome, unidade, perda, itens, cat]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form className="stack" onSubmit={(e) => {
      e.preventDefault();
      void act.run(async () => {
        if (!nome.trim()) throw new Error('Dê um nome para o preparo.');
        const novo = preparo?.id ?? novoId('PR');
        await session.savePreparo(build(novo));
        notify(preparo ? 'Preparo salvo.' : 'Preparo cadastrado.');
        onDone(novo);
      });
    }}>
      <div className="page-head"><h1>{preparo ? `Editar ${preparo.nome}` : 'Novo preparo'}</h1></div>
      <section className="card">
        <div className="grid">
          <label className="field" htmlFor="pr-nome"><span>Nome</span><input id="pr-nome" value={nome} onChange={(e) => setNome(e.target.value)} required /></label>
          <label className="field" htmlFor="pr-un"><span>Rende em</span><select id="pr-un" value={unidade} onChange={(e) => setUnidade(e.target.value as Unidade)}>{UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
          <label className="field" htmlFor="pr-perda"><span>Perda de produção (%)</span><input id="pr-perda" inputMode="decimal" value={perda} onChange={(e) => setPerda(e.target.value)} /><small>Evaporação, sobra na panela.</small></label>
        </div>
      </section>
      <section className="card" aria-label="Receita do preparo">
        <div className="row between"><h2>Receita</h2><span className="small muted">Rende {qtd(resumo.liquido, unidade)} · {fmt(resumo.custoUnidade)} por {unidade}</span></div>
        <ul className="recipe-edit">
          {itens.map((it, i) => (
            <li key={i}>
              <div className="recipe-row">
                <select aria-label="Ingrediente" className="grow-2" value={it.ref} onChange={(e) => setItens(itens.map((x, j) => (j === i ? { ...x, ref: e.target.value } : x)))}>
                  <option value="">Escolha o ingrediente</option>
                  <optgroup label="Insumos">{[...cat.insumos].sort((a, b) => a.nome.localeCompare(b.nome)).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</optgroup>
                  {cat.preparos.some((p) => p.id !== preparo?.id) && <optgroup label="Preparos">{cat.preparos.filter((p) => p.id !== preparo?.id).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</optgroup>}
                </select>
                <label className="qty"><span>Quantidade</span><input inputMode="decimal" aria-label="Quantidade" value={it.q} onChange={(e) => setItens(itens.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} /><em>{unidadeDigitada(c.unidade(it.ref))}</em></label>
                <button type="button" className="btn icon-btn" aria-label="Tirar esta linha" onClick={() => setItens(itens.filter((_, j) => j !== i))}>×</button>
              </div>
            </li>
          ))}
        </ul>
        <div><button type="button" className="btn" onClick={() => setItens([...itens, { ref: '', q: '' }])}><Icon name="mais_um" size={18} />Adicionar ingrediente</button></div>
      </section>
      <label className="field" htmlFor="pr-obs"><span>Observações (opcional)</span><textarea id="pr-obs" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} /></label>
      {act.error && <p className="error" role="alert">{act.error}</p>}
      <div className="actions-bar">
        <button className="btn primary big" disabled={act.busy}>Salvar</button>
        <button type="button" className="btn" onClick={onCancel}>Cancelar</button>
        {preparo && onRemoved && (
          <button type="button" className="btn link danger" onClick={() => void act.run(async () => {
            if (!(await askConfirm(`Apagar ${preparo.nome}?`, { confirm: 'Apagar', danger: true }))) return;
            await session.removePreparo(preparo.id);
            notify(`${preparo.nome} apagado.`, { undo: () => session.savePreparo(preparo) });
            onRemoved();
          })}>Apagar preparo</button>
        )}
      </div>
    </form>
  );
}
