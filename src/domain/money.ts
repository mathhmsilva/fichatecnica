/**
 * Dinheiro é sempre guardado em centavos inteiros (number seguro até ~90 trilhões de reais),
 * para nunca sobrar R$ 0,01 de arredondamento.
 */
export type Cents = number;

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatBRL(cents: Cents): string {
  return BRL.format(cents / 100);
}

/**
 * Converte texto para centavos. Aceita formatos brasileiros e internacionais:
 * "1.234,56", "-1.234,56", "R$ 1.234,56", "1234.56", "1,234.56", "(12,30)", "12,30-", "12,30 D".
 * Retorna null quando o texto não é um valor.
 */
export function parseAmount(input: string): Cents | null {
  let s = input.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  // Sufixos usados por extratos: "D" débito, "C" crédito, "-" no fim.
  const suffix = s.match(/\s*([DC])$/i);
  if (suffix) {
    if (suffix[1]!.toUpperCase() === 'D') negative = true;
    s = s.slice(0, suffix.index);
  }
  if (s.endsWith('-')) {
    negative = true;
    s = s.slice(0, -1);
  }
  s = s.replace(/R\$\s*/i, '').replace(/\s/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s)) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let intPart: string;
  let fracPart = '';
  const decimalIndex = Math.max(lastComma, lastDot);
  if (decimalIndex === -1) {
    intPart = s;
  } else {
    const sep = s[decimalIndex]!;
    const digitsAfter = s.length - decimalIndex - 1;
    const otherSep = sep === ',' ? '.' : ',';
    const sepCount = s.split(sep).length - 1;
    // "1.234" (ponto como milhar, sem decimais) vs "12.34" (ponto decimal).
    const isThousands = digitsAfter === 3 && sepCount >= 1 && !s.includes(otherSep) && sep === '.';
    if (isThousands || (sepCount > 1 && !s.includes(otherSep))) {
      intPart = s.split(sep).join('');
    } else {
      intPart = s.slice(0, decimalIndex).split(otherSep).join('').split(sep).join('');
      fracPart = s.slice(decimalIndex + 1);
    }
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart) || (intPart === '' && fracPart === '')) return null;
  if (fracPart.length > 2) {
    // Arredonda meio para cima no terceiro dígito.
    const extra = Number(fracPart[2]);
    fracPart = fracPart.slice(0, 2);
    const base = Number(intPart || '0') * 100 + Number(fracPart);
    const cents = extra >= 5 ? base + 1 : base;
    return negative ? -cents : cents;
  }
  const cents = Number(intPart || '0') * 100 + Number(fracPart.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  return negative && cents !== 0 ? -cents : cents;
}

/** Percentual com 1 casa, ex.: 0.3123 -> "31,2%". */
export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
