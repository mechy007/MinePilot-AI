import test from 'node:test';
import assert from 'node:assert/strict';
import { MinePilotAgent, type Skill } from '../src/core/agent.js';
const safe = { health: 20, hunger: 20, threat: 0, timestamp: 0 };
test('executes a known skill', async () => {
  const skill: Skill = { name: 'follow', run: async () => ({ ok: true }) };
  const agent = new MinePilotAgent(new Map([['follow', skill]]));
  assert.deepEqual(await agent.execute({ id: '1', command: 'follow', status: 'pending' }, safe), { ok: true });
  assert.equal(agent.currentGoal?.status, 'completed');
});
test('rejects unsafe execution', async () => {
  const skill: Skill = { name: 'follow', run: async () => ({ ok: true }) };
  const agent = new MinePilotAgent(new Map([['follow', skill]]));
  assert.equal((await agent.execute({ id: '2', command: 'follow', status: 'pending' }, { ...safe, threat: 95 })).ok, false);
});
test('rejects unknown commands', async () => {
  const agent = new MinePilotAgent(new Map());
  assert.equal((await agent.execute({ id: '3', command: 'unknown', status: 'pending' }, safe)).reason, 'Unknown command');
});
