import { useState } from 'react';
import type { Session } from '../app/service';
import { TAMANHO_NOME, variaveis, type Canal, type Tamanho } from '../domain/ficha';
import { Choice, Help, Section, useSessionState } from './common';
import { notify, useAction } from './feedback';
import type { Go } from './Main';
import { fmt, numText, parseNum, pct } from './format';

export function CanaisScreen({ session, go }: { session: Session; go: Go }) {
  const state = useSessionState(session);
  const cat = state.catalogo;
  const [t, setT] = useState<Tamanho>('M');
  const [ver, setVer] = useState<'margem' | 'sugerido'>('margem');
  const calc = session.pizzasCalculadas();
  const linhas = cat.pizzas.filter((p) => p.ativa).map((p) => {
    const pc = calc.get(p.id)!;
    const incompleta = !p.linhas.length || pc[t].faltaQtd;
    const rs = cat.canais.map((k) => pc.resultados.find((r) => r.canal.id === k.id && r.tamanho === t)!);
    const vendidos = rs.filter((r) => r.preco !== null);
    const melhor = incompleta || !vendidos.length ? null : vendidos.reduce((a, b) => ((b.margem ?? -Infinity) > (a.margem ?? -Infinity) ? b : a));
    const pior = incompleta || vendidos.length < 2 ? null : vendidos.reduce((a, b) => ((b.margem ?? Infinity) < (a.margem ?? Infinity) ? b : a));
    return { p, rs, incompleta, melhor, dif: melhor && pior ? (melhor.margem ?? 0) - (pior.margem ?? 0) : null };
  }).filter((l) => l.rs.some((r) => r.preco !== null) || ver === 'sugerido');

  return (
    <>
      <h1>Canais e preços</h1>
      <p className="muted">Preço sugerido = (CMV + custos por pedido) ÷ (1 − % que sai do preço − margem-alvo). A margem é o que sobra do preço depois do CMV, da comissão, das taxas, dos impostos e do desconto.</p>

      <Section title="Comparativo entre canais">
        <div className="row">
          <Choice label="Tamanho" value={t} onChange={setT} options={[['M', 'Médio'], ['G', 'Grande']] as const} />
          <Choice label="Mostrar" value={ver} onChange={setVer} options={[['margem', 'Margem'], ['sugerido', 'Sugerido']] as const} />
        </div>
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr><th>Pizza</th>{cat.canais.map((k) => <th key={k.id} className="r" colSpan={2}>{k.nome}</th>)}{ver === 'margem' && <th>Melhor</th>}</tr>
              <tr className="sub"><th></th>{cat.canais.map((k) => [<th key={`${k.id}p`} className="r">Preço</th>, <th key={`${k.id}m`} className="r">{ver === 'margem' ? 'Margem' : 'Sugerido'}</th>])}{ver === 'margem' && <th></th>}</tr>
            </thead>
            <tbody>
              {linhas.map(({ p, rs, incompleta, melhor, dif }) => (
                <tr key={p.id} className="clickable" onClick={() => go('pizzas', p.id)}>
                  <td>{p.nome}{incompleta && <span className="small warn-text d-block">ficha incompleta</span>}</td>
                  {rs.map((r) => {
                    const cls = incompleta || r.margemPct === null ? '' : (r.margem ?? 0) < 0 ? 'neg' : r.margemPct < r.canal.margemAlvo ? 'warn-text' : 'pos';
                    return [
                      <td key={`${r.canal.id}p`} className="r num">{fmt(r.preco)}</td>,
                      ver === 'margem'
                        ? <td key={`${r.canal.id}m`} className={`r num ${cls}`}>{r.preco === null || incompleta ? '—' : <>{fmt(r.margem)}<span className="small d-block">{pct(r.margemPct)}</span></>}</td>
                        : <td key={`${r.canal.id}m`} className="r num">{incompleta ? '—' : <>{fmt(r.sugerido)}{r.preco !== null && r.sugerido !== null && <span className={`small d-block ${r.sugerido > r.preco ? 'neg' : 'pos'}`}>{r.sugerido > r.preco ? '+' : ''}{fmt(r.sugerido - r.preco)}</span>}</>}</td>,
                    ];
                  })}
                  {ver === 'margem' && <td>{melhor ? <><b>{melhor.canal.nome}</b>{dif !== null && dif > 0 && <span className="small muted d-block">+{fmt(dif)}</span>}</> : '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">{TAMANHO_NOME[t]}. Verde: na meta do canal. Laranja: abaixo da meta. Vermelho: margem negativa. Toque numa pizza para abrir a ficha.</p>
      </Section>

      <h2 className="section-h">Parâmetros de cada canal</h2>
      <div className="grid canal-grid">
        {cat.canais.map((k) => <CanalCard key={`${k.id}-${JSON.stringify(k)}`} session={session} canal={k} impostos={cat.config.impostos} />)}
      </div>
      <GeralCard key={JSON.stringify(cat.config)} session={session} />
    </>
  );
}

function CanalCard({ session, canal, impostos }: { session: Session; canal: Canal; impostos: number }) {
  const [v, setV] = useState({
    comissao: numText(canal.comissao * 100, 2), taxaPagamento: numText(canal.taxaPagamento * 100, 2), desconto: numText(canal.desconto * 100, 2),
    taxaFixaPedido: numText(canal.taxaFixaPedido, 2), custosExtrasPedido: numText(canal.custosExtrasPedido, 2), margemAlvo: numText(canal.margemAlvo * 100, 2),
  });
  const [emb, setEmb] = useState(canal.usaEmbalagem);
  const act = useAction();
  const p = (s: string) => (parseNum(s) ?? 0) / 100;
  const draft: Canal = { ...canal, usaEmbalagem: emb, comissao: p(v.comissao), taxaPagamento: p(v.taxaPagamento), desconto: p(v.desconto), taxaFixaPedido: parseNum(v.taxaFixaPedido) ?? 0, custosExtrasPedido: parseNum(v.custosExtrasPedido) ?? 0, margemAlvo: p(v.margemAlvo) };
  const sobra = 1 - variaveis(draft, { impostos, cmvMaximo: 0, diasDesatualizado: 0 }) - draft.margemAlvo;
  const changed = JSON.stringify(draft) !== JSON.stringify(canal);
  const field = (k: keyof typeof v, label: string, suf: string) => (
    <label className="field" htmlFor={`k-${canal.id}-${k}`}><span>{label} ({suf})</span><input id={`k-${canal.id}-${k}`} inputMode="decimal" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></label>
  );
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); void act.run(async () => { if (sobra <= 0) throw new Error('Comissão, taxas, impostos, desconto e margem-alvo somam 100% ou mais: não há preço que chegue lá.'); await session.saveCanal(draft); notify(`${canal.nome} salvo. Margens e preços sugeridos já foram refeitos.`); }); }}>
      <h2>{canal.nome}</h2>
      <label className="check"><input type="checkbox" checked={emb} onChange={(e) => setEmb(e.target.checked)} /><span>Inclui embalagem no CMV (delivery)</span></label>
      <div className="grid narrow">
        {field('margemAlvo', 'Margem-alvo', '%')}
        {field('comissao', 'Comissão da plataforma', '%')}
        {field('taxaPagamento', 'Taxa de pagamento', '%')}
        {field('desconto', 'Desconto ou cupom médio', '%')}
        {field('taxaFixaPedido', 'Taxa fixa por pedido', 'R$')}
        {field('custosExtrasPedido', 'Custos extras por pedido', 'R$')}
      </div>
      <p className="small muted">Do preço, {pct(1 - sobra - draft.margemAlvo)} vão para comissão, taxas, impostos e desconto; a meta pede {pct(draft.margemAlvo)}; sobram {pct(sobra)} para o CMV e os custos por pedido.</p>
      {act.error && <p className="error" role="alert">{act.error}</p>}
      <div><button className="btn" disabled={!changed || act.busy}>Salvar {canal.nome}</button></div>
    </form>
  );
}

function GeralCard({ session }: { session: Session }) {
  const cfg = session.catalogo.config;
  const [impostos, setImpostos] = useState(numText(cfg.impostos * 100, 2));
  const [cmv, setCmv] = useState(numText(cfg.cmvMaximo * 100, 1));
  const [dias, setDias] = useState(String(cfg.diasDesatualizado));
  const act = useAction();
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); void act.run(async () => {
      await session.setConfig({ impostos: (parseNum(impostos) ?? 0) / 100, cmvMaximo: (parseNum(cmv) ?? 35) / 100, diasDesatualizado: Math.max(1, Math.round(parseNum(dias) ?? 90)) });
      notify('Configurações salvas.');
    }); }}>
      <h2>Para todos os canais</h2>
      <div className="grid narrow">
        <label className="field" htmlFor="g-imp"><span>Impostos sobre a venda (%) <Help text="A alíquota do Simples, por exemplo. Sai do preço em todos os canais." /></span><input id="g-imp" inputMode="decimal" value={impostos} onChange={(e) => setImpostos(e.target.value)} /></label>
        <label className="field" htmlFor="g-cmv"><span>CMV máximo desejado (%)</span><input id="g-cmv" inputMode="decimal" value={cmv} onChange={(e) => setCmv(e.target.value)} /></label>
        <label className="field" htmlFor="g-dias"><span>Preço de insumo vence em (dias)</span><input id="g-dias" inputMode="numeric" value={dias} onChange={(e) => setDias(e.target.value)} /></label>
      </div>
      {act.error && <p className="error" role="alert">{act.error}</p>}
      <div><button className="btn" disabled={act.busy}>Salvar</button></div>
    </form>
  );
}
