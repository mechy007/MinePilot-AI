import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PrismarineRuntimeAdapter } from '../src/minecraft/prismarine-runtime-adapter.js';
import { BotRuntime } from '../src/core/bot-runtime.js';
import type { BedrockClientFactory, BedrockClientLike } from '../src/connection/prismarine-world-client.js';

class FakeClient extends EventEmitter {
  close(): void { this.emit('close'); }
}
test('authenticated world spawn connects to runtime, decodes state and delegates movement', async () => {
  const client = new FakeClient();
  const factory: BedrockClientFactory = () => {
    queueMicrotask(() => client.emit('spawn'));
    return client as BedrockClientLike;
  };
  const writes: unknown[] = [];
  const adapter = new PrismarineRuntimeAdapter('bot','123', {
    async move(_client,target) { writes.push(target); }
  },factory);
  const runtime = new BotRuntime(adapter);
  await runtime.connect();
  await assert.rejects(adapter.observe(), /incomplete/);
  client.emit('start_game',{runtime_entity_id:'7'});
  client.emit('move_player',{runtime_id:7,position:{x:1,y:64,z:2}});
  client.emit('update_attributes',{attributes:[
    {name:'minecraft:health',current:20},
    {name:'minecraft:player.hunger',current:15}
  ]});
  runtime.setTarget({x:3,y:64,z:4});
  assert.equal((await runtime.step()).mode,'moving');
  assert.deepEqual(writes,[{x:3,y:64,z:4}]);
  await runtime.disconnect();
});
test('movement fails closed without a verified packet writer', async () => {
  const client = new FakeClient();
  const adapter = new PrismarineRuntimeAdapter('bot','123',undefined,() => {
    queueMicrotask(() => client.emit('spawn'));
    return client as BedrockClientLike;
  });
  await adapter.connect();
  await assert.rejects(adapter.moveToward({x:1,y:2,z:3},new AbortController().signal), /session not initialized/);
  await adapter.disconnect();
});

test('ignores movement for other entities and accepts normalized self ID', async () => {
  const client = new FakeClient();
  const adapter = new PrismarineRuntimeAdapter('bot','123',undefined,() => {
    queueMicrotask(() => client.emit('spawn'));
    return client as BedrockClientLike;
  });
  await adapter.connect();
  client.emit('start_game',{runtime_entity_id:'7'});
  client.emit('move_player',{runtime_id:7,position:{x:1,y:64,z:2}});
  client.emit('update_attributes',{attributes:[{name:'minecraft:health',current:20},{name:'minecraft:player.hunger',current:20}]});
  client.emit('move_player',{runtime_id:8,position:{x:999,y:64,z:2}});
  assert.equal((await adapter.observe()).position.x,1);
  await adapter.disconnect();
});
