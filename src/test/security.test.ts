import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createVault, unlockVault, verifyRecoveryCode, changePassword, replaceRecoveryCode, enrollDevice, unlockWithPin, seal, open, normalizeRecoveryCode, MAX_PIN_ATTEMPTS } from '../crypto/vault';
import { makeEvents, verifyChain, type EventData } from '../store/events';
import { LocalDb, decryptBatches } from '../store/localdb';

const PASSWORD = 'forno a lenha de domingo';

describe('cofre', () => {
  it('destrava com a senha e com os dois códigos, e recusa senha errada', async () => {
    const v = await createVault(PASSWORD);
    const sealed = await seal(v.key, { ok: 1 }, 'x');
    expect(await unlockVault(v.header, 'senha errada qualquer')).toBeNull();
    for (const [secret, kind] of [[PASSWORD, 'senha'], [v.recoveryCodes[0], 'recuperacao'], [v.recoveryCodes[1].toLowerCase(), 'recuperacao']] as const) {
      const u = await unlockVault(v.header, secret, kind);
      expect(u).not.toBeNull();
      expect(await open(u!.key, sealed, 'x')).toEqual({ ok: 1 });
    }
    expect(await verifyRecoveryCode(v.header, v.recoveryCodes[0])).toBe(v.header.wrappers[1]!.id);
  }, 30_000);

  it('a chave de dados não pode ser exportada', async () => {
    const v = await createVault(PASSWORD);
    expect(v.key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', v.key)).rejects.toThrow();
  }, 30_000);

  it('dado cifrado com um contexto não abre em outro (AAD)', async () => {
    const v = await createVault(PASSWORD);
    const sealed = await seal(v.key, [1, 2], 'lote-a');
    await expect(open(v.key, sealed, 'lote-b')).rejects.toThrow();
  }, 30_000);

  it('troca a senha e substitui um código perdido', async () => {
    const v = await createVault(PASSWORD);
    const h2 = await changePassword(v.header, v.recoveryCodes[0], 'recuperacao', 'nova senha bem comprida');
    expect(await unlockVault(h2, PASSWORD)).toBeNull();
    expect(await unlockVault(h2, 'nova senha bem comprida')).not.toBeNull();
    const lostId = h2.wrappers.find((w) => w.label.startsWith('Código 2'))!.id;
    const { header: h3, code } = await replaceRecoveryCode(h2, 'nova senha bem comprida', lostId);
    expect(await unlockVault(h3, v.recoveryCodes[1], 'recuperacao')).toBeNull();
    expect(await unlockVault(h3, code, 'recuperacao')).not.toBeNull();
    expect(normalizeRecoveryCode('abcd-efgh')).toBe('ABCDEFGH');
  }, 60_000);

  it('PIN do aparelho: destrava, e 5 erros exigem a senha de novo', async () => {
    const v = await createVault(PASSWORD);
    const device = await enrollDevice(v.header, PASSWORD, '284913', 'dev1');
    const ok = await unlockWithPin(device, '284913');
    expect(ok.ok).toBe(true);
    for (let i = 1; i <= MAX_PIN_ATTEMPTS; i++) {
      const r = await unlockWithPin(device, '000001');
      expect(r).toEqual({ ok: false, attemptsLeft: MAX_PIN_ATTEMPTS - i });
    }
    expect((await unlockWithPin(device, '284913')).ok).toBe(false);
    await expect(enrollDevice(v.header, PASSWORD, '123456', 'dev1')).rejects.toThrow();
  }, 120_000);
});

describe('registro de eventos', () => {
  it('detecta registro apagado, alterado ou fora de ordem', async () => {
    const items: EventData[] = [
      { type: 'config.set', config: { impostos: 0.01 } },
      { type: 'config.set', config: { impostos: 0.02 } },
      { type: 'config.set', config: { impostos: 0.03 } },
    ];
    const evs = await makeEvents('d1', null, items);
    expect(await verifyChain(evs)).toEqual([]);
    expect((await verifyChain([evs[0]!, evs[2]!])).length).toBeGreaterThan(0);
    const tampered = { ...evs[1]!, data: { type: 'config.set' as const, config: { impostos: 0.99 } } };
    expect((await verifyChain([evs[0]!, tampered, evs[2]!])).some((p) => p.message.includes('alterado'))).toBe(true);
  });
});

describe('banco local', () => {
  it('guarda só dados cifrados e lê de volta', async () => {
    const v = await createVault(PASSWORD);
    const db = await LocalDb.open(`teste-${Math.random()}`);
    await db.setHeader(v.header);
    const evs = await makeEvents('d1', null, [{ type: 'config.set', config: { impostos: 0.05 } }]);
    await db.appendEvents(v.key, v.header.vaultId, evs);
    const raw = JSON.stringify(await db.allBatches());
    expect(raw).not.toContain('config.set');
    expect(await db.readEvents(v.key, v.header.vaultId)).toEqual(evs);
    // Trocar o aparelho de um lote invalida a decifragem.
    const [b] = await db.allBatches();
    await expect(decryptBatches(v.key, v.header.vaultId, [{ ...b!, device: 'outro' }])).rejects.toThrow();
  }, 30_000);
});
