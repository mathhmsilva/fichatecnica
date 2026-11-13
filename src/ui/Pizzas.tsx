import { useMemo, useState } from 'react';
import { novoId, type Session } from '../app/service';
import { ETAPAS, ETAPA_NOME, TAMANHOS, TAMANHO_NOME, calcularPizza, type Etapa, type LinhaPizza, type Pizza, type PizzaCalculada, type Tamanho } from '../domain/ficha';
import { Choice, Section, plural, useSessionState } from './common';
import { askConfirm, notify, useAction } from './feedback';
import type { Go } from './Main';
import { fatorDigitado, fmt, numText, parseNum, pct, qtd, unidadeDigitada } from './format';
import { norm } from '../import/planilha';
import { Icon } from './Icon';

export function PizzasScreen({ session, go, open }: { session: Session; go: Go; open?: string }) {
  useSessionState(session);
  const [busca, setBusca] = useState('');
  const [cat, setCat] = useState('');
  const [inativas, setInativas] = useState(false);
  const catalogo = session.catalogo;
  if (open === 'nova') return <PizzaEditor session={session} pizza={null} onDone={(id) => go('pizzas', id)} onCancel={() => go('pizzas')} />;
  if (open) {
    const pc = session.pizza(open);
    if (pc) return <PizzaDetail session={session} pc={pc} go={go} />;
  }
  const categorias = [...new Set(catalogo.pizzas.map((p) => p.categoria).filter(Boolean))];
  const pend = session.pendencias();
  const lista = catalogo.pizzas
    .filter((p) => (inativas ? true : p.ativa))
    .filter((p) => !cat || p.categoria === cat)
    .filter((p) => !busca.trim() || norm(p.nome).includes(norm(busca)));
  return (
    <>
      <div className="row between">
        <h1>Pizzas e fichas</h1>
        <button className="btn primary" onClick={() => go('pizzas', 'nova')}><Icon name="mais_um" size={18} />Nova pizza</button>
      </div>
      <div className="row">
        <input className="grow-input" aria-label="Procurar pizza" placeholder="Procurar pizza" value={busca} onChange={(e) => setBusca(e.target.value)} />
        {categorias.length > 1 && (
          <select aria-label="Categoria" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">Todas as categorias</option>
            {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <label className="check"><input type="checkbox" checked={inativas} onChange={(e) => setInativas(e.target.checked)} /><span>Mostrar inativas</span></label>
      </div>
      {lista.length === 0 ? (
        <p className="muted">{catalogo.pizzas.length ? 'Nenhuma pizza com esse filtro.' : 'Nenhuma pizza ainda. Importe a planilha ou cadastre a primeira.'}</p>
      ) : (
        <ul className="pizza-grid">
          {lista.map((p) => {
            const pc = session.pizza(p.id)!;
            const faltas = pend.filter((x) => x.alvo === p.id && x.gravidade === 'falta').length;
            return (
              <li key={p.id}>
                <button className="pizza-card" onClick={() => go('pizzas', p.id)}>
                  <span className="row between">
                    <span className="pizza-name">{p.nome}</span>
                    {!p.ativa ? <span className="pill">Inativa</span> : faltas ? <span className="pill status-warn">{plural(faltas, 'pendência', 'pendências')}</span> : <span className="pill status-ok">Ficha completa</span>}
                  </span>
                  <span className="small muted">{p.categoria || 'Sem categoria'}</span>
                  <span className="pizza-figs">
                    {TAMANHOS.map((t) => (
                      <span key={t}><span className="lbl">CMV {TAMANHO_NOME[t]}</span><span className="num">{p.linhas.length ? fmt(pc[t].comida + pc[t].embalagem) : '—'}</span></span>
                    ))}
                  </span>
                  <MarginDots pc={pc} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** Uma bolinha por canal: verde na meta, laranja abaixo, vermelho negativo, cinza não vende. */
function MarginDots({ pc }: { pc: PizzaCalculada }) {
  const canais = [...new Set(pc.resultados.map((r) => r.canal))];
  return (
    <span className="dots-row">
      {canais.map((k) => {
        const rs = pc.resultados.filter((r) => r.canal.id === k.id && r.preco !== null && !pc[r.tamanho].faltaQtd && pc.pizza.linhas.length);
        const worst = rs.reduce<number | null>((m, r) => (m === null || (r.margemPct ?? 0) - k.margemAlvo < m ? (r.margemPct ?? 0) - k.margemAlvo : m), null);
        const cls = worst === null ? 'off' : worst >= 0 ? 'ok' : rs.some((r) => (r.margem ?? 0) < 0) ? 'bad' : 'warn';
        const title = worst === null ? 'não vende ou ficha incompleta' : worst >= 0 ? 'na meta' : 'abaixo da meta';
        return <span key={k.id} className={`mdot ${cls}`} title={`${k.nome}: ${title}`}><i aria-hidden="true" />{k.nome}</span>;
      })}
    </span>
  );
}

function PizzaDetail({ session, pc, go }: { session: Session; pc: PizzaCalculada; go: Go }) {
  const [tab, setTab] = useState<'ficha' | 'cozinha' | 'editar'>('ficha');
  const p = pc.pizza;
  const pend = session.pendencias().filter((x) => x.alvo === p.id);
  return (
    <>
      <div className="crumbs"><button className="btn link" onClick={() => go('pizzas')}>‹ Pizzas</button></div>
      <div className="page-head">
        <h1>{p.nome}</h1>
        <p className="muted">{p.categoria || 'Sem categoria'}{p.ativa ? '' : ' · inativa'}</p>
      </div>
      <Choice label="Ver" value={tab} onChange={setTab} options={[['ficha', 'Ficha e custos'], ['cozinha', 'Modo cozinha'], ['editar', 'Editar']] as const} />
      {tab !== 'editar' && pend.length > 0 && (
        <div className="notice" role="status"><b>Atenção</b><span>{pend.map((x) => x.problema).join(' · ')}.</span></div>
      )}
      {tab === 'ficha' && <Ficha session={session} pc={pc} />}
      {tab === 'cozinha' && <Cozinha session={session} pc={pc} />}
      {tab === 'editar' && <PizzaEditor session={session} pizza={p} onDone={() => setTab('ficha')} onCancel={() => setTab('ficha')} onRemoved={() => go('pizzas')} onCopied={(id) => go('pizzas', id)} />}
    </>
  );
}

function Ficha({ session, pc }: { session: Session; pc: PizzaCalculada }) {
  const c = session.custos();
  const p = pc.pizza;
  const canais = session.catalogo.canais;
  const temG = p.linhas.some((l) => l.qtdG !== null);
  return (
    <>
      <div className="grid stats-4">
        <div className="stat card flat"><span className="small muted">CMV comida, Médio</span><span className="value num">{fmt(pc.M.comida)}</span></div>
        <div className="stat card flat"><span className="small muted">CMV comida, Grande</span><span className="value num">{temG ? fmt(pc.G.comida) : '—'}</span></div>
        <div className="stat card flat"><span className="small muted">Embalagem M / G</span><span className="value num small-value">{fmt(pc.M.embalagem)} / {temG ? fmt(pc.G.embalagem) : '—'}</span></div>
        <div className="stat card flat"><span className="small muted">CMV com embalagem M / G</span><span className="value num small-value">{fmt(pc.M.comida + pc.M.embalagem)} / {temG ? fmt(pc.G.comida + pc.G.embalagem) : '—'}</span></div>
      </div>

      <Section title="Resultado por canal">
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr><th>Canal</th>{TAMANHOS.map((t) => <th key={t} className="r" colSpan={3}>{TAMANHO_NOME[t]}</th>)}</tr>
              <tr className="sub"><th></th>{TAMANHOS.map((t) => [<th key={`${t}p`} className="r">Preço</th>, <th key={`${t}m`} className="r">Margem</th>, <th key={`${t}s`} className="r">Sugerido</th>])}</tr>
            </thead>
            <tbody>
              {canais.map((k) => (
                <tr key={k.id}>
                  <td>{k.nome}<span className="small muted d-block">meta {pct(k.margemAlvo, 0)}</span></td>
                  {TAMANHOS.map((t) => {
                    const r = pc.resultados.find((x) => x.canal.id === k.id && x.tamanho === t)!;
                    const incompleta = !p.linhas.length || pc[t].faltaQtd;
                    const cls = r.margemPct === null || incompleta ? '' : (r.margem ?? 0) < 0 ? 'neg' : r.margemPct < k.margemAlvo ? 'warn-text' : 'pos';
                    return [
                      <td key={`${t}p`} className="r num">{fmt(r.preco)}</td>,
                      <td key={`${t}m`} className={`r num ${cls}`}>{r.preco === null ? '—' : incompleta ? 'sem ficha' : <>{fmt(r.margem)}<span className="small d-block">{pct(r.margemPct)}</span></>}</td>,
                      <td key={`${t}s`} className="r num">{incompleta ? '—' : fmt(r.sugerido)}</td>,
                    ];
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">Margem = preço − CMV − comissão − taxa de pagamento − impostos − desconto − custos por pedido. Sugerido = preço que atinge a meta do canal. No {canais.filter((k) => !k.usaEmbalagem).map((k) => k.nome).join(', ') || 'salão'} o CMV não inclui embalagem.</p>
      </Section>

      <Section title="Ingredientes e embalagem">
        {p.linhas.length === 0 ? <p className="muted">Sem receita ainda. Toque em Editar para lançar os ingredientes.</p> : (
          <div className="table-wrap">
            <table className="compact">
              <thead><tr><th>Ingrediente</th><th className="r">Médio</th><th className="r">Grande</th><th className="r">Custo M</th><th className="r">Custo G</th><th className="r">% do CMV M</th></tr></thead>
              <tbody>
                {ETAPAS.filter((e) => p.linhas.some((l) => l.etapa === e)).map((e) => [
                  <tr key={e} className="group-row"><td colSpan={6}>{ETAPA_NOME[e]}</td></tr>,
                  ...pc.M.linhas.filter((x) => x.linha.etapa === e).map((m) => {
                    const g = pc.G.linhas.find((x) => x.linha.id === m.linha.id)!;
                    const total = pc.M.comida + pc.M.embalagem;
                    return (
                      <tr key={m.linha.id}>
                        <td>{c.nome(m.ref)}{c.tipo(m.ref) === 'Preparo' && <span className="pill">Preparo</span>}{m.linha.refG && <span className="small muted d-block">No Grande: {c.nome(m.linha.refG)}</span>}</td>
                        <td className="r num">{qtd(m.qtd, c.unidade(m.ref))}</td>
                        <td className={`r num${g.qtd === null ? ' warn-text' : ''}`}>{g.qtd === null ? 'falta' : qtd(g.qtd, c.unidade(g.ref))}</td>
                        <td className="r num">{fmt(m.custo)}</td>
                        <td className="r num">{g.qtd === null ? '—' : fmt(g.custo)}</td>
                        <td className="r num">{total ? pct(m.custo / total) : '—'}</td>
                      </tr>
                    );
                  }),
                ])}
              </tbody>
            </table>
          </div>
        )}
        {p.obs && <p className="small"><b>Observações:</b> {p.obs}</p>}
      </Section>
    </>
  );
}

/** Só as quantidades, em letra grande, para quem está montando a pizza. */
function Cozinha({ session, pc }: { session: Session; pc: PizzaCalculada }) {
  const [t, setT] = useState<Tamanho>('M');
  const c = session.custos();
  const f = pc[t];
  return (
    <section className="card kitchen" aria-label="Modo cozinha">
      <Choice label="Tamanho" value={t} onChange={setT} options={[['M', 'Médio'], ['G', 'Grande']] as const} />
      {ETAPAS.filter((e) => f.linhas.some((l) => l.linha.etapa === e)).map((e) => (
        <div key={e} className="kitchen-step">
          <h2>{ETAPA_NOME[e]}</h2>
          <ul>
            {f.linhas.filter((l) => l.linha.etapa === e).map((l) => (
              <li key={l.linha.id}><span>{c.nome(l.ref)}</span><b className={l.qtd === null ? 'warn-text' : ''}>{l.qtd === null ? 'falta' : qtd(l.qtd, c.unidade(l.ref))}</b></li>
            ))}
          </ul>
        </div>
      ))}
      {f.linhas.length === 0 && <p className="muted">Sem receita ainda.</p>}
      <div><button className="btn" onClick={() => window.print()}>Imprimir a ficha</button></div>
    </section>
  );
}

interface LinhaDraft {
  id: string;
  etapa: Etapa;
  ref: string;
  m: string;
  g: string;
  refG: string;
}

function PizzaEditor({ session, pizza, onDone, onCancel, onRemoved, onCopied }: { session: Session; pizza: Pizza | null; onDone: (id: string) => void; onCancel: () => void; onRemoved?: () => void; onCopied?: (id: string) => void }) {
  const cat = session.catalogo;
  const c = session.custos();
  const [nome, setNome] = useState(pizza?.nome ?? '');
  const [categoria, setCategoria] = useState(pizza?.categoria ?? cat.pizzas[0]?.categoria ?? '');
  const [ativa, setAtiva] = useState(pizza?.ativa ?? true);
  const [obs, setObs] = useState(pizza?.obs ?? '');
  const [precos, setPrecos] = useState<Record<string, { M: string; G: string }>>(() =>
    Object.fromEntries(cat.canais.map((k) => [k.id, { M: numText(pizza?.precos[k.id]?.M ?? null, 2), G: numText(pizza?.precos[k.id]?.G ?? null, 2) }])),
  );
  const toDraft = (l: LinhaPizza): LinhaDraft => ({
    id: l.id, etapa: l.etapa, ref: l.ref, refG: l.refG ?? '',
    m: numText(l.qtdM === null ? null : l.qtdM * fatorDigitado(c.unidade(l.ref)), 2),
    g: numText(l.qtdG === null ? null : l.qtdG * fatorDigitado(c.unidade(l.refG ?? l.ref)), 2),
  });
  const [linhas, setLinhas] = useState<LinhaDraft[]>(() => pizza?.linhas.map(toDraft) ?? []);
  const act = useAction();
  const categorias = [...new Set(cat.pizzas.map((p) => p.categoria).filter(Boolean))];
  const opcoes = (
    <>
      <option value="">Escolha o ingrediente</option>
      {cat.preparos.length > 0 && <optgroup label="Preparos">{cat.preparos.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</optgroup>}
      <optgroup label="Insumos">{[...cat.insumos].sort((a, b) => a.nome.localeCompare(b.nome)).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</optgroup>
    </>
  );

  const build = (id: string): Pizza => {
    const pr: Pizza['precos'] = {};
    for (const [k, v] of Object.entries(precos)) {
      const M = parseNum(v.M);
      const G = parseNum(v.G);
      if ((M ?? 0) > 0 || (G ?? 0) > 0) pr[k] = { ...((M ?? 0) > 0 ? { M } : {}), ...((G ?? 0) > 0 ? { G } : {}) };
    }
    const ls: LinhaPizza[] = linhas.filter((l) => l.ref).map((l) => {
      const qm = parseNum(l.m);
      const qg = parseNum(l.g);
      return {
        id: l.id, etapa: l.etapa, ref: l.ref,
        qtdM: qm === null ? null : qm / fatorDigitado(c.unidade(l.ref)),
        qtdG: qg === null ? null : qg / fatorDigitado(c.unidade(l.refG || l.ref)),
        ...(l.refG && l.refG !== l.ref ? { refG: l.refG } : {}),
      };
    });
    return { id, nome: nome.trim(), categoria: categoria.trim(), ativa, precos: pr, linhas: ls, ...(obs.trim() ? { obs: obs.trim() } : {}) };
  };
  const id = pizza?.id ?? '';
  const preview = useMemo(() => calcularPizza(build(id || 'rascunho'), cat, c), [nome, categoria, ativa, precos, linhas, obs, cat, c]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (i: number, patch: Partial<LinhaDraft>) => setLinhas(linhas.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const bad = linhas.some((l) => (l.m.trim() && parseNum(l.m) === null) || (l.g.trim() && parseNum(l.g) === null));

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void act.run(async () => {
          if (!nome.trim()) throw new Error('Dê um nome para a pizza.');
          if (bad) throw new Error('Alguma quantidade não é um número. Use vírgula para decimais, por exemplo 2,5.');
          const novo = id || novoId('PZ');
          await session.savePizza(build(novo));
          notify(pizza ? 'Ficha salva.' : 'Pizza cadastrada.');
          onDone(novo);
        });
      }}
    >
      {!pizza && <div className="page-head"><h1>Nova pizza</h1></div>}
      <section className="card">
        <div className="grid">
          <label className="field" htmlFor="pz-nome"><span>Nome</span><input id="pz-nome" value={nome} onChange={(e) => setNome(e.target.value)} required /></label>
          <label className="field" htmlFor="pz-cat"><span>Categoria</span><input id="pz-cat" list="pz-cats" value={categoria} onChange={(e) => setCategoria(e.target.value)} /><datalist id="pz-cats">{categorias.map((x) => <option key={x} value={x} />)}</datalist></label>
        </div>
        <label className="check"><input type="checkbox" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} /><span>Ativa no cardápio</span></label>
      </section>

      <section className="card" aria-label="Preços de venda">
        <h2>Preços de venda</h2>
        <p className="small muted">Deixe vazio onde a pizza não é vendida.</p>
        <div className="table-wrap">
          <table className="compact inputs">
            <thead><tr><th>Canal</th><th>Médio (R$)</th><th>Grande (R$)</th></tr></thead>
            <tbody>
              {cat.canais.map((k) => (
                <tr key={k.id}>
                  <td>{k.nome}</td>
                  {TAMANHOS.map((t) => (
                    <td key={t}><input aria-label={`Preço ${k.nome} ${TAMANHO_NOME[t]}`} inputMode="decimal" value={precos[k.id]?.[t] ?? ''} onChange={(e) => setPrecos({ ...precos, [k.id]: { ...(precos[k.id] ?? { M: '', G: '' }), [t]: e.target.value } })} placeholder="—" /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" aria-label="Receita">
        <div className="row between">
          <h2>Receita</h2>
          <span className="small muted">CMV agora: <b className="num">{fmt(preview.M.comida + preview.M.embalagem)}</b> no Médio · <b className="num">{fmt(preview.G.comida + preview.G.embalagem)}</b> no Grande</span>
        </div>
        <p className="small muted">Quantidades em gramas (g), mililitros (ml) ou unidades (un), conforme o ingrediente. Deixe o Grande vazio se a pizza não tem Grande.</p>
        {linhas.length === 0 && <p className="muted">Nenhum ingrediente ainda.</p>}
        <ul className="recipe-edit">
          {linhas.map((l, i) => {
            const u = unidadeDigitada(c.unidade(l.ref));
            const ug = unidadeDigitada(c.unidade(l.refG || l.ref));
            return (
              <li key={l.id}>
                <div className="recipe-row">
                  <select aria-label="Etapa" value={l.etapa} onChange={(e) => set(i, { etapa: e.target.value as Etapa })}>
                    {ETAPAS.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                  <select aria-label="Ingrediente" className="grow-2" value={l.ref} onChange={(e) => set(i, { ref: e.target.value })}>{opcoes}</select>
                  <label className="qty"><span>Médio</span><input inputMode="decimal" aria-label="Quantidade no Médio" value={l.m} onChange={(e) => set(i, { m: e.target.value })} /><em>{u}</em></label>
                  <label className="qty"><span>Grande</span><input inputMode="decimal" aria-label="Quantidade no Grande" value={l.g} onChange={(e) => set(i, { g: e.target.value })} /><em>{ug}</em></label>
                  <button type="button" className="btn icon-btn" aria-label="Tirar esta linha" onClick={() => setLinhas(linhas.filter((_, j) => j !== i))}>×</button>
                </div>
                <details className="recipe-more" open={!!l.refG}>
                  <summary className="small muted">Outro item no Grande</summary>
                  <select aria-label="Item no Grande" value={l.refG} onChange={(e) => set(i, { refG: e.target.value })}>
                    <option value="">O mesmo do Médio</option>
                    {cat.insumos.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                    {cat.preparos.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                  </select>
                </details>
              </li>
            );
          })}
        </ul>
        <div><button type="button" className="btn" onClick={() => setLinhas([...linhas, { id: novoId('L'), etapa: 'Antes', ref: '', m: '', g: '', refG: '' }])}><Icon name="mais_um" size={18} />Adicionar ingrediente</button></div>
      </section>

      <label className="field" htmlFor="pz-obs"><span>Observações (opcional)</span><textarea id="pz-obs" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} /></label>
      {act.error && <p className="error" role="alert">{act.error}</p>}
      <div className="actions-bar">
        <button className="btn primary big" disabled={act.busy}>{act.busy ? 'Salvando…' : 'Salvar'}</button>
        <button type="button" className="btn" onClick={onCancel}>Cancelar</button>
        {pizza && onCopied && (
          <button type="button" className="btn link" onClick={() => void act.run(async () => {
            const novo = novoId('PZ');
            await session.savePizza({ ...build(novo), nome: `${nome.trim()} (cópia)`, linhas: build(novo).linhas.map((l) => ({ ...l, id: novoId('L') })) });
            notify('Cópia criada. Ajuste o nome e a receita.');
            onCopied(novo);
          })}>Duplicar</button>
        )}
        {pizza && onRemoved && (
          <button type="button" className="btn link danger" onClick={async () => {
            if (!(await askConfirm(`Apagar ${pizza.nome}?`, { detail: 'A ficha e os preços somem. As vendas já lançadas dela deixam de contar na engenharia de cardápio.', confirm: 'Apagar', danger: true }))) return;
            await session.removePizza(pizza.id);
            notify(`${pizza.nome} apagada.`, { undo: () => session.savePizza(pizza) });
            onRemoved();
          }}>Apagar pizza</button>
        )}
      </div>
    </form>
  );
}
