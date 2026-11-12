import type { Unidade } from '../domain/ficha';

export { fmt } from '../domain/ficha';

/** Percentual com 1 casa ("31,2%"); `null` vira travessão. */
export function pct(v: number | null | undefined, casas = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
}

const n = (v: number, max = 3) => v.toLocaleString('pt-BR', { maximumFractionDigits: max });

/**
 * Quantidade para a cozinha: kg e L em gramas e mililitros (0,35 kg → "350 g"),
 * a partir de 1 kg em quilos ("1,2 kg").
 */
export function qtd(v: number | null | undefined, u: Unidade): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (u === 'un') return `${n(v, 2)} un`;
  const small = u === 'kg' ? 'g' : 'ml';
  if (Math.abs(v) >= 1) return `${n(v, 3)} ${u}`;
  return `${n(v * 1000, 1)} ${small}`;
}

/** Unidade em que a quantidade é digitada nas fichas: g, ml ou un. */
export const unidadeDigitada = (u: Unidade) => (u === 'kg' ? 'g' : u === 'L' ? 'ml' : 'un');
export const fatorDigitado = (u: Unidade) => (u === 'un' ? 1 : 1000);

/** Texto digitado ("1.234,5", "0,35", "12") para número. Vazio ou inválido vira `null`. */
export function parseNum(s: string): number | null {
  let t = s.trim().replace(/\s|R\$|%/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** Número para o campo de texto, em português e sem zeros sobrando ("0,35"). */
export function numText(v: number | null | undefined, max = 4): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '';
  return v.toLocaleString('pt-BR', { maximumFractionDigits: max, useGrouping: false });
}

/** "2026-11" → "novembro de 2026". */
export function periodoLabel(p: string): string {
  const [y, m] = p.split('-').map(Number) as [number, number];
  if (!y || !m) return p;
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
