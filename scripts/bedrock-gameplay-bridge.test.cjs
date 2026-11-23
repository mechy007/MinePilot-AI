'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { test } = require('node:test');
const { BedrockGameplayBridge } = require('./bedrock-gameplay-bridge.cjs');
const { ExperimentalPlayerInput, buildInputPacket } = require('./bedrock-player-input.cjs');

class Client extends EventEmitter {
  sent = [];
  queue(packet, value) { this.sent.push({ packet, value }); }
}
const origin = { x: 8.5, y: 64, z: 10.5 };
const start = { runtime_entity_id: 123n, player_position: origin, dimension: 0,
  current_tick: 100n, movement_authority: 1 };
function initialized(client, bridge) {
  client.emit('start_game', start);
  client.emit('spawn');
  client.emit('level_chunk', { x: 0, z: 0, dimension: 0 });
  assert.equal(bridge.snapshot().state, 'observing');
}

test('world state mirrors only live packet data, without inventing blocks', () => {
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client).start();
  assert.equal(bridge.snapshot().state, 'awaiting_world');
  initialized(client, bridge);
  assert.deepEqual(bridge.snapshot().position, origin);
  assert.equal(bridge.snapshot().blocksDecoded, false);
  assert.equal(bridge.snapshot().loadedChunkHeaders, 1);
  client.emit('add_player', { runtime_entity_id: 999n, username: 'Friend',
    position: { x: 2, y: 64, z: 5 } });
  client.emit('move_player', { runtime_entity_id: 999n, position: { x: 3, y: 64, z: 6 } });
  assert.equal(bridge.snapshot().visiblePlayers, 1);
  client.emit('move_player', { runtime_entity_id: 123n,
    position: { x: 10, y: 64, z: 10 }, yaw: 90 });
  assert.equal(bridge.snapshot().position.x, 10);
  client.emit('correct_player_move_prediction', {
    position: { x: 9, y: 64, z: 10 }, tick: 105n
  });
  assert.equal(bridge.snapshot().correctionCount, 1);
  assert.equal(bridge.snapshot().position.x, 9);
  client.emit('remove_actor', { entity_id: 999n });
  assert.equal(bridge.snapshot().visiblePlayers, 0);
  client.emit('change_dimension', { dimension: 1 });
  assert.equal(bridge.snapshot().position, null);
  assert.equal(bridge.snapshot().loadedChunkHeaders, 0);
  bridge.stop();
  assert.equal(client.listenerCount('level_chunk'), 0);
  assert.equal(bridge.snapshot().state, 'closed');
});

test('chunk cache is bounded and ignores invalid/chunkless packets', () => {
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client).start();
  for (let i = 0; i < 300; i++) client.emit('level_chunk', { x: i, z: 0, dimension: 0 });
  client.emit('level_chunk', { x: Infinity, z: 0, dimension: 0 });
  client.emit('level_chunk', { x: 0, z: 1e9, dimension: 0 });
  assert.equal(bridge.snapshot().loadedChunkHeaders, 128);
  bridge.stop();
});

test('private single-command inbox handles status, stop and rejected commands', t => {
  const dir = mkdtempSync(join(tmpdir(), 'minepilot-gameplay-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const commandPath = join(dir, 'command.json'), receiptPath = join(dir, 'receipt.json');
  let stops = 0;
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client, { commandPath, receiptPath,
    movement: { stop() { stops++; }, capability() { return 'unavailable'; } } }).start();
  const cmd = (requestId, action, rest = {}) => {
    writeFileSync(commandPath, JSON.stringify({
      version: 'minepilot.gameplay.v1', requestId, action, ...rest
    }));
    bridge.poll();
    assert.equal(existsSync(commandPath), false);
    return JSON.parse(readFileSync(receiptPath, 'utf8'));
  };
  assert.equal(cmd('cmd-1', 'status').status, 'ok');
  assert.equal(cmd('cmd-2', 'stop_movement').reason, 'movement_cancelled');
  assert.equal(stops, 1);
  assert.equal(cmd('cmd-3', 'probe_step', { confirmed: true, direction: 'forward' }).reason, 'movement_unavailable');
  assert.equal(cmd('cmd-4', 'mine').reason, 'invalid_command');
  writeFileSync(commandPath, '{"version":"minepilot.gameplay.v1","action":"status"');
  bridge.poll();
  assert.equal(JSON.parse(readFileSync(receiptPath, 'utf8')).reason, 'invalid_command');
  bridge.stop();
  assert.equal(stops, 2);
});

test('PlayerAuthInput builder is bounded and uses 1.26.60 ordinal input flags', () => {
  const frame = buildInputPacket(origin, 0, 101n, true);
  assert.equal(frame.position.z, origin.z + 0.065);
  assert.deepEqual(frame.input_data, [10]);
  assert.equal(frame.tick, 101n);
  assert.equal(frame.input_mode, 'touch');
  assert.equal(frame.raw_move_vector.z, 1);
  const stopped = buildInputPacket(frame.position, 0, 102n, false);
  assert.equal(stopped.position.z, frame.position.z);
  assert.deepEqual(stopped.input_data, []);
  assert.throws(() => buildInputPacket(origin, NaN, 101n, true), /Invalid/);
});

test('experimental diagnostic input requires opt-in, movement authority and explicit confirmation', async () => {
  const client = new Client();
  const disabled = new ExperimentalPlayerInput(client, false);
  const bridge = new BedrockGameplayBridge(client, { movement: disabled }).start();
  initialized(client, bridge);
  const probe = { version: 'minepilot.gameplay.v1', requestId: 'step1',
    action: 'probe_step', confirmed: true, direction: 'forward' };
  assert.equal(bridge.execute(probe).reason, 'movement_unavailable');
  assert.equal(client.sent.length, 0);
  bridge.stop();

  const enabled = new ExperimentalPlayerInput(client, true);
  const session = new BedrockGameplayBridge(client, { movement: enabled }).start();
  initialized(client, session);
  assert.equal(session.execute({ ...probe, confirmed: false }).reason, 'confirmation_required');
  assert.equal(session.execute(probe).status, 'accepted');
  await new Promise(resolve => setTimeout(resolve, 160));
  assert.ok(client.sent.length >= 1 && client.sent.length <= 6, 'bounded tick pulse');
  assert.ok(client.sent.every(s => s.packet === 'player_auth_input'));
  assert.ok(client.sent.every((s, i) => i === 0 || s.value.tick > client.sent[i - 1].value.tick));
  session.stop();
  const count = client.sent.length;
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(client.sent.length, count);
});
