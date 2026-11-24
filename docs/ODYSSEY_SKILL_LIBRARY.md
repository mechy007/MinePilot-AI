# ODYSSEY skill library integration

## What is integrated

MinePilot now carries metadata for all **183 ODYSSEY compositional skills**. The upstream files are converted into a Bedrock-neutral catalog containing stable snake_case IDs, original names, descriptions, source paths, direct composition dependencies, primitive-call references and required capability families.

The upstream paper reports 40 primitive skills and 183 compositional skills. The repository inventory keeps three different source groups separate: 22 files under ODYSSEY's skill primitive folder, 10 control primitive files (excluding the helper), and 8 supporting comprehensive-library API modules. These file groups are not treated as interchangeable MinePilot actions.

## Runtime compatibility classification

MinePilot evaluates the complete recursive dependency closure for every skill against its live Bedrock capabilities. A definition is not considered available merely because it exists in the catalog.

| Status | Meaning |
| --- | --- |
| Ready | All declared prerequisites map to ready MinePilot capabilities. This still does not execute upstream code. |
| Partial | At least one required Bedrock capability is experimental, and none are unavailable. |
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

planOdysseySkill is a dependency-aware planning preview. It returns the ordered prerequisite IDs, required capabilities and a Bedrock primitive plan. The adapter lives in scripts/bedrock-odyssey-bedrock-adapter.cjs and maps the 20 referenced upstream primitive names to MinePilot-owned action names, capability requirements and execution modes. It deliberately refuses to mark unsupported handlers executable. The plan does not dispatch gameplay actions, run JavaScript, or call Mineflayer. Every result has executable=false and arbitraryCodeExecution=false. Tests verify that every primitive reference in all 183 compositions has an explicit mapping and that unsupported actions remain blocked even if a caller incorrectly advertises the capability as ready.

## What is not imported

MinePilot does not bundle ODYSSEY's Mineflayer runtime, Node bot, Java Edition environment, Python orchestration, LLM backend, Chroma/HuggingFace embedding stack, checkpoint store, generated JavaScript executor, or Minecraft Q&A dataset/model weights. The 183 upstream executable code strings are intentionally excluded from the MinePilot catalog. This preserves the single existing Android Bedrock client and its server-authoritative action gates.

## Upstream attribution

Metadata was derived from zju-vipa/Odyssey, specifically Odyssey/skill_library/skill/skills.json and related skill source inventory. The upstream repository contains an MIT license (Copyright 2023 MineDojo Team). Original source paths are retained for traceability. No upstream executable skill source was copied into MinePilot.

Research: ODYSSEY paper, IJCAI 2025: https://ijcai.org/proceedings/2025/22

## Validation boundary

Automated tests validate catalog completeness, metadata safety, dependency integrity, recursive evaluation, the 20-name primitive mapping, conservative action status and the rule that planning never executes code. They do not prove that the 183 skills can run in a Bedrock world. The remaining implementation work is concrete Bedrock packet/action handlers plus transaction acknowledgements and world/inventory verification for each action family, followed by private-world/device testing. A skill is not complete until every primitive in its dependency closure has a tested Bedrock executor and authoritative success criteria.
