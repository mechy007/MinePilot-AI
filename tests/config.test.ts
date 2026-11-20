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
test('reads each property once even when getters change their values', () => {
  let xuidReads = 0;
  let labelReads = 0;
  const config = {
    get ownerXuid() { return ++xuidReads === 1 ? '2' : 'invalid'; },
    get accountLabel() { return ++labelReads === 1 ? 'Bot' : 'bad\nlabel'; }
  };
  const result = parseConnectionConfig(config);
  assert.equal(result.ownerXuid, '2');
  assert.equal(result.accountLabel, 'Bot');
  assert.equal(xuidReads, 1);
  assert.equal(labelReads, 1);
});
