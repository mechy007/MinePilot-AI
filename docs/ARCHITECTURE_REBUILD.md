# MinePilot Architecture Rebuild

**Status:** active rebuild specification  
**Canonical target:** Android ARM64 + Minecraft Bedrock + the existing Xbox/NetherNet friend-world session  
**Rule:** no component may report an action as successful until the Bedrock server has supplied the evidence required by that action.

This document is the architecture contract for consolidating the existing implementation. It is not a claim that every planned subsystem is already implemented or live-tested.

## 1. Product boundary and source of truth

MinePilot is an Android-hosted Bedrock player using a dedicated Microsoft/Xbox identity. It joins a permitted friend's Bedrock world through the existing Xbox discovery, NetherNet/WebRTC and Bedrock protocol path. It must not open a second Minecraft client or silently operate the user's own account.

The canonical production execution path in this repository is currently:

- Android launcher/dashboard: `DashboardActivity`.
- Credential store and private credential pipe: `BotAccount`, `BotSessionProvider`.
- Runtime supervisor and Node process: `XboxSignInService`, `NodeSmokeActivity`.
- Friend-world/session workflow: `scripts/android-friend-world-session.cjs`.
- Same-client gameplay protocol adapter: `scripts/bedrock-gameplay-bridge.cjs`.
- Gameplay observations, action gates, task engine and server verification: the Bedrock runtime modules under `scripts/`.

The TypeScript tree under `src/` and `integration/addon-autonomy/` currently contain transport-independent engine/prototype work. They are **not automatically part of the packaged Android gameplay path**. They must not be represented as runtime features until a tested adapter connects them to the same authenticated Bedrock client. `BedrockEngine.Unavailable`, `MainActivity` and `MinePilotService` are diagnostic/fallback scaffolding, not the actual friend-world engine.

## 2. Runtime boundaries and data flow

```text
DashboardActivity
  ├─ BotAccount (Keystore-encrypted bot account)
  └─ WorldSessionProvider (private, session-ID-scoped IPC)
       └─ XboxSignInService (foreground lifecycle / Node supervisor)
            └─ packaged Node ARM64 + Bedrock SDK
                 └─ android-friend-world-session.cjs
                      └─ one authenticated Bedrock client
                           ├─ BedrockGameplayBridge (protocol adapter + event mirror)
                           ├─ observation models (life, terrain, inventory, players)
                           ├─ capability registry (fresh evidence + executor availability)
                           ├─ planner / bounded task scheduler
                           ├─ action executors (one operation at a time)
                           └─ server-verification critic + bounded memory
```

The Android provider's `accepted=true` means the command was safely queued. It does **not** mean the Node runtime dispatched it, the server accepted it, or the desired world state changed. The runtime receipt and later server observation are the only completion evidence.

The Node bridge owns a single command inbox and receipt. Commands are size-bounded, whitelisted, session-scoped and processed serially. Session shutdown cancels active work, closes pending stack requests, stops movement, removes packet listeners and clears per-session observations.

## 3. Required subsystem contracts

All subsystem APIs below are target contracts. Names may be adapted to existing modules during migration, but ownership and semantics must remain explicit.

### 3.1 Android application and account

**Responsibilities:** render UI, collect explicit user intent, preserve screen state, display actual runtime status, protect the bot identity and request lifecycle-safe service operations.

- `BotAccount.save(context, account)`: validate identity/token fields, encrypt with Android Keystore AES-GCM and atomically persist.
- `BotAccount.read(context)`: authenticate/decrypt the stored record; fail closed if corrupted or key is unavailable.
- `BotAccount.forget(context)`: delete encrypted account data and the associated Keystore key.
- `BotSessionProvider.openFile(uri, mode)`: expose only the short-lived refresh credential through the private pipe.
- `WorldSessionProvider.call(method, sessionId, extras)`: validate active session identity and route only allowlisted commands/status requests.
- `DashboardActivity.requestGameplay(...)`: submit a typed intent and display queue receipt separately from runtime result.
- `DashboardActivity.showWorldStatus(bundle)`: render sanitized connection, survival, skill, task and diagnostic state; never infer success from a queued command.

No access token, refresh token, raw chat, or unfiltered server payload may be returned to the dashboard.

### 3.2 Runtime supervisor and session controller

**Responsibilities:** start the packaged ARM64 runtime, stage the exact SDK bundle, supply credentials privately, publish status, observe cancellation, stop children and clean temporary files.

Target contract:

| Function | Input | Output / side effect |
|---|---|---|
| `startSession(config, signal)` | owner identity, host, runtime options, cancellation signal | authenticated session attempt and typed status |
| `stopSession(sessionId, reason)` | active session ID and reason | idempotent cancellation and cleanup |
| `getSessionStatus(sessionId)` | active session ID | sanitized lifecycle snapshot |
| `publishStatus(snapshot)` | validated session snapshot | atomic status-file update |
| `recoverSession(failure)` | typed retryable failure | at most one bounded retry after cleanup |

The existing `run(...)` and `observeSession(...)` functions in `scripts/android-friend-world-session.cjs` are the current implementation boundary. `observeSession` owns event listeners, the 1-second status heartbeat, join timeout and bridge cleanup. It must always remove listeners and close the same client exactly once.

### 3.3 Bedrock protocol adapter

**Responsibilities:** own the one SDK client, translate packet events into normalized observations, issue only protocol-supported writes and expose negotiated protocol capabilities.

Current adapter: `BedrockGameplayBridge`.

| Function | Contract |
|---|---|
| `start()` | bind a known set of packet handlers once; start private IPC polling only when command and receipt paths exist |
| `bind(event, handler)` | register one removable event subscription and retain its exact callback |
| `startGame(packet)` | reset world-scoped models and derive self identity, dimension, position and negotiated transaction/movement capabilities |
| `move(packet)` / `correction(packet)` | update position only from authenticated server packets/corrections |
| `attributes(packet)` / `observeHealth(value)` | accept only the local player's bounded vitals |
| `onRespawn(packet)` / `onSpawn()` | advance the respawn/loading handshake only for the local player and valid server state |
| `execute(command)` | validate schema, session, confirmation, preconditions and action ownership before dispatch |
| `poll()` | explicitly tick learning once, process at most one inbox command, write a bounded receipt |
| `snapshot()` | return sanitized current state; no gameplay action or learning transition is allowed |
| `stop()` | idempotently cancel executors, stop input, close transactions, remove listeners and clear session data |

No planner or Android UI may write raw Bedrock packets directly.

### 3.4 Observation and freshness models

Every observation must retain **value, source, dimension/session, observation time and freshness**. Unknown is not zero, empty or safe.

Target interfaces:

- `consumePacket(packet)`: validate and route a known packet to its model.
- `getSnapshot()`: return a deep, bounded observation snapshot.
- `getFreshness(field, now)`: return `fresh`, `stale`, `unknown` or `invalid` with age.
- `reset(sessionOrDimension)`: discard data that cannot safely cross a session or dimension boundary.

Required models: vitals/life, player and entity observations, dimension and position, decoded terrain/collision, block updates, item registry, full inventory snapshots, incremental inventory slots, selected hotbar/equipment, dropped items and world memory.

Inventory must distinguish unknown inventory from known-empty inventory. A slot update must not make the whole container fresh. Full inventory content snapshots establish the container baseline; stack IDs/network IDs are trusted only when observed and negotiated.

### 3.5 Capability registry

The capability registry is evidence-based, not a list of aspirations.

Target contract:

- `evaluate(worldSnapshot, executors, now)`: derive current state for each capability.
- `canExecute(capability, context)`: return a structured allow/deny result with evidence and blockers.
- `explainBlocked(capability)`: stable user-readable blocker code and prerequisite.
- `snapshot()`: expose bounded capability states for UI/diagnostics.

Capability states must remain distinct: `ready`, `experimental`, `manual_experimental`, `preview_only`, `protocol_only`, `partial`, `blocked`, `unsupported`. A caller-provided flag must never promote an unsupported handler. Experimental/manual actions require their own consent and runtime preflight.

### 3.6 Planner, Autopilot and task lifecycle

**Planner** chooses an objective; **Autopilot** owns the lifecycle; **executor** performs one bounded action; **critic** decides whether evidence satisfies the objective. These are not interchangeable.

Target contracts:

- `plan(observation, goal)`: create a bounded, declarative plan from fresh observations.
- `rank(candidates, safety, userGoal)`: prioritize survival, explicit user goals, then safe useful work.
- `preflight(task, observation, capabilities)`: produce allow/deny plus every blocking prerequisite.
- `enable(options)`: require explicit user confirmation; enter running or waiting state.
- `tick(observation)`: progress at one explicit runtime cadence; never run as a side effect of reading status.
- `pause(reason)` / `resume()`: preserve task state only when the world/session remains compatible.
- `stop(reason)`: idempotently stop only the work owned by this controller.
- `replan(reason)`: produce a new bounded plan after a verified state change or recoverable failure.
- `snapshot()`: read-only state including active task, waiting reason, blocked prerequisites and counters.

Autopilot states: `disabled`, `starting`, `running`, `waiting_for_eligible_local_task`, `paused_for_safety`, `recovering`, `completed`, `failed`. Lack of a currently eligible task is a waiting state, not proof of task failure. A session safety hold always takes priority over curriculum progression.

The current implementation has five local compositions: survival patrol, safe exploration, return home, escort selected player and retrieve selected drop. The new waiting behavior keeps a user-authorized controller armed while those tasks are blocked, then starts one only when a fresh capability evaluation satisfies all gates. It does not bypass terrain, movement, inventory, consent or server-verification requirements.

### 3.7 Action executors and transactions

Each action family owns its preconditions, packet contract, pending-operation state, timeout, cancellation, server response correlation and independent postcondition verification.

Required executor contract:

- `prepare(context)`: validate fresh observations, negotiated protocol features and user consent.
- `execute(plan, signal)`: issue one bounded operation and return a pending receipt.
- `awaitServerVerification(receipt, timeout)`: correlate authoritative response and later world/inventory evidence.
- `cancel(reason)`: stop pending work without reporting success.
- `recover(failure, observation)`: re-observe and decide whether retry is safe.

Action families are separate: navigation/input, hotbar selection, block breaking, item use/food, crafting, armor/equipment, block placement/building, combat, farming, animal interaction, containers, vehicles and resource harvesting. No generic “execute anything” packet writer is allowed.

Inventory actions must use the negotiated Bedrock stack-request protocol only when the server enabled it. A request response alone is not enough for a world objective; confirm the resulting slot/count/world change. If the connection uses a legacy/unknown transaction mode, actions that require modern stack requests remain blocked.

### 3.8 Critic, memory and skill registry

- `verify(task, before, after, receipt)`: compare the required postcondition with fresh server evidence.
- `record(result)`: persist a bounded outcome with session/dimension context.
- `promoteSkill(skill)`: allow only after repeated verified success across multiple sessions.
- `rejectSkill(skill, reason)`: retain the reason without promoting executable status.
- `listSkills(filters)`, `getSkill(id)`, `validateDependencies(id)`, `buildPlan(id)`: inspect a declarative skill and its dependency graph.
- `registerVerifiedExecutor(id, contract)`: available only for a reviewed, implemented, tested, protocol-backed action handler.

Generated plans are declarative data. Arbitrary model/upstream JavaScript execution is prohibited.

### 3.9 Diagnostics and telemetry

Every subsystem must expose a typed status, stable reason code, bounded counters and last transition time. Errors must be recorded; catch-and-ignore is not acceptable for control-plane operations. Logs must omit tokens, raw chat, private account data and unbounded packet contents.

## 4. Function ownership and lifecycle rules

1. **One owner per state machine.** The session controller owns connection lifecycle; the Bedrock bridge owns packet subscriptions; the Autopilot controller owns curriculum lifecycle; each executor owns its pending action.
2. **Read APIs are pure.** `snapshot`, `manifest`, UI refresh and diagnostics never start/stop tasks or send game packets.
3. **Ticks are explicit.** The session loop invokes one learning tick. Status heartbeats only read snapshots.
4. **No hidden retries.** Retry policy lives in the session controller or the relevant executor, is bounded, and records each attempt.
5. **No optimistic success.** Dispatch accepted, packet emitted, server response accepted and postcondition verified are different states.
6. **Freshness is mandatory.** Stale observations cannot authorize movement, transactions or survival claims.
7. **Safety wins.** Stop/cancel and survival emergency controls override ordinary goals. The user can always stop the bot.
8. **Session boundaries reset transient state.** Disconnect, new StartGame, dimension changes, death/respawn and identity changes invalidate incompatible pending operations/memory.
9. **Every async operation is cancellable.** Timeouts and close paths clear timers, subscriptions, file descriptors and pending promises.
10. **Fail closed.** Unknown packet shape, protocol version, item ID, inventory slot, identity or capability must be rejected with a diagnostic reason.

## 5. Current status and known gaps

- The full Node ARM64 runtime packaging workflow has a successful run after the previous respawn-test assertion correction; that is a CI packaging/test result, not a live Android world test.
- The zero-runtime-ID respawn test now compares position by value. Actual respawn recovery still requires live host/device verification.
- Autopilot previously disabled immediately when all built-in tasks were temporarily blocked. It now has an explicit waiting state, reports task blockers and advances only via an explicit runtime tick.
- Learning status reads were previously mutating because `gameplaySkillManifest` called `observe`. Status is now read-only; `tickLearningEngine` is the explicit state-transition entry point used by the bridge.
- The dashboard/provider now expose the autopilot wait reason and first blocker.
- The 183 ODYSSEY compositions are still dependency metadata, not 183 runnable Minecraft skills. Keep unimplemented families blocked.
- The current gameplay agent is bounded and experimental. It is not yet a full Minecraft-playing general agent.
- Android account/world flow, background reliability, actual respawn and each gameplay transaction still require real device/host verification.

## 6. Skill readiness policy for the 183 ODYSSEY compositions

A composition may be marked executable only when **every** referenced primitive has:

1. a real Bedrock-native executor and documented packet/SDK contract;
2. validated identity, freshness, capability and user-consent preconditions;
3. cancellation, timeout and recovery behavior;
4. server response correlation;
5. independent postcondition verification;
6. unit, negative, regression and integration tests;
7. compatibility evidence for the negotiated Bedrock protocol/transaction mode.

Until all seven gates pass, expose the composition as preview/blocked and tell the user exactly why. Do not promote skills by changing catalog flags.

## 7. Rebuild sequence and acceptance gates

| Stage | Work | Completion gate |
|---|---|---|
| A — Inventory and contracts | Map all Android, Node, TypeScript and add-on entry points; assign canonical ownership | no undocumented active entry point or duplicate state owner |
| B — Runtime lifecycle | Node process start/stop, IPC receipts, session recovery, cleanup | deterministic host tests and full ARM64 runtime CI |
| C — Observation foundation | per-field freshness, entity/vitals/terrain/inventory models | packet fixture tests; unknown never becomes empty/safe |
| D — Action foundation | one executor family at a time, starting with navigation and inventory | negotiated protocol + server receipt + independent postcondition tests |
| E — Autonomy | explicit tick, prioritized planner, task scheduler, waiting/recovery and emergency stop | deterministic state-machine tests and adversarial blocker tests |
| F — Skills | map each composition onto tested executor dependencies | every displayed readiness status matches actual executor coverage |
| G — Android product | structured UI/state handling, errors and accessible diagnostics | full APK install/launch/account/session/stop tests on target phone |
| H — Live validation | friend-hosted Bedrock world, death/respawn, movement, actions, screen lock, reconnect | host-observed evidence and recorded device diagnostics |

### Release acceptance

A full APK must include the ARM64 Node runtime and pinned Bedrock SDK bundle, pass APK native-library and 16 KB alignment checks, and pass Android unit tests. A live-play claim additionally needs a real device joining a permitted friend world, host-observed spawn, sustained session, verified action outcomes, and successful stop/reconnect. A CI artifact alone is never proof of live gameplay.
