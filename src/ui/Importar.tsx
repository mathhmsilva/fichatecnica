import { useState } from 'react';
import type { Session } from '../app/service';
import { lerPlanilha, type Importacao } from '../import/planilha';
import { readXlsxSheets } from '../import/xlsx';
import { Custos, calcularPizza, pendencias } from '../domain/ficha';
import { FilePick, Section, plural, today, useSessionState } from './common';
import { askConfirm, friendlyError, notify, useAction } from './feedback';
import type { Go } from './Main';
import { fmt, pct } from './format';

export function ImportarScreen({ session, go }: { session: Session; go: Go }) {
  const state = useSessionState(session);
  const [file, setFile] = useState('');
  const [imp, setImp] = useState<Importacao | null>(null);
  const [err, setErr] = useState('');
  const act = useAction();
  const atual = state.catalogo;
  const temDados = atual.pizzas.length > 0 || atual.insumos.length > 0;
  const last = state.imports[state.imports.length - 1];
  return (
    <>
      <div className="page-head">
        <h1>Importar planilha</h1>
        <p>No Google Planilhas, abra a ficha técnica e use <b>Arquivo → Fazer download → Microsoft Excel (.xlsx)</b>. Depois escolha o arquivo aqui. Ele é lido neste aparelho e não vai para lugar nenhum.</p>
      </div>
      <section className="card">
        <FilePick accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" label="Escolher a planilha" fileName={file} onFile={async (f) => {
          setFile(f.name);
          setErr('');
          setImp(null);
          try {
            setImp(lerPlanilha(await readXlsxSheets(await f.arrayBuffer())));
          } catch (x) {
            setErr(friendlyError(x));
          }
        }} />
        {last && <p className="small muted">Última importação: {last.fileName}, em {new Date(last.at).toLocaleDateString('pt-BR')}.</p>}
        {err && <p className="error" role="alert">{err}</p>}
      </section>
      {imp && <Previa imp={imp} />}
      {imp && (
        <>
          {temDados && <div className="notice"><b>Atenção</b><span>Importar substitui as pizzas, os insumos, os preparos e os canais que estão no app pelos da planilha. Compras e vendas já lançadas ficam.</span></div>}
          {act.error && <p className="error" role="alert">{act.error}</p>}
          <div className="actions-bar">
            <button className="btn primary big" disabled={act.busy} onClick={() => void act.run(async () => {
              if (temDados && !(await askConfirm('Substituir o cadastro pelo da planilha?', { detail: `${plural(atual.pizzas.length, 'pizza', 'pizzas')} e ${plural(atual.insumos.length, 'insumo', 'insumos')} do app dão lugar aos da planilha.`, confirm: 'Substituir' }))) return;
              await session.importCatalog(imp.catalogo, file);
              notify(`Planilha importada: ${plural(imp.catalogo.pizzas.length, 'pizza', 'pizzas')}, ${plural(imp.catalogo.insumos.length, 'insumo', 'insumos')} e ${plural(imp.catalogo.preparos.length, 'preparo', 'preparos')}.`);
              go('inicio');
            })}>{act.busy ? 'Importando…' : 'Importar'}</button>
            <button className="btn" onClick={() => { setImp(null); setFile(''); }}>Cancelar</button>
          </div>
        </>
      )}
    </>
  );
}

function Previa({ imp }: { imp: Importacao }) {
  const cat = imp.catalogo;
  const c = new Custos(cat);
  const pend = pendencias(cat, today(), c).filter((p) => p.gravidade === 'falta');
  return (
    <>
      <div className="grid stats-4">
        <div className="stat card flat"><span className="small muted">Pizzas</span><span className="value num">{cat.pizzas.length}</span></div>
        <div className="stat card flat"><span className="small muted">Insumos</span><span className="value num">{cat.insumos.length}</span></div>
        <div className="stat card flat"><span className="small muted">Preparos</span><span className="value num">{cat.preparos.length}</span></div>
        <div className="stat card flat"><span className="small muted">Compras e vendas</span><span className="value num">{cat.compras.length} / {cat.vendas.length}</span></div>
      </div>
      {imp.avisos.length > 0 && (
        <Section title="O que não deu para trazer">
          <ul className="plain-list small">{imp.avisos.map((a) => <li key={a}>{a}</li>)}</ul>
        </Section>
      )}
      <Section title="Confira os números">
        <p className="small muted">Calculado pelo app a partir dos preços, quantidades e perdas da planilha. Deve bater com a aba CMV_Index.</p>
        <div className="table-wrap">
          <table className="compact">
            <thead><tr><th>Pizza</th><th className="r">CMV comida M</th><th className="r">CMV comida G</th><th className="r">Linhas</th></tr></thead>
            <tbody>
              {cat.pizzas.map((p) => {
                const pc = calcularPizza(p, cat, c);
                return <tr key={p.id}><td>{p.nome}</td><td className="r num">{p.linhas.length ? fmt(pc.M.comida) : '—'}</td><td className="r num">{p.linhas.length && !pc.G.faltaQtd ? fmt(pc.G.comida) : '—'}</td><td className="r num">{p.linhas.length}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
        <p className="small">Canais: {cat.canais.map((k) => `${k.nome} (comissão ${pct(k.comissao, 0)}, meta ${pct(k.margemAlvo, 0)}${k.usaEmbalagem ? '' : ', sem embalagem'})`).join(' · ')}.</p>
      </Section>
      {pend.length > 0 && (
        <Section title={`Pendências que vêm junto (${pend.length})`}>
          <ul className="plain-list small">{pend.map((p) => <li key={p.id}><b>{p.item}</b>: {p.problema}</li>)}</ul>
        </Section>
      )}
    </>
  );
}
