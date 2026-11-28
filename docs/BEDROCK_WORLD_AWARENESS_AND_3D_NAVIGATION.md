# Bedrock World Awareness and Verified 3D Navigation

## Architecture

MinePilot projects normalized Bedrock packets from the existing authenticated Xbox/NetherNet client into one bounded `WorldKnowledgeStore`. It does not create a second connection, use a Java server, infer decisions from prompts, or write positions directly. The store is dimension-scoped, memory-bounded and session-local.

## World awareness

- Player, mob, item-drop and generic-entity spawn/movement observations are normalized into the shared world model.
- `move_actor_absolute` uses its supplied position. `move_actor_delta` merges only the supplied new-position axes with the last server-observed position; missing axes are never guessed.
- Nearby entity queries apply a short freshness window. Inventory-only traffic cannot refresh spatial freshness.
- Entity classification is allowlist-only: known hostile, passive, neutral, player, item-drop or unknown. Unrecognised identifiers are never inferred to be hostile.
- Local terrain awareness samples bounded height bands through the existing verified collision registry. Unknown voxels remain unknown.

## Navigation

The live planner uses bounded 3D A* over cardinal neighboring cells. A route edge is available only when the destination is verified walkable by the Bedrock terrain cache:

- Walk: same-height verified cell.
- Step up: one-block higher verified cell; the movement controller sends a short jump pulse through its existing physics-backed auth-input queue.
- Step down: one-block lower verified cell.
- Sudden multi-block drops, unknown cells, hazards and unverified collision shapes are not traversed.

Search is bounded by horizontal radius, vertical radius, expansion budget and path length. The first autonomous step is re-planned immediately before execution and reconciled against later server position/correction observations. Manual control retains priority and existing survival/session guards remain active.

## Diagnostics

The runtime snapshot contains a compact `worldAwareness` object with observation freshness, nearby entity classifications/counts and bounded local terrain bands. It refreshes at most twice per second in the bridge control loop.

## Validation boundary

Unit/integration tests cover packet normalization, sparse actor movement, entity observation TTL, awareness summaries, verified climb/descent routing, hard barriers, jump-pulse timing and continuous Follow integration. Passing CI validates deterministic software tests and Android packaging; real collision and physics behavior still must be confirmed in an Xbox-hosted Bedrock Android world.
