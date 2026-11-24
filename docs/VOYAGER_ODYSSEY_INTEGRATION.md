# Voyager + ODYSSEY integration in MinePilot

## Integration approach

MinePilot adopts the useful learning architecture from Voyager and ODYSSEY, but keeps its existing Android-packaged Minecraft Bedrock runtime.

The upstream projects are built around Mineflayer/Java Edition interfaces. Importing their runtime would create a second Minecraft client and would not make their actions compatible with Bedrock. MinePilot therefore ports the concepts and routes every executable task through the existing Bedrock gameplay bridge.

Research references: [Voyager source](https://github.com/MineDojo/Voyager) · [Voyager paper](https://arxiv.org/abs/2305.16291) · [ODYSSEY source](https://github.com/zju-vipa/odyssey) · [ODYSSEY paper](https://ijcai.org/proceedings/2025/22).

## Architecture now present

| Research idea | MinePilot implementation |
| --- | --- |
| Voyager automatic curriculum | BedrockOpenWorldLearningEngine.curriculum() recommends the highest-priority task whose world and capability prerequisites are currently satisfied. |
| ODYSSEY primitive skills | A small allow-listed catalog of observation, safety, verification and existing Bedrock-goal primitives. |
| ODYSSEY compositional skills | Bounded compositions for survival patrol, safe exploration, return home, player escort and observed-drop retrieval. |
| Planner | buildPlan() checks world readiness, capability state, target selection and safety before a task can start. |
| Actor | start() invokes the existing BedrockGameplayAgent; it does not introduce a parallel movement implementation. |
| Critic | critic() evaluates final outcomes using server-confirmed movement or item/inventory evidence. |
| Voyager skill memory | Bounded persistent skill proposals, run records, verified counters and mastery status are saved beside the session command file. |
| Failure feedback | Recent run reasons are retained with deterministic improvement hints; unsafe or stale states stop or reject execution. |

The Android World screen displays the recommended task, current run state, mastered-skill count and server-verified navigation progress. Starting a task requires an explicit confirmation. The Stop learning task control cancels the learning actor without disconnecting the Minecraft session. The same screen also offers a one-time confirmed **Enable local autopilot** control. Once enabled, a deterministic local scheduler runs eligible built-in tasks in priority order, advances to the next task after a server-verified terminal result, and stops when the built-in curriculum is exhausted or blocked. It does not call an LLM, cloud endpoint or Kaggle worker. Stop local autopilot immediately cancels its current task without disconnecting Minecraft.

## Current composite tasks

| Task ID | Existing Bedrock goal | Verification |
| --- | --- | --- |
| survival_patrol | survive | At least three server-verified steps before the bounded run ends |
| safe_exploration | explore | At least three server-verified steps before the bounded run ends |
| return_home | return_home | Existing Bedrock agent reports target_reached |
| escort_selected_player | follow | A selected target is reached according to the existing agent |
| retrieve_selected_drop | gather | Server-observed inventory increase confirms pickup |

Follow requires a previously selected player. Return requires a marked home in the same dimension. Drop retrieval requires a selected, observed item and known inventory baseline. Exploration and survival navigation require fresh server position, decoded/collision-classified terrain and the existing experimental movement capability.

## Verified learning, not invented abilities

A successful run is recorded only from the existing Bedrock agent's terminal state and verified counters. Queued input or an LLM's statement that a task succeeded is not sufficient.

A task is marked mastered after at least three verified successful runs across at least two runtime sessions. The mastery record means MinePilot has repeatedly verified that existing task procedure; it does not mean the bot has acquired a new Bedrock action or trained new model weights.

Proposed skills are declarative sequences of allow-listed primitive IDs. Invalid steps, multiple goal actions, executable snippets, shell commands and raw packets are rejected. Generated JavaScript is never evaluated. This keeps future model-generated skill proposals reviewable and non-executable.

Existing pre-integration Voyager skill records are retained in a bounded, sanitized legacy section when the learning store migrates to the new format. They are not silently promoted into the new skill catalog.

## Android IPC

The debug Android session provider accepts these commands through the existing single-command gameplay inbox:

- learning_start: requires confirmed=true and a known task ID, for example safe_exploration.
- learning_stop: cancels the active learning task; it does not disconnect the Bedrock client.
- learning_propose: requires confirmed=true and a JSON declarative skill proposal. The core validates the proposal against the primitive allowlist.
- learning_autopilot_start: requires confirmed=true once per enable. The local scheduler selects only built-in, reviewed compositions and never runs model proposals.
- learning_autopilot_stop: disables the scheduler and cancels its active learning task without disconnecting the Bedrock client.

Example learning_start payload:
{"version":"minepilot.gameplay.v1","requestId":"learn_001","action":"learning_start","taskId":"safe_exploration","confirmed":true}

The Android provider forwards only validated, bounded fields. The Node bridge still performs its own command/action validation and all gameplay execution remains subject to the pre-existing server freshness, movement, terrain, dimension, survival and cancellation gates.

## Current limits

This integration is a complete first Bedrock-native learning loop over the actions that MinePilot already has. It is not a full reproduction of the research agents and it does not make unsupported game actions suddenly executable.

At this point MinePilot's current executable gameplay agent can perform bounded verified navigation for survival patrol, exploration, following a selected player, returning to a marked home, and approaching/collecting an observed drop when the Bedrock inventory evidence supports it. It does not yet autonomously fight, eat, mine, craft, place building blocks, operate redstone, breed animals or complete Nether/End progression.

The default mode recommends tasks and waits for the player to confirm each run. The optional local autopilot can sequence only the built-in tasks after one explicit enable; it does not invent skills or add unsupported actions. The learning core is not yet connected to a remote LLM/model provider, Kaggle worker or an automatic model-driven planner. learning_propose is a validated intake API, not evidence that a model is currently generating skills. The current critic uses deterministic Bedrock outcome evidence, not a learned neural critic.

## Validation

The Node test suite scripts/bedrock-voyager-learning.test.cjs covers primitive/composite registration, safety preflight, curriculum prioritization, confirmation, actor execution, critic outcomes, interruption, declarative proposal validation, persistence/migration and verified-counter tracking.

The Android SDK staging script includes the new module and the focused tests. A passing CI run and a real Bedrock private-world test are still required before this integration can be called device-verified.
