import { IDENTIFIER } from '@parkright/contracts';

/** A fresh stream session id, e.g. "sim-20261014-234512-9f3a". Valid as a contract Identifier. */
export function newSessionId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const id = `sim-${stamp}-${crypto.randomUUID().slice(0, 4)}`;
  if (!IDENTIFIER.test(id)) throw new Error(`invalid session id ${id}`);
  return id;
}
