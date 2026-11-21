import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { MovePlayerPacketWriter } from '../src/minecraft/move-player-writer.js';

class PacketClient extends EventEmitter {
  packets: Array<{name:string;payload:Record<string,unknown>}> = [];
  queue(name:string,payload:Record<string,unknown>):void { this.packets.push({name,payload}); }
  close():void {}
}
test('movement writer sends bounded displacement with session entity id', async () => {
  const client = new PacketClient();
  const writer = new MovePlayerPacketWriter(() => ({
    runtimeEntityId: 123n, position: {x:0,y:64,z:0}, tick: 1n
  }), 0.25, undefined, true);
  await writer.move(client,{x:10,y:64,z:0},new AbortController().signal);
  assert.equal(client.packets[0].name,'move_player');
  assert.equal(client.packets[0].payload.runtime_id,123n);
  assert.deepEqual(client.packets[0].payload.position,{x:0.25,y:64,z:0});
});
test('writer refuses missing session and cancelled movement', async () => {
  const client = new PacketClient();
  await assert.rejects(new MovePlayerPacketWriter(() => null, 0.25, undefined, true).move(client,{x:1,y:1,z:1},new AbortController().signal),/not initialized/);
  const controller = new AbortController();controller.abort();
  await assert.rejects(new MovePlayerPacketWriter(() => ({runtimeEntityId:1,position:{x:0,y:0,z:0},tick:1n}), 0.25, undefined, true).move(client,{x:1,y:1,z:1},controller.signal),/cancelled/);
  assert.equal(client.packets.length,0);
});

test('legacy movement is disabled by default for unverified server-authoritative worlds', async () => {
  const client = new PacketClient();
  const writer = new MovePlayerPacketWriter(() => ({runtimeEntityId:1,position:{x:0,y:0,z:0},tick:1n}));
  await assert.rejects(writer.move(client,{x:1,y:0,z:0},new AbortController().signal),/player_auth_input required/);
  assert.equal(client.packets.length,0);
});
