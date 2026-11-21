# CraftMind-inspired standalone gameplay planning

MinePilot includes a self-contained, Java 17 compatible gameplay intent validator inspired by CraftMind's versioned, allowlisted tool proposals. This is a clean-room adaptation of the design rather than a runtime dependency or source-code copy.

- Contract: `minepilot.gameplay.v1`.
- Allowlisted actions: follow, come, protect, mine, gather, craft, build, explore, return.
- Target values are limited to 64 ASCII letters, numbers, spaces, underscores or hyphens.
- Unknown versions, unknown actions and unsafe targets are rejected.
- Mine, build, craft and protect are marked for user confirmation when an execution engine is added.
- A validated plan is **not** a completed Minecraft action. No Bedrock session, world state, inventory or entity tracking is implied.
- This module does not connect to CraftNode or CraftMind Studio, and contains no authentication code.
- Unit tests cover allowlists, versioning, input rejection and confirmation flags.

Future work: attach a Bedrock-session capability provider and authoritative world-state checks; require confirmation before disruptive actions, execute through a constrained action dispatcher, and verify actual world outcomes before reporting success.
