/**
 * Acesso mínimo ao Google Drive (API v3) com o escopo drive.file: o app só enxerga
 * os arquivos que ele mesmo criou. Tudo que sobe já está cifrado.
 */
export interface DriveFile {
  id: string;
  name: string;
  /** Muda a cada gravação: serve para saber se outro aparelho alterou o arquivo. */
  version: string;
}

/** O que a sincronização precisa do Drive. Os testes usam uma versão em memória. */
export interface DriveStore {
  findFolder(name: string): Promise<string | null>;
  createFolder(name: string): Promise<string>;
  list(folderId: string): Promise<DriveFile[]>;
  create(folderId: string, name: string, content: string): Promise<DriveFile>;
  update(fileId: string, content: string): Promise<DriveFile>;
  read(fileId: string): Promise<string>;
  /** Marca do momento atual na lista de mudanças do Drive. */
  startPageToken(): Promise<string>;
  /** O que mudou desde a marca: só os arquivos do app (escopo drive.file), já com a pasta de cada um. */
  changes(pageToken: string): Promise<{ files: DriveChange[]; nextToken: string }>;
}

export interface DriveChange extends DriveFile {
  parents: string[];
  /** Apagado ou na lixeira. */
  removed: boolean;
}

export class DriveError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,version';

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export class GoogleDrive implements DriveStore {
  constructor(private token: string) {}

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${this.token}`, ...(init.headers ?? {}) } });
    if (!res.ok) {
      const msg =
        res.status === 401 ? 'O acesso ao Google expirou. Conecte de novo.' :
        res.status === 403 ? 'O Google recusou o acesso (permissão ou limite de uso). Tente de novo em alguns minutos.' :
        res.status === 404 ? 'Arquivo não encontrado no Drive.' :
        `O Google Drive respondeu com erro ${res.status}.`;
      throw new DriveError(msg, res.status);
    }
    return res;
  }

  async findFolder(name: string): Promise<string | null> {
    const query = `name = '${q(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
    const res = await this.call(`${API}/files?q=${encodeURIComponent(query)}&fields=files(id)&spaces=drive`);
    const data = (await res.json()) as { files: { id: string }[] };
    return data.files[0]?.id ?? null;
  }

  async createFolder(name: string): Promise<string> {
    const res = await this.call(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
    });
    return ((await res.json()) as { id: string }).id;
  }

  async list(folderId: string): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let page: string | undefined;
    const query = `'${q(folderId)}' in parents and trashed = false`;
    do {
      const res = await this.call(`${API}/files?q=${encodeURIComponent(query)}&fields=nextPageToken,files(${FIELDS})&pageSize=1000${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`);
      const data = (await res.json()) as { files: DriveFile[]; nextPageToken?: string };
      out.push(...data.files);
      page = data.nextPageToken;
    } while (page);
    return out;
  }

  async create(folderId: string, name: string, content: string): Promise<DriveFile> {
    const boundary = `cr${crypto.randomUUID().replace(/-/g, '')}`;
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folderId], mimeType: 'application/json' })}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
    const res = await this.call(`${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return (await res.json()) as DriveFile;
  }

  async update(fileId: string, content: string): Promise<DriveFile> {
    const res = await this.call(`${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=${FIELDS}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: content,
    });
    return (await res.json()) as DriveFile;
  }

  /** Manda para a lixeira do Drive (o dono recupera por 30 dias). Com uma pasta, vai tudo dentro dela. */
  async trash(fileId: string): Promise<void> {
    await this.call(`${API}/files/${encodeURIComponent(fileId)}?fields=id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
  }

  async read(fileId: string): Promise<string> {
    const res = await this.call(`${API}/files/${encodeURIComponent(fileId)}?alt=media`);
    return res.text();
  }

  async startPageToken(): Promise<string> {
    const res = await this.call(`${API}/changes/startPageToken`);
    return ((await res.json()) as { startPageToken: string }).startPageToken;
  }

  async changes(pageToken: string): Promise<{ files: DriveChange[]; nextToken: string }> {
    const files: DriveChange[] = [];
    let page = pageToken;
    for (;;) {
      const res = await this.call(`${API}/changes?pageToken=${encodeURIComponent(page)}&pageSize=1000&spaces=drive&includeRemoved=true&fields=nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,version,parents,trashed))`);
      const data = (await res.json()) as {
        nextPageToken?: string;
        newStartPageToken?: string;
        changes: { fileId: string; removed?: boolean; file?: { id: string; name: string; version: string; parents?: string[]; trashed?: boolean } }[];
      };
      for (const c of data.changes) {
        files.push({ id: c.fileId, name: c.file?.name ?? '', version: c.file?.version ?? '', parents: c.file?.parents ?? [], removed: !!c.removed || !!c.file?.trashed });
      }
      if (data.newStartPageToken) return { files, nextToken: data.newStartPageToken };
      if (!data.nextPageToken) return { files, nextToken: page };
      page = data.nextPageToken;
    }
  }
}

/** E-mail da conta Google conectada (para não sincronizar com a conta errada). */
export async function googleEmail(token: string): Promise<string> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new DriveError('Não consegui confirmar a conta Google.', res.status);
  const data = (await res.json()) as { email?: string; email_verified?: boolean };
  if (!data.email || data.email_verified === false) throw new DriveError('A conta Google não tem e-mail confirmado.', 403);
  return data.email.toLowerCase();
}

/** Drive em memória, para testes. Conta as chamadas e simula falha de rede. */
export class MemoryDrive implements DriveStore {
  files = new Map<string, { name: string; parent: string | null; content: string; version: number; folder: boolean }>();
  private n = 0;
  private log: string[] = [];
  calls: Record<string, number> = {};
  /** Quantas das próximas chamadas falham como se a internet caísse. */
  failNext = 0;
  /** Todas as chamadas falham com 401 (login vencido). */
  expired = false;
  private hit(op: string) {
    this.calls[op] = (this.calls[op] ?? 0) + 1;
    if (this.expired) throw new DriveError('O acesso ao Google expirou. Conecte de novo.', 401);
    if (this.failNext > 0) {
      this.failNext--;
      throw new TypeError('Failed to fetch');
    }
  }
  private changed(id: string) {
    this.log.push(id);
  }
  async startPageToken() {
    this.hit('startPageToken');
    return String(this.log.length);
  }
  async changes(pageToken: string) {
    this.hit('changes');
    const from = Number(pageToken);
    const ids = [...new Set(this.log.slice(from))];
    const files = ids.map((id) => {
      const f = this.files.get(id);
      return { id, name: f?.name ?? '', version: String(f?.version ?? 0), parents: f?.parent ? [f.parent] : [], removed: !f };
    });
    return { files, nextToken: String(this.log.length) };
  }
  /** Apaga um arquivo como se o dono tivesse mexido na pasta. */
  remove(id: string) {
    this.files.delete(id);
    this.changed(id);
  }
  async findFolder(name: string) {
    this.hit('findFolder');
    for (const [id, f] of this.files) if (f.folder && f.name === name) return id;
    return null;
  }
  async createFolder(name: string) {
    this.hit('createFolder');
    const id = `f${++this.n}`;
    this.files.set(id, { name, parent: null, content: '', version: 1, folder: true });
    this.changed(id);
    return id;
  }
  async list(folderId: string) {
    this.hit('list');
    return [...this.files.entries()].filter(([, f]) => f.parent === folderId).map(([id, f]) => ({ id, name: f.name, version: String(f.version) }));
  }
  async create(folderId: string, name: string, content: string) {
    this.hit('create');
    const id = `d${++this.n}`;
    this.files.set(id, { name, parent: folderId, content, version: 1, folder: false });
    this.changed(id);
    return { id, name, version: '1' };
  }
  async update(fileId: string, content: string) {
    this.hit('update');
    const f = this.files.get(fileId);
    if (!f) throw new DriveError('Arquivo não encontrado no Drive.', 404);
    f.content = content;
    f.version++;
    this.changed(fileId);
    return { id: fileId, name: f.name, version: String(f.version) };
  }
  async read(fileId: string) {
    this.hit('read');
    const f = this.files.get(fileId);
    if (!f) throw new DriveError('Arquivo não encontrado no Drive.', 404);
    return f.content;
  }
}
