# MinePilot Layers 4 and 5 — Survival + Shelter/Crafting Plans

**Architecture:** Both layers run in the *same* Android friend-world Bedrock Node client. Nothing here creates another Xbox session, sends movement, breaks blocks, places blocks, consumes food, crafts items, or changes inventory.

## Layer 4 — Survival priorities (PR #93)

- Read server-reported health, max health, hunger, air supply and time-of-day. Ignore other players' attribute updates.
- Critical health or critically low air triggers an immediate stop of the *experimental* movement pulse. Active planned Follow/Return/Collect work is paused, and restored only to **ready_to_replan** after verified attribute recovery. No movement automatically resumes.
- Hunger and nighttime produce cautionary observations. Neither proves there is a hostile mob, safe water escape route or shelter nearby.
- Recognize a bounded list of vanilla food IDs using the actual player inventory and item registry. A Plan Food command suggests an observed item and never sends a use-item packet; it is not automatic eating.
- Android shows survival level, paused-task state, available food and a read-only food-use proposal. User Stop retains critical health status.

## Layer 5 — Crafting / Construction (PR #94)

- Original bounded 3×3 wooden shelter: 2-block-high ring of walls, south-facing two-high entrance and 3×3 roof. Exactly **23 proposed block placements**. Terrain is NOT decoded, so origin, occupied blocks, safe placement, protected structures, support, collision and survival risk are all unverified.
- Material inventory comes from the server's validated item registry and player's inventory-content packet. No inventory mutations.
- Recognizes common plank variants. Displays owned planks, missing quantity and an **advisory** conversion estimate from corresponding log/block to planks (bamboo differs from most woods). Recipes are not server-confirmed, so the plan does not declare craftability or automatically craft.
- Track *nearby* server block updates as observations only; they are never interpreted as proof the bot placed a block.
- New shelter/crafting plan replaces prior route/resource preview, respects critical survival hold, blocks unrelated diagnostic movement, and cancels on Stay/Stop, disconnect, or dimension change.
- Android shows plan type, material quantities, missing inventory, hypothetical logs and observed changed-block count with controls prominently labeled **plan only**.

## Verification gates before any actual gameplay action

1. Pinned Bedrock protocol codec and 20 Hz PlayerAuthInput verified with the host, including server corrections and a neutral stop.
2. Decode loaded voxel state and check target block identity, walkability, hazards, permission, support and reach.
3. Implement protocol-correct block-breaking/placement/item-use/crafting calls with acknowledgements and idempotent/retry-safe state. Do not use addon-only Minecraft Script API privileges.
4. Correlate a specific bot-initiated action with server block or inventory changes before claiming completion.
5. Keep one movement/action authority and preserve emergency stop and survival holds.
6. Run synthetic and packaged Android tests on every integration layer; schedule a consolidated device test rather than requesting a new install for each PR.

## Stacked PR dependencies

Layer 5 PR #94 -> Layer 4 PR #93 -> Layer 3 PR #92 -> Layer 2 PR #91 -> Layer 1 PR #90 -> gameplay bridge PR #89 -> main.

**Status terminology:** Code integrated and CI passing means *tested planning/observation modules*, not verified autonomous survival, real crafting, block placement or a release-ready Android build. Each stacked PR remains a draft until its compatibility and physical gameplay gates are met.
