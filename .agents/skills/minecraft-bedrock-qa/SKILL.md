---
name: minecraft-bedrock-qa
description: Test MinePilot's Minecraft Bedrock/MCPE protocol runtime, skill actions, server evidence and Android Node packaging. Use when changing packet handling, gameplay transactions, inventory, terrain, movement or skill execution.
---

# Minecraft Bedrock QA

Use this skill whenever changing MinePilot's Bedrock protocol runtime or an executable Bedrock skill.

## Compatibility boundary

- Target Bedrock Edition / MCPE only. Do not import Mineflayer, Java Edition packet assumptions, Fabric APIs or Java command syntax.
- Check the exact Bedrock protocol version pinned by the project and its matching minecraft-data schema before creating or changing a packet.
- Treat Bedrock retail, Education Edition, Dedicated Server, Geyser and Realms as separate environments. A feature tested in one is not automatically supported in another.
- Prefer the existing Bedrock client, inventory ledger, terrain cache and capability gates. Do not add a second Xbox login or parallel game session for a skill.

## Required test layers

1. **Pure contract tests:** validate inputs, coordinates, block/item identifiers, limits, capability gates, confirmation and cancellation.
2. **Packet contract tests:** serialize outbound packets with the project's pinned Bedrock protocol schema; assert packet names and critical fields.
3. **Mock-session tests:** exercise accepted, rejected, stale, timeout, disconnect and server-correction paths with a deterministic fake client.
4. **Live-world probe:** only claim a skill works in a real world after a private test world confirms server acknowledgement and the authoritative postcondition.
5. **Android packaging smoke:** ensure the entrypoint, dependencies and tests are included in the staged Node runtime ZIP; reject unexpected native modules.

A successful command dispatch is not a successful gameplay action. Record server acknowledgement separately from world/inventory evidence. A failed assertion must remain a failure; optional model-based review may explain a failure but must never turn it into a pass.

## Protocol and gameplay safety

- Keep action loops bounded and cancel them on death, dimension changes, disconnect, stale observations or explicit STOP.
- Use server-issued inventory/stack identifiers only when fresh; never synthesize an inventory stack ID.
- Keep movement/input cadence conservative and test it against the target transport. Geyser-specific timing workarounds must not be applied globally without a compatibility probe.
- Check interaction distance locally even when a server appears to accept an entity interaction.
- Never execute arbitrary model-generated JavaScript or arbitrary commands. Generate a small allowlisted packet/command from validated structured arguments.
- Destructive changes require explicit confirmation. Prefer non-destructive operations such as Bedrock setblock keep for the first placement capability.
- Do not place credentials, Xbox tokens, private server chat, account data or auth caches in fixtures, test logs or commits.

## Completion criteria

A skill is not READY because its metadata, planner or outbound packet exists. It needs:
- a live capability gate;
- strict parameter validation and an action/time budget;
- user confirmation where the world is changed;
- cancellation and timeout behavior;
- a server acknowledgement;
- a fresh, authoritative postcondition;
- tests for positive, negative, stale, interrupted and protocol-serialization cases.

## Source note

This project-local QA guidance is an original adaptation of the Bedrock bot QA approach in [AIKUSAN/minecraft-agent-skills-bundle](https://github.com/AIKUSAN/minecraft-agent-skills-bundle), MIT licensed. It does not copy or execute that repository's server-specific scripts.
