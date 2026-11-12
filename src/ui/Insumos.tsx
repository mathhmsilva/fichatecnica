import { useMemo, useState } from 'react';
import { novoId, type Session } from '../app/service';
import { Custos, UNIDADES, calcularPizza, custoInsumo, type Insumo, type Unidade } from '../domain/ficha';
import { formatDateBR } from '../domain/date';
import { Section, plural, today, useSessionState } from './common';
import { askConfirm, notify, useAction } from './feedback';
import type { Go } from './Main';
import { fmt, numText, parseNum, pct } from './format';
import { norm } from '../import/planilha';
import { Icon } from './Icon';

const porUnidade = (u: Unidade) => (u === 'un' ? 'por un' : `por ${u}`);

export function InsumosScreen({ session, go, open }: { session: Session; go: Go; open?: string }) {
  const state = useSessionState(session);
  const [busca, setBusca] = useState('');
  const [cat, setCat] = useState('');
  const insumos = state.catalogo.insumos;
  if (open === 'compra' || open?.startsWith('compra:')) return <CompraForm session={session} insumoId={open.split(':')[1]} onDone={() => go('insumos')} />;
  if (open === 'novo') return <InsumoEditor session={session} insumo={null} onDone={(id) => go('insumos', id)} onCancel={() => go('insumos')} />;
  const sel = open ? insumos.find((i) => i.id === open) : undefined;
  if (sel) return <InsumoDetail session={session} insumo={sel} go={go} />;
  const categorias = [...new Set(insumos.map((i) => i.categoria).filter(Boolean))].sort();
  const lista = insumos
    .filter((i) => !cat || i.categoria === cat)
    .filter((i) => !busca.trim() || norm(i.nome).includes(norm(busca)))
    .sort((a, b) => a.nome.localeCompare(b.nome));
  const dias = state.catalogo.config.diasDesatualizado;
  const hoje = today();
  return (
    <>
      <div className="row between">
        <h1>Insumos</h1>
        <div className="row">
          <button className="btn primary" onClick={() => go('insumos', 'compra')}><Icon name="insumos" size={18} />Lançar compra</button>
          <button className="btn" onClick={() => go('insumos', 'novo')}><Icon name="mais_um" size={18} />Novo insumo</button>
        </div>
      </div>
      <p className="muted">Preço pago e quantidade da compra viram o custo por unidade, já com a perda. Ao lançar uma compra, o preço novo passa a valer em todas as fichas.</p>
      <div className="row">
        <input className="grow-input" aria-label="Procurar insumo" placeholder="Procurar insumo" value={busca} onChange={(e) => setBusca(e.target.value)} />
        {categorias.length > 1 && (
          <select aria-label="Categoria" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">Todas as categorias</option>
            {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>
      {lista.length === 0 ? <p className="muted">{insumos.length ? 'Nenhum insumo com esse filtro.' : 'Nenhum insumo ainda.'}</p> : (
        <section className="card flush">
          <div className="table-wrap">
            <table className="compact">
              <thead><tr><th>Insumo</th><th className="r">Preço pago</th><th className="r">Perda</th><th className="r">Custo real</th><th>Última compra</th></tr></thead>
              <tbody>
                {lista.map((i) => {
                  const velho = i.atualizadoEm ? (Date.parse(hoje) - Date.parse(i.atualizadoEm)) / 86_400_000 > dias : true;
                  return (
                    <tr key={i.id} className="clickable" onClick={() => go('insumos', i.id)}>
                      <td><button className="btn link" onClick={(e) => { e.stopPropagation(); go('insumos', i.id); }}>{i.nome}</button><span className="small muted d-block">{i.categoria}</span></td>
                      <td className="r num">{i.precoPago === null ? <span className="warn-text">sem preço</span> : <>{fmt(i.precoPago)}<span className="small muted d-block">{numText(i.qtdComprada, 3)} {i.unidade}</span></>}</td>
                      <td className="r num">{i.perda ? pct(i.perda, 0) : '—'}</td>
                      <td className="r num"><b>{fmt(custoInsumo(i))}</b><span className="small muted d-block">{porUnidade(i.unidade)}</span></td>
                      <td className={velho ? 'warn-text small' : 'small'}>{i.atualizadoEm ? formatDateBR(i.atualizadoEm) : 'sem data'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function InsumoDetail({ session, insumo, go }: { session: Session; insumo: Insumo; go: Go }) {
  const [editing, setEditing] = useState(false);
  const uso = session.ondeUsa(insumo.id);
  const compras = session.catalogo.compras.filter((c) => c.insumo === insumo.id).sort((a, b) => (a.data < b.data ? 1 : -1));
  if (editing) return <InsumoEditor session={session} insumo={insumo} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} onRemoved={() => go('insumos')} />;
  return (
    <>
      <div className="crumbs"><button className="btn link" onClick={() => go('insumos')}>‹ Insumos</button></div>
      <div className="page-head"><h1>{insumo.nome}</h1><p className="muted">{insumo.categoria || 'Sem categoria'}{insumo.fornecedor ? ` · ${insumo.fornecedor}` : ''}</p></div>
      <div className="grid stats-4">
        <div className="stat card flat"><span className="small muted">Preço pago</span><span className="value num">{fmt(insumo.precoPago)}</span><span className="small muted">{numText(insumo.qtdComprada, 3)} {insumo.unidade}</span></div>
        <div className="stat card flat"><span className="small muted">Perda</span><span className="value num">{pct(insumo.perda, 0)}</span></div>
        <div className="stat card flat"><span className="small muted">Custo real {porUnidade(insumo.unidade)}</span><span className="value num">{fmt(custoInsumo(insumo))}</span></div>
        <div className="stat card flat"><span className="small muted">Última compra</span><span className="value num small-value">{insumo.atualizadoEm ? formatDateBR(insumo.atualizadoEm) : 'sem data'}</span></div>
      </div>
      <div className="row">
        <button className="btn primary" onClick={() => go('insumos', `compra:${insumo.id}`)}>Lançar compra</button>
        <button className="btn" onClick={() => setEditing(true)}>Editar</button>
      </div>
      <Section title="Onde é usado">
        {uso.pizzas.length + uso.preparos.length === 0 ? <p className="muted">Não está em nenhuma ficha.</p> : (
          <div className="chips">
            {uso.preparos.map((p) => <button key={p.id} className="chip-btn" onClick={() => go('preparos', p.id)}>{p.nome} <span className="small muted">preparo</span></button>)}
            {uso.pizzas.map((p) => <button key={p.id} className="chip-btn" onClick={() => go('pizzas', p.id)}>{p.nome}</button>)}
          </div>
        )}
      </Section>
      <Section title="Compras" actions={compras.length ? <button className="btn link" onClick={() => go('precos', insumo.id)}>Ver variação</button> : undefined}>
        {compras.length === 0 ? <p className="muted">Nenhuma compra lançada ainda.</p> : (
          <div className="table-wrap">
            <table className="compact">
              <thead><tr><th>Data</th><th className="r">Preço pago</th><th className="r">Qtd.</th><th className="r">Por {insumo.unidade}</th><th>Fornecedor</th></tr></thead>
              <tbody>
                {compras.slice(0, 10).map((c) => (
                  <tr key={c.id}><td>{formatDateBR(c.data)}</td><td className="r num">{fmt(c.precoPago)}</td><td className="r num">{numText(c.qtd, 3)}</td><td className="r num">{fmt(c.precoPago / (c.qtd || 1))}</td><td>{c.fornecedor ?? ''}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

function InsumoEditor({ session, insumo, onDone, onCancel, onRemoved }: { session: Session; insumo: Insumo | null; onDone: (id: string) => void; onCancel: () => void; onRemoved?: () => void }) {
  const cats = [...new Set(session.catalogo.insumos.map((i) => i.categoria).filter(Boolean))].sort();
  const [nome, setNome] = useState(insumo?.nome ?? '');
  const [categoria, setCategoria] = useState(insumo?.categoria ?? '');
  const [unidade, setUnidade] = useState<Unidade>(insumo?.unidade ?? 'kg');
  const [preco, setPreco] = useState(numText(insumo?.precoPago ?? null, 2));
  const [qtdC, setQtdC] = useState(numText(insumo?.qtdComprada ?? 1, 3));
  const [perda, setPerda] = useState(numText(insumo ? insumo.perda * 100 : 0, 1));
  const [fornecedor, setFornecedor] = useState(insumo?.fornecedor ?? '');
  const act = useAction();
  const draft = (): Insumo => ({
    id: insumo?.id ?? '', nome: nome.trim(), categoria: categoria.trim(), unidade,
    precoPago: parseNum(preco), qtdComprada: parseNum(qtdC) || 1, perda: Math.min(Math.max((parseNum(perda) ?? 0) / 100, 0), 0.99),
    ...(insumo?.atualizadoEm ? { atualizadoEm: insumo.atualizadoEm } : {}),
    ...(fornecedor.trim() ? { fornecedor: fornecedor.trim() } : {}),
  });
  return (
    <form className="stack" onSubmit={(e) => {
      e.preventDefault();
      void act.run(async () => {
        if (!nome.trim()) throw new Error('Dê um nome para o insumo.');
        if (preco.trim() && parseNum(preco) === null) throw new Error('O preço não é um número.');
        const id = insumo?.id ?? novoId('IB');
        const precoMudou = !insumo || insumo.precoPago !== draft().precoPago || insumo.qtdComprada !== draft().qtdComprada;
        await session.saveInsumo({ ...draft(), id, ...(precoMudou && draft().precoPago !== null ? { atualizadoEm: today() } : {}) });
        notify(insumo ? 'Insumo salvo.' : 'Insumo cadastrado.');
        onDone(id);
      });
    }}>
      <div className="page-head"><h1>{insumo ? `Editar ${insumo.nome}` : 'Novo insumo'}</h1></div>
      <section className="card">
        <div className="grid">
          <label className="field" htmlFor="in-nome"><span>Nome</span><input id="in-nome" value={nome} onChange={(e) => setNome(e.target.value)} required /></label>
          <label className="field" htmlFor="in-cat"><span>Categoria</span><input id="in-cat" list="in-cats" value={categoria} onChange={(e) => setCategoria(e.target.value)} /><datalist id="in-cats">{cats.map((x) => <option key={x} value={x} />)}</datalist></label>
          <label className="field" htmlFor="in-un"><span>Unidade base</span>
            <select id="in-un" value={unidade} onChange={(e) => setUnidade(e.target.value as Unidade)}>{UNIDADES.map((u) => <option key={u} value={u}>{u === 'kg' ? 'kg (quilo)' : u === 'L' ? 'L (litro)' : 'un (unidade)'}</option>)}</select>
          </label>
          <label className="field" htmlFor="in-preco"><span>Preço pago (R$)</span><input id="in-preco" inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} placeholder="0,00" /></label>
          <label className="field" htmlFor="in-qtd"><span>Quantidade comprada ({unidade})</span><input id="in-qtd" inputMode="decimal" value={qtdC} onChange={(e) => setQtdC(e.target.value)} /><small>Ex.: caixa com 50 embalagens = 50.</small></label>
          <label className="field" htmlFor="in-perda"><span>Perda na limpeza ou preparo (%)</span><input id="in-perda" inputMode="decimal" value={perda} onChange={(e) => setPerda(e.target.value)} /></label>
          <label className="field" htmlFor="in-forn"><span>Fornecedor (opcional)</span><input id="in-forn" value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} /></label>
        </div>
        <p className="small">Custo real: <b className="num">{fmt(custoInsumo(draft()))}</b> {porUnidade(unidade)}.</p>
      </section>
      {act.error && <p className="error" role="alert">{act.error}</p>}
      <div className="actions-bar">
        <button className="btn primary big" disabled={act.busy}>Salvar</button>
        <button type="button" className="btn" onClick={onCancel}>Cancelar</button>
        {insumo && onRemoved && (
          <button type="button" className="btn link danger" onClick={() => void act.run(async () => {
            if (!(await askConfirm(`Apagar ${insumo.nome}?`, { confirm: 'Apagar', danger: true }))) return;
            await session.removeInsumo(insumo.id);
            notify(`${insumo.nome} apagado.`, { undo: () => session.saveInsumo(insumo) });
            onRemoved();
          })}>Apagar insumo</button>
        )}
      </div>
    </form>
  );
}

/** Lançar uma compra: guarda no histórico e, se marcado, troca o preço do insumo. Mostra quanto o CMV muda. */
function CompraForm({ session, insumoId, onDone }: { session: Session; insumoId?: string; onDone: () => void }) {
  const cat = session.catalogo;
  const [id, setId] = useState(insumoId ?? '');
  const ins = cat.insumos.find((i) => i.id === id);
  const [data, setData] = useState(today());
  const [preco, setPreco] = useState('');
  const [qtdC, setQtdC] = useState(numText(ins?.qtdComprada ?? 1, 3));
  const [fornecedor, setFornecedor] = useState(ins?.fornecedor ?? '');
  const [atualizar, setAtualizar] = useState(true);
  const act = useAction();
  const p = parseNum(preco);
  const q = parseNum(qtdC) || 1;

  // Impacto: o CMV de cada pizza com o preço novo, contra o atual.
  const impacto = useMemo(() => {
    if (!ins || p === null) return [];
    const antes = session.custos();
    const depois = new Custos({ insumos: cat.insumos.map((i) => (i.id === ins.id ? { ...i, precoPago: p, qtdComprada: q } : i)), preparos: cat.preparos });
    return cat.pizzas.filter((z) => z.ativa && z.linhas.length).map((z) => {
      const a = calcularPizza(z, cat, antes);
      const b = calcularPizza(z, cat, depois);
      return { z, dM: b.M.comida + b.M.embalagem - (a.M.comida + a.M.embalagem), dG: b.G.comida + b.G.embalagem - (a.G.comida + a.G.embalagem) };
    }).filter((x) => Math.abs(x.dM) > 0.004 || Math.abs(x.dG) > 0.004);
  }, [ins, p, q, cat, session]);

  return (
    <form className="stack" onSubmit={(e) => {
      e.preventDefault();
      void act.run(async () => {
        if (!ins) throw new Error('Escolha o insumo.');
        if (p === null || p < 0) throw new Error('Informe o preço pago.');
        await session.addCompra({ id: novoId('C'), data, insumo: ins.id, precoPago: p, qtd: q, ...(fornecedor.trim() ? { fornecedor: fornecedor.trim() } : {}) }, atualizar);
        notify(atualizar ? `Compra lançada. ${ins.nome} agora custa ${fmt(p / q)} ${porUnidade(ins.unidade)}.` : 'Compra lançada no histórico.');
        onDone();
      });
    }}>
      <div className="page-head"><h1>Lançar compra</h1><p>O preço desta compra vai para o histórico e, se marcado, passa a valer em todas as fichas.</p></div>
      <section className="card">
        <div className="grid">
          <label className="field" htmlFor="co-ins"><span>Insumo</span>
            <select id="co-ins" value={id} onChange={(e) => { setId(e.target.value); const n = cat.insumos.find((i) => i.id === e.target.value); if (n) { setQtdC(numText(n.qtdComprada, 3)); setFornecedor(n.fornecedor ?? ''); } }} required>
              <option value="">Escolha</option>
              {[...cat.insumos].sort((a, b) => a.nome.localeCompare(b.nome)).map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
            </select>
          </label>
          <label className="field" htmlFor="co-data"><span>Data</span><input id="co-data" type="date" value={data} max={today()} onChange={(e) => setData(e.target.value)} required /></label>
          <label className="field" htmlFor="co-preco"><span>Preço pago (R$)</span><input id="co-preco" inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} placeholder="0,00" required /></label>
          <label className="field" htmlFor="co-qtd"><span>Quantidade ({ins?.unidade ?? 'kg'})</span><input id="co-qtd" inputMode="decimal" value={qtdC} onChange={(e) => setQtdC(e.target.value)} /></label>
          <label className="field" htmlFor="co-forn"><span>Fornecedor (opcional)</span><input id="co-forn" value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} /></label>
        </div>
        {ins && p !== null && (
          <p className="small">
            {fmt(p / q)} {porUnidade(ins.unidade)}
            {ins.precoPago !== null && ins.qtdComprada > 0 && (() => {
              const v = p / q / (ins.precoPago / ins.qtdComprada) - 1;
              return Number.isFinite(v) && Math.abs(v) > 0.0005 ? <> · <b className={v > 0 ? 'neg' : 'pos'}>{v > 0 ? '+' : ''}{pct(v)}</b> contra o preço atual ({fmt(ins.precoPago / ins.qtdComprada)})</> : <> · igual ao preço atual</>;
            })()}
          </p>
        )}
        <label className="check"><input type="checkbox" checked={atualizar} onChange={(e) => setAtualizar(e.target.checked)} /><span>Atualizar o preço do insumo nas fichas</span></label>
      </section>
      {atualizar && impacto.length > 0 && (
        <Section title={`Muda o CMV de ${plural(impacto.length, 'pizza', 'pizzas')}`}>
          <div className="table-wrap">
            <table className="compact">
              <thead><tr><th>Pizza</th><th className="r">Médio</th><th className="r">Grande</th></tr></thead>
              <tbody>
                {impacto.map((x) => (
                  <tr key={x.z.id}><td>{x.z.nome}</td><td className={`r num ${x.dM > 0 ? 'neg' : 'pos'}`}>{x.dM > 0 ? '+' : ''}{fmt(x.dM)}</td><td className={`r num ${x.dG > 0 ? 'neg' : 'pos'}`}>{x.dG > 0 ? '+' : ''}{fmt(x.dG)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      {act.error && <p className="error" role="alert">{act.error}</p>}
      <div className="actions-bar"><button className="btn primary big" disabled={act.busy}>Lançar compra</button><button type="button" className="btn" onClick={onDone}>Cancelar</button></div>
    </form>
  );
}
