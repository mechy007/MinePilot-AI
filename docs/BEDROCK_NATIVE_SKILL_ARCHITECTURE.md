# MinePilot Bedrock-native skill architecture

## Scope

MinePilot targets Minecraft Bedrock Edition (including MCPE). Its executable skill runtime must use Bedrock protocol observations and Bedrock-safe action contracts. Java Edition/Mineflayer skill implementations are not runtime dependencies.

This design is informed by the user's reference, *MCPE AI Skill Sets and Toolsets* (three pages). That reference distinguishes three different things which must not be mixed into one skill count:

1. **Agent knowledge bundles** (`SKILL.md`): operational knowledge such as Bedrock add-on development, BDS administration, bot QA, cross-play operations, resource-pack conversion and Bedrock JSON UI.
2. **Live world tools**: an MCP/bridge surface that can inspect or manipulate a Bedrock world through Bedrock Script API or a server-side bridge.
3. **Autonomous player abilities**: gathering, crafting, building, combat and pathfinding that need real action executors and outcome verification.

A documentation skill is not an in-game ability. An MCP tool definition is not proof that its action works in the user's current world.

## Execution architecture

### Layer A — Bedrock protocol runtime (required)

- Authenticates and maintains the player's Bedrock session.
- Observes server-authoritative player position, dimension, inventory, entities, chunks and block updates where the protocol exposes them.
- Executes only bounded actions supported by the current protocol/runtime implementation.
- Requires fresh server evidence for action completion.
- Works without a behavior pack, subject to protocol visibility and server restrictions.

### Layer B — optional Bedrock Script API companion

The reference describes a hybrid approach: use `bedrock-protocol` for player presence and session handling, and a Bedrock behavior-pack companion using Script API for complex world queries, batch placement and read-back verification.

MinePilot may add this as an **optional capability provider**, not a mandatory dependency. It is available only in worlds where the user can install/enable the companion pack and the relevant Script API permissions are granted. It must not be assumed available on featured servers, Realms or worlds where packs cannot be installed. When absent, the runtime must fall back to protocol-only capabilities and report unsupported actions honestly.

### Layer C — tool/MCP gateway (future extension)

MCP may expose validated tools to an AI planner, but every call must route through the same Bedrock capability checks, permission gates, rate limits, confirmation policy and postcondition verifier as native app commands. MCP is a transport/interface, not a bypass around safety or world evidence.

## Skill contract

Every executable Bedrock skill must declare:

- stable ID, name, description and Bedrock edition/platform scope;
- required observations and capabilities;
- execution provider: protocol, optional Script API companion, or both;
- parameters with strict bounds and validation;
- required user confirmation / permission;
- preconditions and cancellation conditions;
- action sequence with bounded time/step budgets;
- authoritative success postconditions and failure reasons;
- evidence record for the world changes or server acknowledgements;
- tests for available, blocked, stale, interrupted and failed execution.

Skill states must be explicit: `ready`, `experimental`, `manual_experimental`, `blocked`, or `unsupported`. Never count metadata-only, knowledge-only or planned skills as executable.

## Current implementation milestone

The first native catalogue is `scripts/bedrock-native-skill-system.cjs`. It is deliberately separate from the legacy ODYSSEY metadata catalogue and contains only MinePilot-owned Bedrock skill contracts.

Initial capabilities represented:
- inspect world;
- inspect inventory;
- safe exploration;
- survival patrol;
- follow a selected player;
- return to marked home;
- retrieve an observed item drop;
- experimental hotbar tool selection;
- experimental single-block mining;
- experimental single-block placement for operator-enabled Bedrock worlds.

The current task executor can start only the existing MinePilot Bedrock learning compositions. Experimental one-off actions remain on their dedicated guarded action paths and are not silently routed through composite tasks.

Multi-block building, crafting, eating, combat, farming, cooking/smelting, animal interaction, fishing and redstone remain roadmap entries until their Bedrock action transactions and server-confirmed outcome checks exist. The first building increment is deliberately narrower: `place_single_block` emits only a validated Bedrock `command_request` for `setblock ... keep`, requires `enable_commands` plus operator permission, only targets a recently observed air cell within six blocks, and completes only after a positive `command_output` acknowledgement and a matching server `update_block`. It is experimental, one block per request, and unavailable on worlds where the connected player lacks operator commands.

## Source alignment

The supplied reference names `AIKUSAN/minecraft-agent-skills-bundle` and `MCBE-UI/mcbejsonuimasterAI` as agent knowledge bundles; `chapmanjw/minecraft-bedrock-mcp-server` and `Mming-Lab/minecraft-bedrock-mcp-server` as Bedrock live-world bridge approaches; and suggests either porting high-level skill schemas to `bedrock-protocol` or using a protocol + Script API hybrid. MinePilot adopts the protocol-first design now and keeps Script API/MCP as optional future providers. This document records the architecture choice; it does not claim those upstream repositories have been integrated.

## Non-goals

- No Java Edition runtime or Mineflayer execution dependency.
- No pretending that an upstream Java skill becomes Bedrock-compatible through renaming.
- No arbitrary code execution from AI-generated skill proposals.
- No completed state without fresh Bedrock server evidence.
- No dependency on a behavior pack for ordinary protocol-based play.


## Adopted Bedrock QA skill

`.agents/skills/minecraft-bedrock-qa/SKILL.md` is an original MinePilot-oriented adaptation of the MIT-licensed AIKUSAN Bedrock bot QA skill. It supplies protocol-version checks, deterministic contract and mock-session tests, live-world evidence requirements, Android runtime packaging checks, and safeguards against treating metadata or model review as proof of gameplay execution.
