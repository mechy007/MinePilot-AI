# ODYSSEY skill library integration

## What is integrated

MinePilot now carries metadata for all **183 ODYSSEY compositional skills**. The upstream files are converted into a Bedrock-neutral catalog containing stable snake_case IDs, original names, descriptions, source paths, direct composition dependencies, primitive-call references and required capability families.

The upstream paper reports 40 primitive skills and 183 compositional skills. The repository inventory keeps three different source groups separate: 22 files under ODYSSEY's skill primitive folder, 10 control primitive files (excluding the helper), and 8 supporting comprehensive-library API modules. These file groups are not treated as interchangeable MinePilot actions.

## Runtime compatibility classification

MinePilot evaluates the complete recursive dependency closure for every skill against its live Bedrock capabilities. A definition is not considered available merely because it exists in the catalog.

| Status | Meaning |
| --- | --- |
| Ready | All declared prerequisites map to ready MinePilot capabilities. This still does not execute upstream code. |
| Partial | At least one required Bedrock capability or primitive mapping is partial/experimental, and none are blocked. |
| Manual | A required capability exists only behind explicit user confirmation. |
| Blocked | A prerequisite is missing, unsupported, preview-only, protocol-only or cyclic. |

Current mapping is strict:

- World observation and decoded spatial inspection use MinePilot's authenticated Bedrock session and terrain data.
- Navigation maps only to MinePilot's existing bounded, server-verified experimental movement.
- Inventory reading is available only when a Bedrock inventory snapshot is known.
- Mining is at most manual/experimental: the current block controller is a bounded single-block action, requires confirmation, and cannot attribute a changed block to the agent with certainty.
- ODYSSEY resource harvesting is not equated with picking up an already-observed ground drop.
- Crafting, eating/item use, equipment transactions, combat, animal breeding, fishing, farming, cooking, smelting, shearing, container transfer, vehicle control and general block placement remain blocked until corresponding Bedrock-native executors and authoritative verification are implemented.

The summary is exposed under gameplaySkills.odysseyLibrary in the runtime snapshot. Android's World learning panel displays the 183-skill total and live ready/partial/manual/blocked counts. The new Bedrock primitive adapter also maps every distinct primitive referenced by the 183 compositions (20 names) to a MinePilot-owned Bedrock action contract. This is a compatibility/action-plan layer, not a claim that all handlers exist.

## Runtime APIs

The CommonJS module scripts/bedrock-odyssey-skill-library.cjs exports:

- listOdysseySkills({ family, query, status, limit, capabilities })
- evaluateOdysseySkill(skillId, capabilityStates)
- planOdysseySkill(skillId, capabilityStates)
- summarizeOdysseyLibrary(capabilityStates)
- validateOdysseyCatalog()

planOdysseySkill is a dependency-aware planning preview. It returns the ordered prerequisite IDs, required capabilities and a Bedrock primitive plan. The adapter lives in scripts/bedrock-odyssey-bedrock-adapter.cjs and maps the 20 referenced upstream primitive names to MinePilot-owned action names, capability requirements and execution modes. It deliberately refuses to mark unsupported handlers executable. The plan does not dispatch gameplay actions, run JavaScript, or call Mineflayer. Successful previews and rejected unknown-skill responses both return executable=false and arbitraryCodeExecution=false. Tests verify that every primitive reference in all 183 compositions has an explicit mapping and that unsupported actions remain blocked even if a caller incorrectly advertises the capability as ready.

## What is not imported

MinePilot does not bundle ODYSSEY's Mineflayer runtime, Node bot, Java Edition environment, Python orchestration, LLM backend, Chroma/HuggingFace embedding stack, checkpoint store, generated JavaScript executor, or Minecraft Q&A dataset/model weights. The 183 upstream executable code strings are intentionally excluded from the MinePilot catalog. This preserves the single existing Android Bedrock client and its server-authoritative action gates.

## Upstream attribution

Metadata was derived from zju-vipa/Odyssey, specifically Odyssey/skill_library/skill/skills.json and related skill source inventory. The upstream repository contains an MIT license (Copyright 2023 MineDojo Team). Original source paths are retained for traceability. No upstream executable skill source was copied into MinePilot.

Research: ODYSSEY paper, IJCAI 2025: https://ijcai.org/proceedings/2025/22

## Validation boundary

Automated tests validate catalog completeness, metadata safety, dependency integrity, recursive evaluation, the 20-name primitive mapping, conservative action status and the rule that planning never executes code. They do not prove that the 183 skills can run in a Bedrock world. The remaining implementation work is concrete Bedrock packet/action handlers plus transaction acknowledgements and world/inventory verification for each action family, followed by private-world/device testing. A skill is not complete until every primitive in its dependency closure has a tested Bedrock executor and authoritative success criteria.


## First live Bedrock primitive executors

The bridge now exposes a deliberately narrow, read-only command: `odyssey_observe`. It dispatches five primitives against the existing authenticated Bedrock session:

- `getLogsCount` and `getPlanksCount` read item totals from a recent server-delivered player inventory snapshot and a known item registry. Missing or stale inventory is rejected; it is never reported as zero.
- `checkBlockAbove` and `checkBlocksAround` read only decoded subchunk cells or explicit server block updates. Unknown/unloaded cells are omitted rather than inferred.
- `findSuitablePosition` searches a small bounded area and accepts only cells classified as walkable by the version-matched collision registry. Unknown cells are unsafe.

The Android gameplay IPC validates the primitive name, requires explicit confirmation, bounds optional coordinates, and returns a capped observation result to the caller. The executor also requires a live world, a fresh server position, and (for terrain primitives) decoded terrain plus a registry. It sends no Bedrock packets and performs no movement or interaction. Each successful result identifies its observation source and is marked `readOnly: true` and `executed: false`. The module and tests are staged into the Android Node runtime bundle.

These five primitives are now actual read-only observation operations; this does not make all 183 ODYSSEY compositions runnable. Bounded target navigation, bounded exploration and confirmed single-block mining now have dedicated Bedrock IPC dispatch paths; mining remains manual/experimental. Crafting, equipment, combat, cooking, smelting, animal interaction, placement, farming and other unsupported primitive families remain blocked.


## Confirmed Bedrock action primitives

The private Android gameplay IPC now has a separate confirmed execution action, `odyssey_execute`, for a narrow allowlist:

- `goto`: a user-supplied world position within 16 blocks; requires a decoded collision-safe route, bounded movement input, and later fresh server-position progress. The gameplay agent stops on stale state, corrections, missing route, or its existing run/time budgets.
- `exploreUntil`: starts the existing bounded exploration agent. It uses decoded walkable terrain and verifies each movement step from later server position updates. It does not import or execute upstream JavaScript conditions; it stops on its bounded budget or safety failure.
- `mineBlock`: starts the existing single-block Bedrock break controller only for a confirmed integer block coordinate within reach, a decoded solid/breakable block, active neutral player-input presence, and no competing movement. A changed server block is recorded as an observation with causality explicitly unverified, not proof that MinePilot mined it.

Android validates the primitive and coordinates before writing the single-command inbox. The bridge validates again and dispatches only the allowlisted executor. Crafting, cooking, smelting, equipment, combat, feeding/breeding, item placement, farming and other unsupported primitive families remain blocked. Primitive-level executors do not automatically make a composite skill runnable: dependency orchestration and verified postconditions are still required for each composition.


## Inventory transaction protocol negotiation

The Bedrock bridge now records the `enable_item_stack_net_manager` flag from the authenticated StartGame packet and exposes the negotiated mode as `server_authoritative`, `legacy`, or `unknown`. Missing fields remain unknown; the runtime does not guess which transaction protocol the host expects.

This is a prerequisite for the next inventory-action implementation stage, not an executor. Crafting, equipping, food use, bucket use, and container operations remain blocked. A future transaction controller must use the negotiated protocol, correlate each request with the server's response, and verify the resulting inventory/world state before reporting success.

Protocol references for the pinned Bedrock 1.26.60 / protocol 2225 schema:

- StartGame packet and its inventory-manager negotiation flag: https://mojang.github.io/bedrock-protocol-docs/1.26.60/packets/start-game-packet/
- Item stack request packet: https://mojang.github.io/bedrock-protocol-docs/1.26.60/packets/item-stack-request-packet/
- Item stack response packet: https://mojang.github.io/bedrock-protocol-docs/1.26.60/packets/item-stack-response-packet/


## Bounded tool selection

Four equipment primitives (`equipAxe`, `equipHoe`, `equipPickaxe`, `equipSword`) now have a deliberately narrow implementation: they select a matching tool only when it is already present in the nine-slot hotbar. The hotbar is derived from a complete server inventory snapshot plus subsequent server inventory-slot updates. MinePilot sends the Bedrock `player_hotbar` selection packet and does not report success until a self `mob_equipment` update confirms both the selected slot and the expected item network ID. Missing/stale inventory, absent tools, packet errors, and missing server confirmation fail closed.

This does not move tools from main inventory, equip armor, or make a full equipment skill executable. The separate `equip_items` capability remains hard-blocked; only `hotbar_selection` is experimental. Skill compositions that require additional unsupported capabilities remain blocked.
