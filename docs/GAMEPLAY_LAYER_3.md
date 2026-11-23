# MinePilot Gameplay — Layer 3: resource observation, goals, and verification

**Status:** Layer 3 implementation under test on a stacked draft branch. This is NOT autonomous mining, collection or resource navigation. No new APK installation is requested.

**Dependencies:** PR #89 (same-client Bedrock observation), PR #90 (Layer 1 task/health), PR #91 (Layer 2 navigation previews and named companion tracking). Layer 3 is based on `feature/gameplay-layer-2-follow-planning` and must not be merged independently to main.

## Source of truth and packet types

The implementation is based on the pinned PrismarineJS minecraft-data **Bedrock 1.26.60 / protocol 2225** schema:

- `item_registry.itemstates[].name/runtime_id`: map a numeric item network ID to a verified `minecraft:*` item name; ignore NBT. The registry is bounded to 8192 entries.
- `add_item_entity.runtime_entity_id/item.network_id/item.count/position`: observe a dropped item and its location. Keep up to 96 actors.
- `take_item_entity.runtime_entity_id/target`: record only a pickup notification addressed to the authenticated bot entity ID.
- `inventory_content.window_id/input[]`: read the bot's own inventory window as numeric item totals, without modifying slots, stacks or containers.
- `update_block.position/block_runtime_id/layer`: observe changed block runtime IDs. Keep up to 256 updates and reject nonzero layers. **A changed block runtime ID does not prove a mining action or identify the block species.**
- `remove_entity`: forget vanished dropped item actors.
- `start_game.dimension`: the protocol returns the enum name (`overworld`, `nether`, `end`), so the same-client bridge now normalizes names and numeric dimension IDs.

Block observations are **updates only**, not decoded terrain. The first chunk header is not a voxel map. No production-ready route or safe excavation plan is inferred from unknown chunks.

## Phase B — resource navigation preview

For one known dropped item or recently changed block, compute a distance, direction and maximum one-block waypoint toward its observed coordinates. Treat altitude differences, stale sightings, missing blocks and unobserved terrain as unknown. Every result explicitly carries `executed:false` and a status such as `route_unverified`, `waiting_for_item`, `waiting_for_block_update` or `within_range`.

No movement packet is submitted by resource planning, and the old experimental forward probe is rejected while a resource goal is active. It is not safe to use a forward pulse as a surrogate for pathfinding.

## Phase C — live observations and confirmation

Observed dropped-item names come from item network IDs and the current item registry; never assume block runtime ID equals an item network ID.

For requested collection progress, require both:
1. a server `take_item_entity` event identifying the authenticated bot as the target and a previously observed dropped item of the requested item type; and
2. a subsequent `inventory_content` update with an increase in that same item network ID within the bounded acknowledgment window.

Cap the observed increase to the pickup count and remaining goal quantity. An inventory increase alone is insufficient. A pickup event alone is insufficient. Status becomes `observed_inventory_increase`, **not** “the AI gathered resources autonomously.” External causes of item acquisition can still exist; the host must validate real gameplay.

Block updates are recorded only as observations, never reported as blocks mined by MinePilot.

## Phase D — companion resource goals

- `plan_collect` with exact known item name and count 1–64: finds a fresh observed drop or reports `waiting_for_item`. Does not move or pick up.
- `inspect_block`: finds the nearest *recently updated block* or reports no block observations; no mining.
- `stop_movement`: cancels the active resource goal as well as other navigation goals.
- New accepted Follow, Return, Wait or Stay plans invalidate the previous resource goal; new resource goals similarly cancel the previous navigation plan.
- Critical-health safety turns the resource preview into `paused_by_safety`.

Android Command Center displays drop count, number of block updates, item registry count, up to eight nearby observed item names, the target, distance and server-observed progress. All controls say planning/inspection rather than mining.

## Tests and resource limits

- Unit tests cover registry validation, name mapping, counted drops, expiry, bounded caches, cancelled/dimension-changed goals, malformed packets, inventory-only false positives, pickup-only false positives, and server pickup + inventory correlation.
- Packaged Android Node tests cover same-client packets, a non-moving collection plan, observation of item pickup and inventory, block-update-only inspection, proper cleanup and dimension reset.
- All existing Engine CI, Bedrock Connection Validation, Bedrock SDK Smoke, Android Shell APK and Android Node Runtime Probe workflows must pass.
- No raw Xbox credentials, token exchange data, account identity chains, arbitrary NBT, chat text or arbitrary filesystem content is stored in the resource planner.

## Outstanding functionality for actual gathering

Real collection requires decoded voxel collision data, a verified 20 Hz server-authoritative movement driver with correction handling, player-ground movement and stop behavior, and safe navigation around terrain.

Real mining requires tool selection and reachability checks, version-correct player block actions / auth-input semantics, server-authoritative block-change confirmation, observed drop collection and inventory reconciliation. No feature is marked 'working' until host-observed action results pass actual Minecraft gameplay tests.

**Release strategy:** preserve stacked draft changes; do not ask the user to install an APK after this layer. Test the combined gameplay beta on a suitable device/host when real movement and block interactions have been integrated enough to justify it.

Source: `PrismarineJS/minecraft-data/data/bedrock/1.26.60/protocol.json`, `bedrock-protocol@3.61.0` bundled by `scripts/stage-android-bedrock-sdk.sh`.
