import test from "node:test";
import assert from "node:assert/strict";
import { decideGameplay, distance } from "../src/gameplay/companion-engine.js";

test("distance is three-dimensional", () => {
  assert.equal(distance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }), 5);
});
test("follow waits for a player who is not visible", () => {
  const result = decideGameplay({ position: { x: 0, y: 64, z: 0 } }, { type: "follow", playerId: "friend" });
  assert.equal(result.intents[0].type, "await_world");
});
test("follow moves toward a visible player", () => {
  const result = decideGameplay({ position: { x: 0, y: 64, z: 0 }, players: [{ id: "friend", position: { x: 10, y: 64, z: 0 } }] }, { type: "follow", playerId: "friend" });
  assert.equal(result.intents[1].type, "move");
});
test("stop within follow distance", () => {
  const result = decideGameplay({ position: { x: 0, y: 64, z: 0 }, players: [{ id: "friend", position: { x: 2, y: 64, z: 0 } }] }, { type: "follow", playerId: "friend" });
  assert.equal(result.intents[0].type, "stop");
});
test("nearby hazards override navigation", () => {
  const result = decideGameplay({ position: { x: 0, y: 64, z: 0 }, blocks: [{ position: { x: 1, y: 64, z: 0 }, kind: "lava", hazard: "lava" }] }, { type: "go_to", position: { x: 20, y: 64, z: 0 } });
  assert.equal(result.reason, "Safety override");
});
test("critical health overrides mining", () => {
  const result = decideGameplay({ position: { x: 0, y: 64, z: 0 }, health: 4, maxHealth: 20 }, { type: "mine", block: "stone", count: 5 });
  assert.equal(result.reason, "Survival override");
});
test("obstacle requests a jump when grounded", () => {
  const result = decideGameplay({ position: { x: 0, y: 64, z: 0 }, onGround: true, blocks: [{ position: { x: 1, y: 64, z: 0 }, kind: "stone", solid: true }] }, { type: "go_to", position: { x: 5, y: 64, z: 0 } });
  assert.equal(result.intents[1].type, "move");
  if (result.intents[1].type === "move") assert.equal(result.intents[1].jump, true);
});
test("action goals are requests, not unverified world effects", () => {
  const result = decideGameplay({ position: { x: 0, y: 64, z: 0 } }, { type: "build", blueprint: "shelter" });
  assert.deepEqual(result.intents[0], { type: "request_action", action: "build", target: "shelter" });
});
