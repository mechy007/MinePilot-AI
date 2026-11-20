import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConnectionConfig } from '../src/connection/config.js';
test('accepts validated owner XUID without converting to unsafe number', () => {
  const c = parseConnectionConfig({ ownerXuid: '2533274790399999999', accountLabel: 'Bot account' });
  assert.equal(c.ownerXuid, '2533274790399999999');
  assert.equal(c.accountLabel, 'Bot account');
  assert.ok(Object.isFrozen(c));
});
test('rejects missing, malformed, zero and out-of-range XUID', () => {
  for (const ownerXuid of [undefined, 123, '', 'abc', '0', '-1', '18446744073709551616', '1'.repeat(21)]) {
    assert.throws(() => parseConnectionConfig({ ownerXuid }));
  }
});
test('rejects unexpected fields to avoid accidental secret storage', () => {
  assert.throws(() => parseConnectionConfig({ ownerXuid: '2', accessToken: 'secret' }));
  assert.throws(() => parseConnectionConfig({ ownerXuid: '2', accountLabel: 'bad\nlabel' }));
});
