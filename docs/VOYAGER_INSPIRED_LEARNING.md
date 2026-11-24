# Voyager-inspired learning in MinePilot

## Scope

MinePilot uses a Bedrock-native adaptation of Voyager's learning ideas. It does not embed or run the original MineDojo/Voyager runtime.

The original Voyager repository targets Java Edition, Mineflayer, Fabric and a Python/Node.js desktop environment. MinePilot's live runtime is an Android-packaged Bedrock client. Replacing that runtime with Voyager would break the Bedrock connection architecture and would not provide Bedrock compatibility.

## First integration milestone

The existing Bedrock gameplay bridge already publishes a capability manifest. This milestone extends that manifest with a Voyager-inspired learning core:

- A deterministic curriculum selector recommends a next task only when its required capability is currently available.
- A persistent, bounded skill registry stores declarative, verified skill records.
- Verified server movement progress is tracked separately from queued or attempted movement.
- The Android runtime validation script runs focused tests for skill validation, curriculum selection and persistence.
- Skill records accept only allow-listed action identifiers. They cannot contain generated JavaScript, shell commands or raw packet instructions.

The skill store is written beside the gameplay command file as `<commandPath>.voyager-learning.json`. If no command path is configured, learning memory remains session-only.

## Safety boundaries

This milestone does **not** generate or execute model-written code. It does not enable automatic mining, combat, crafting, block placement, or unbounded autonomous exploration. Existing gameplay permissions, movement checks, terrain validation and server-confirmed progress remain authoritative.

The curriculum is currently a recommendation layer. It does not independently start tasks. Skill promotion is an explicit validated operation; a skill is not promoted merely because an LLM claims success.

## What remains for later milestones

1. Wire the curriculum into the remote model planner and task dependency graph.
2. Add sandboxed skill trials with repeatable Bedrock fixtures and explicit execution budgets.
3. Add goal-level success criteria and multi-session validation before promotion.
4. Add skill retrieval/composition and cross-world compatibility checks.
5. Add Android controls for learning status, pause/resume, skill review and deletion.
6. Benchmark Guardian, Architect and general gameplay tasks in real Bedrock worlds.

## Upstream reference

- [MineDojo/Voyager](https://github.com/MineDojo/Voyager) — MIT-licensed research implementation.
- [Voyager paper](https://arxiv.org/abs/2305.16291) — automatic curriculum, executable skill library and iterative feedback/self-verification.

The upstream implementation is a research reference, not a drop-in Bedrock dependency.
