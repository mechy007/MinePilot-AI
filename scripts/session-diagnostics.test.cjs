'use strict';
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { test } = require('node:test');
const { runtimeLogger } = require('./android-xbox-auth-probe.cjs');

test('runtime logger persists full bounded gameplay diagnostics and redacts identities', () => {
  const directory = mkdtempSync(join(tmpdir(), 'minepilot-diagnostics-'));
  const file = join(directory, 'session.jsonl');
  try {
    const publish = runtimeLogger(file);
    publish({ phase: 'sign_in_start' });
    publish({
      phase: 'spawned',
      chunks: 12,
      seconds: 9,
      gameplay: {
        position: { x: 10, y: 64, z: -2 },
        packetTelemetry: { received: 24, errors: 1, byType: { move_player: 8 },
          lastType: 'move_player', lastSummary: { position: { x: 10, y: 64, z: -2 } } },
        commandTelemetry: { received: 4, byAction: { manual_move: 3 },
          last: { action: 'manual_move', status: 'accepted', reason: 'queued' } },
        player: { xuid: 'private-xuid', gamertag: 'private-gamertag', name: 'private-name' },
        auth: { accessToken: 'private-token' }
      }
    });
    const events = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(events.length, 2);
    assert.equal(events[0].phase, 'sign_in_start');
    assert.equal(events[1].gameplay.packetTelemetry.byType.move_player, 8);
    assert.equal(events[1].gameplay.commandTelemetry.last.action, 'manual_move');
    const serialized = JSON.stringify(events);
    for (const secret of ['private-xuid', 'private-gamertag', 'private-name', 'private-token'])
      assert.equal(serialized.includes(secret), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
