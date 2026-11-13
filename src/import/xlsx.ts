/**
 * Leitor mínimo de planilhas Excel (.xlsx): abre o zip e devolve as linhas de cada aba como texto. Datas do Excel viram dd/mm/aaaa.
 * Não executa nada do arquivo (fórmulas não são calculadas; vale o último valor salvo).
 */

const MAX_UNZIPPED = 30 * 1024 * 1024;

interface ZipEntry {
  name: string;
  method: number;
  offset: number;
  compressedSize: number;
}

function listZip(buf: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('A planilha não é um arquivo .xlsx válido.');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries = new Map<string, ZipEntry>();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('A planilha está corrompida.');
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const offset = view.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { name, method, offset, compressedSize });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readEntry(buf: Uint8Array, e: ZipEntry): Promise<string> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const nameLen = view.getUint16(e.offset + 26, true);
  const extraLen = view.getUint16(e.offset + 28, true);
  const start = e.offset + 30 + nameLen + extraLen;
  const data = buf.slice(start, start + e.compressedSize);
  if (e.method === 0) return new TextDecoder().decode(data);
  if (e.method !== 8) throw new Error('A planilha usa uma compressão que o app não lê.');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_UNZIPPED) throw new Error('A planilha é grande demais.');
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const part of parts) {
    out.set(part, o);
    o += part.length;
  }
  return new TextDecoder().decode(out);
}

const unescapeXml = (s: string) =>
  s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'amp') return '&';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    return String.fromCodePoint(k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
  });

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
/** Junta o texto de todos os <t> de um trecho (texto com formatação vem em vários pedaços). */
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1]!)).join('');

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function dateStyles(stylesXml: string): Set<number> {
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\s[^>]*>/g)) {
    const id = Number(attr(m[0], 'numFmtId'));
    custom.set(id, unescapeXml(attr(m[0], 'formatCode') ?? ''));
  }
  const isDateFormat = (id: number) => {
    if (BUILTIN_DATE_FORMATS.has(id)) return true;
    const code = custom.get(id);
    if (!code) return false;
    const plain = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    return /[dy]/i.test(plain) || /m{1,2}\W*[dy]|[dy]\W*m{1,2}/i.test(plain);
  };
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? '';
  const out = new Set<number>();
  [...xfs.matchAll(/<xf\s[^>]*?\/?>/g)].forEach((m, i) => {
    if (isDateFormat(Number(attr(m[0], 'numFmtId') ?? 0))) out.add(i);
  });
  return out;
}

/** Número de série do Excel (dias desde 30/12/1899) para dd/mm/aaaa. */
export function excelSerialToBR(serial: number): string {
  const ms = Math.round((serial - 25569) * 86_400_000);
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Números do Excel em texto no padrão brasileiro (1234.5 → "1234,50"), para o leitor de valores. */
const numberToBR = (v: string) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return Number.isInteger(n * 100) || Math.abs(n) < 1e12 ? n.toFixed(2).replace('.', ',') : v;
};

interface Book {
  get: (name: string) => Promise<string>;
  shared: string[];
  dates: Set<number>;
  /** Abas na ordem da planilha: nome e arquivo dentro do zip. */
  sheets: { name: string; path: string }[];
}

async function openBook(data: ArrayBuffer): Promise<Book> {
  const buf = new Uint8Array(data);
  const zip = listZip(buf);
  const get = async (name: string) => {
    const e = zip.get(name);
    return e ? readEntry(buf, e) : '';
  };
  const workbook = await get('xl/workbook.xml');
  const rels = [...(await get('xl/_rels/workbook.xml.rels')).matchAll(/<Relationship\s[^>]*>/g)].map((m) => m[0]);
  const sheets = [...workbook.matchAll(/<sheet\s[^>]*>/g)].map((m, i) => {
    const rid = attr(m[0], 'r:id');
    const rel = rid ? rels.find((r) => attr(r, 'Id') === rid) : undefined;
    const t = rel ? attr(rel, 'Target') : undefined;
    const target = t ? t.replace(/^\/?xl\//, '').replace(/^\//, '') : `worksheets/sheet${i + 1}.xml`;
    return { name: unescapeXml(attr(m[0], 'name') ?? `Aba ${i + 1}`), path: `xl/${target}` };
  });
  const shared = [...(await get('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]!));
  const dates = dateStyles(await get('xl/styles.xml'));
  return { get, shared, dates, sheets };
}

/** Linhas de uma aba. `raw`: números como estão no arquivo ("0.35"), sem formatar em reais. */
function parseSheet(sheet: string, book: Book, raw: boolean): string[][] {
  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cm of rm[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const head = cm[1]!;
      const inner = cm[2] ?? '';
      const ref = attr(head, 'r');
      const idx = ref ? colIndex(ref) : row.length;
      const type = attr(head, 't');
      const style = Number(attr(head, 's') ?? -1);
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = '';
      if (type === 's') value = book.shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = texts(inner);
      else if (type === 'str' || type === 'e') value = unescapeXml(v ?? '');
      else if (type === 'b') value = v === '1' ? 'VERDADEIRO' : 'FALSO';
      else if (v !== undefined) value = book.dates.has(style) ? excelSerialToBR(Number(v)) : raw ? v : numberToBR(v);
      while (row.length < idx) row.push('');
      row[idx] = value.trim();
    }
    if (row.some((c) => c !== '')) rows.push(row);
  }
  return rows;
}

export async function readXlsxRows(data: ArrayBuffer): Promise<string[][]> {
  const book = await openBook(data);
  const first = book.sheets[0];
  const sheet = await book.get(first?.path ?? 'xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('Não achei a primeira aba da planilha.');
  return parseSheet(sheet, book, false);
}

/** Todas as abas, pelo nome. Números crus (ponto decimal), datas em dd/mm/aaaa. */
export async function readXlsxSheets(data: ArrayBuffer): Promise<Map<string, string[][]>> {
  const book = await openBook(data);
  const out = new Map<string, string[][]>();
  for (const s of book.sheets) {
    const xml = await book.get(s.path);
    if (xml) out.set(s.name, parseSheet(xml, book, true));
  }
  return out;
}
