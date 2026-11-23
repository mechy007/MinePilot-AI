/** MinePilot gameplay decisions. Original implementation; no addon source copied.
 * Pure, transport-independent logic: the Bedrock session adapter must translate
 * resulting intents into supported protocol actions and confirm server state.
 */
export type Vec3 = { x: number; y: number; z: number };
export type Hazard = "lava" | "fire" | "cactus" | "void" | "water" | "fall";
export type NearbyPlayer = { id: string; position: Vec3; trusted?: boolean };
export type NearbyBlock = { position: Vec3; kind: string; solid?: boolean; hazard?: Hazard };
export type WorldSnapshot = {
  position: Vec3; health?: number; maxHealth?: number; hunger?: number;
  timeOfDay?: number; onGround?: boolean; inWater?: boolean;
  players?: NearbyPlayer[]; blocks?: NearbyBlock[];
};
export type Goal =
  | { type: "follow"; playerId: string; distance?: number }
  | { type: "go_to"; position: Vec3 }
  | { type: "collect"; item: string; count: number }
  | { type: "mine"; block: string; count: number }
  | { type: "build"; blueprint: string }
  | { type: "guard"; playerId?: string }
  | { type: "explore" }
  | { type: "idle" };
export type Intent =
  | { type: "move"; toward: Vec3; sprint: boolean; jump: boolean }
  | { type: "look"; toward: Vec3 }
  | { type: "stop"; reason: string }
  | { type: "request_action"; action: "eat" | "escape_water" | "seek_shelter" | "collect" | "mine" | "build" | "guard" | "explore"; target?: string; count?: number }
  | { type: "await_world"; reason: string };
export type Decision = { goal: Goal; intents: Intent[]; reason: string };
export const distance = (a: Vec3, b: Vec3): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const hazardNear = (world: WorldSnapshot): boolean =>
  (world.blocks ?? []).some(b => !!b.hazard && distance(world.position, b.position) < 2.2);
const obstruction = (world: WorldSnapshot, target: Vec3): boolean => {
  const dx = target.x - world.position.x, dz = target.z - world.position.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.01) return false;
  const ahead = { x: world.position.x + dx / len, y: world.position.y, z: world.position.z + dz / len };
  return (world.blocks ?? []).some(b => b.solid && Math.abs(b.position.y - ahead.y) < 1.5 && distance(b.position, ahead) < 1.1);
};
export function decideGameplay(world: WorldSnapshot, goal: Goal): Decision {
  if (![world.position.x, world.position.y, world.position.z].every(Number.isFinite))
    return { goal, intents: [{ type: "await_world", reason: "Invalid server position" }], reason: "No valid world position" };
  if (hazardNear(world))
    return { goal, intents: [{ type: "stop", reason: "Hazard detected near bot" }], reason: "Safety override" };
  if (world.inWater)
    return { goal, intents: [{ type: "request_action", action: "escape_water" }], reason: "Water safety override" };
  if (world.health !== undefined && world.maxHealth !== undefined && world.maxHealth > 0 && world.health / world.maxHealth < 0.35)
    return { goal, intents: [{ type: "stop", reason: "Critical health" }, { type: "request_action", action: "eat" }], reason: "Survival override" };
  if (world.hunger !== undefined && world.hunger < 7)
    return { goal, intents: [{ type: "request_action", action: "eat" }], reason: "Low hunger" };
  if (goal.type === "idle")
    return { goal, intents: [{ type: "stop", reason: "Idle goal" }], reason: "Idle" };
  let target: Vec3 | undefined;
  let stoppingDistance = 1;
  if (goal.type === "go_to") target = goal.position;
  if (goal.type === "follow") {
    const player = (world.players ?? []).find(p => p.id === goal.playerId);
    if (!player) return { goal, intents: [{ type: "await_world", reason: "Follow target not visible" }], reason: "Missing target" };
    target = player.position;
    stoppingDistance = Math.max(1.5, goal.distance ?? 3);
  }
  if (target) {
    if (distance(world.position, target) <= stoppingDistance)
      return { goal, intents: [{ type: "stop", reason: "Destination reached" }], reason: "At destination" };
    const blocked = obstruction(world, target);
    return { goal, intents: [{ type: "look", toward: target }, { type: "move", toward: target, sprint: distance(world.position, target) > 7 && !blocked, jump: blocked && world.onGround === true }], reason: blocked ? "Obstacle ahead" : "Navigating" };
  }
  switch (goal.type) {
    case "collect": return { goal, intents: [{ type: "request_action", action: "collect", target: goal.item, count: goal.count }], reason: "Collection requested" };
    case "mine": return { goal, intents: [{ type: "request_action", action: "mine", target: goal.block, count: goal.count }], reason: "Mining requested" };
    case "build": return { goal, intents: [{ type: "request_action", action: "build", target: goal.blueprint }], reason: "Construction requested" };
    case "guard": return { goal, intents: [{ type: "request_action", action: "guard", target: goal.playerId }], reason: "Guard requested" };
    case "explore": return { goal, intents: [{ type: "request_action", action: "explore" }], reason: "Exploration requested" };
  }
  return { goal, intents: [{ type: "await_world", reason: "Goal requires live executor" }], reason: "Deferred goal" };
}
