# MinePilot Function Contracts

This catalog assigns purpose and side-effect rules to the public functions in the current canonical Android/Bedrock path. It is deliberately descriptive: implementations may be split into smaller modules during the rebuild, but callers must retain the documented contract. Helper functions are included where they validate data crossing a trust boundary.

## 1. Canonical Android Bedrock runtime

### `scripts/android-friend-world-session.cjs`

| Function | Responsibility | Side effects / failure behavior |
|---|---|---|
| `androidNetworkInterfaces(readInterfaces, readAddresses)` | Normalize usable Android network interfaces/addresses for the transport. | Reads injected OS data only; ignores malformed addresses. |
| `validateOwner(ownerXuid, botXuid)` | Ensure the friend-world owner is not the bot account itself and identity shape is valid. | Throws/rejects invalid or self-owner selection. |
| `safeJoinFailure(error)` | Convert transport/auth failure into a sanitized stable result. | Must not include tokens or raw server/private messages. |
| `shouldRetry(result)` | Decide whether a single fresh join attempt is justified. | Never retries arbitrary/permanent failures or retries before cleanup. |
| `bedrockDisconnectCode(reason)` | Map a known SDK disconnect reason to the pinned Bedrock disconnect code. | Returns no invented code when mapping is unknown. |
| `observeSession(client, publish, signal, getStage, timeoutMs, gameplayOptions)` | Attach lifecycle listeners to the authenticated client, create the gameplay bridge, publish bounded snapshots and await spawn/disconnect/abort. | Owns listeners, heartbeat and timeout; always stops bridge, removes listeners and closes the same client once. |
| `run(options)` | Orchestrate Xbox verification, host resolution, friend-world join, optional one-time retry and final status. | Respects abort signal; saves identity only through injected secure callback. |

### `scripts/bedrock-gameplay-bridge.cjs`

| Function | Responsibility | Side effects / failure behavior |
|---|---|---|
| `atomicJson(file, obj)` | Atomically write bounded IPC/status JSON via a unique temporary file and rename. | Removes temporary file on failure; never leaves a partial receipt. |
| `constructor(client, options)` | Bind the bridge to the one authenticated SDK client and injected domain services. | Rejects clients lacking event subscription/removal. Does not open another connection. |
| `bind(event, callback)` | Register one exact event handler and retain it for cleanup. | Adds the callback to the removal list. |
| `start()` | Bind all supported Bedrock packet events and start the private IPC poller when configured. | Single-use; throws if started/used more than once. |
| `startGame(packet)` | Establish a new world generation: self ID, dimension, server position, movement/transaction negotiation and reset transient models including inventory stack identities. | Invalidates prior dimension/session state; stops old autonomy. |
| `modeName(mode)` | Normalize the pinned protocol's known game-mode representation. | Unknown values remain unknown. |
| `gameModeChange(packet)` | Update local/world game-mode evidence from supported server packets. | Never changes a player's game mode. |
| `observeHealth(health)` | Apply a validated local health observation and detect death/recovery transitions. | Stops unsafe motion on critical health/death. |
| `onRespawn(packet)` | Validate local runtime ID/state and emit only the required respawn handshake response. | Foreign IDs and invalid states are ignored; zero ID is accepted only as an unspecified ID in the documented server case. |
| `onSpawn()` | Complete the local spawn-loading gate once. | Sends only the established handshake packets; no automatic movement. |
| `authorityChange(packet)` | Update movement-authority evidence from the supported server packet. | Resets incompatible movement diagnostics. |
| `attributes(packet)` | Parse local-player health/hunger/max-health/air attributes. | Ignores foreign entity IDs, unknown attributes and non-finite values. |
| `gameplayWorld()` | Produce the narrow world context required by gameplay components. | Read-only; contains current position/dimension/spawn/safety. |
| `readinessInput()` | Produce timestamped protocol/terrain/movement prerequisites for the advanced readiness layer. | Read-only; stale position remains stale. |
| `advisorWorld()` | Produce sanitized context for optional advisor/reporting layers. | Read-only; no actions. |
| `playerList(packet)` | Update bounded sanitized UUID/name player directory. | Caps entries and validates text; no raw player payload is exposed. |
| `playerHotbar(packet)` | Track the server-selected local hotbar slot. | Rejects wrong window or malformed slot. |
| `equipment(packet)` | Confirm a server-observed equipment/hotbar change. | Resolves only matching pending selection. |
| `hotbarSelectionSnapshot()` | Describe selected/pending hotbar state and freshness. | Read-only. |
| `selectHotbarTool(primitive)` | Select an already-observed hotbar tool for a supported experimental primitive. | Does not search main inventory or equip armor; waits for server equipment confirmation. |
| `chunk(packet)` | Track bounded chunk-header receipt for status/terrain coordination. | A chunk header alone does not imply collision-ready terrain. |
| `move(packet)` | Apply a server-authenticated local player movement update. | Updates position and freshness only for the local entity. |
| `correction(packet)` | Apply a server correction and reset prediction/route state as needed. | Server correction wins over predicted movement. |
| `addPlayer(packet)` | Track a player actor using sanitized identity and position. | Enforces map bounds. |
| `removeActor(packet)` | Remove entity/player observations from bounded caches. | No action is inferred from removal. |
| `dimensionChange(packet)` | Apply a validated dimension transition. | Clears terrain, route, memory and incompatible pending work. |
| `updateAddonNavigation()` | Update the optional add-on-derived navigation observation. | Advisory/observation only; cannot bypass the native action gate. |
| `intelligenceTick()` | Run the deterministic local intelligence observer over current vitals, threat and world freshness. | State-changing decision tick; may stop unsafe active movement. Called only by the control loop or active gameplay agent. |
| `tickControlPlane()` | Refresh safety/intelligence and optional add-on navigation state once per explicit bridge poll. | Owns control-side mutations and records stable tick health. |
| `snapshot()` | Return the bounded state used by Android and logs, including compact server inventory status. | Pure read; never starts/finishes a task, updates navigation intents or sends a packet. |
| `execute(raw)` | Validate the command envelope, whitelist, consent, readiness, and action ownership, then dispatch one operation. | Returns typed receipt; dispatch is not verified success. |
| `tickLearning()` | Explicitly advance the one learning/autopilot state machine and record tick health. | Called by the runtime control loop; errors become a stable diagnostic state. |
| `poll()` | Tick the learning controller once and process at most one IPC command/receipt. | Runs on the private timer; errors are recorded, not silently swallowed. |
| `stop()` | Cancel and dispose every per-session subsystem. | Idempotent; clears timers, requests, event listeners, movement and caches. |

### `scripts/bedrock-inventory-ledger.cjs`

| Function | Responsibility | Side effects / failure behavior |
|---|---|---|
| `normalizeWindowId(value)` | Validate/normalize a protocol window ID, including the named player inventory window. | Unknown names and out-of-range IDs return `null`. |
| `normalizeContainer(value)` | Validate the Bedrock `FullContainerName` including optional dynamic container ID. | Rejects unknown container types and invalid dynamic IDs. |
| `normalizeItem(value)` | Normalize the Bedrock 1.26.60 `ItemV4` fields: item runtime ID, count, metadata, stack-ID presence/value and block runtime ID. | Drops NBT/user data; rejects malformed non-empty stacks; preserves known-empty slots. |
| `constructor(options)` | Initialize bounded per-session windows, registry, clock and freshness budget. | No packet writes or external resources. |
| `now()` | Read the injected clock. | Used for all observation timestamps. |
| `reset()` | Clear inventory windows and item registry for a new session generation. | Invalidates every old stack identity. |
| `observeItemRegistry(packet)` | Build a bounded runtime-item-ID to namespaced-name map. | Rejects malformed/oversized registries; never guesses names. |
| `observeContent(packet)` | Atomically replace one full inventory window/container snapshot. | Invalid packet leaves the prior snapshot untouched; unknown is distinct from known empty. |
| `observeSlot(packet)` | Apply one server-observed slot update to an already-known window/container. | Does not refresh the full-container timestamp; rejects ambiguous container-less updates. |
| `getSlot(address, options)` | Read one exact window/container/slot and return slot/full-snapshot freshness. | Pure read; no default stack ID is invented. |
| `playerInventory(options)` | Return the canonical player inventory slots, names, counts and freshness. | Pure read; returns unknown/stale distinctly. |
| `planPlayerInventorySwap(ledger, sourceSlot, destinationSlot, options)` | Build a reversible player-inventory swap plan from two fresh, occupied, server-identified slots. | Pure preflight only; returns `executable:false` until the asynchronous transaction executor and postcondition verifier are wired. |
| `planPlayerInventoryMove(ledger, sourceSlot, destinationSlot, count, options)` | Build a player-inventory `take` plan from a fresh occupied source into a fresh known-empty destination whose server-observed stack ID is exactly zero. | Pure preflight only; never invents the empty-slot stack ID and returns `executable:false` until dispatch and postcondition verification are wired. |
| `snapshot()` | Return compact bounded window metadata and the player inventory projection. | Does not expose item NBT or unbounded raw packet data. |

### `scripts/bedrock-stack-request-manager.cjs`

| Function | Responsibility | Side effects / failure behavior |
|---|---|---|
| `normalizeSlotInfo(info, label)` | Validate exact Bedrock stack-request slot/container addresses and observed stack IDs. | Missing stack identity must fail closed; never invent a zero stack ID. |
| `normalizeAction(action)` | Validate the supported stack action shape against the pinned 1.26.60 protocol. | Unsupported action types are rejected before any packet is queued. |
| `constructor(client, options)` | Bind one response listener and require negotiated server-authoritative mode. | Does not enable transactions when StartGame negotiation is absent. |
| `nextRequestId()` | Allocate a bounded request ID. | Avoids reusing an ID while a request is pending. |
| `send(actions, options)` | Send one bounded request and await its correlated response. | Single-flight; timeout, write error, server rejection and cancellation are explicit outcomes. |
| `receive(packet)` | Resolve only the response matching the pending request ID. | Unmatched responses cannot complete another request. |
| `snapshot()` | Report negotiation, pending request and last outcome. | Pure read. |
| `close(reason)` | Remove listeners and reject pending requests. | Idempotent cleanup. |

### `scripts/bedrock-movement-controller.cjs`

| Function | Responsibility |
|---|---|
| `constructor(client, options)` | Bind one shared 20 Hz Bedrock input queue, physics engine, terrain cache and movement telemetry. |
| `loadPhysics()` | Load the pinned Bedrock block-state collision registry and construct the physics world. |
| `startPresence(world)` | Start the input stream only for a spawned player with server authority and a valid server tick. |
| `capability(world)` | Report ready only when the session, authority, dimension, terrain registry and input stream are valid. |
| `preflightTerrain(world)` | Require observed collision data around the player; unknown cells fail closed. |
| `setControls(vector, options)` | Normalize analog strafe/forward input and retain jump, sprint and sneak state. |
| `runManualHold(world, options)` | Apply joystick or action-button input for a bounded hold interval. |
| `runVerifiedStep(world, target, ticks)` | Turn toward one target and execute a bounded physics-simulated navigation step. |
| `tick(tick)` | Simulate one Bedrock tick and emit position, velocity, view, movement vector and input flags. |
| `observeServerPosition(position, observedAt)` | Record authoritative position and clear unconfirmed movement. |
| `teleport(position, packet)` | Re-anchor the physics state after a server teleport. |
| `correct(position, tick, packet)` | Apply server correction and replay retained inputs when collision data is available. |
| `knockback(packet)` | Apply server-authoritative entity velocity. |
| `releaseManual()` | Send neutral controls without stopping the shared input queue. |
| `stop(reason)` | Release controls; stop the queue only for terminal session/death/authority reasons. |
| `resetSession()` | Tear down the queue and clear per-world physics state. |
| `snapshot()` | Expose capability, active hold, server acknowledgment, physics and collision telemetry. |

### `scripts/bedrock-collision-data.cjs`

| Function | Responsibility |
|---|---|
| `buildBedrockCollisionData(data, expectedStates)` | Build block-name, numeric-state and hashed-state collision indexes. |
| `loadBedrockCollisionData(directory)` | Load the pinned gzip datasets and validate their state count and shape data. |
### `scripts/bedrock-gameplay-agent.cjs`

| Function | Responsibility |
|---|---|
| `constructor(options)` | Inject monotonic clock, scheduler and bounded run options. |
| `readiness(world)` | Reject stale/unacknowledged position, unsupported authority, unclassified terrain, unavailable physics movement, wrong dimension or busy executor. |
| `start(world, options)` | Require explicit confirmation and a supported goal; initialize a bounded run and its interval. |
| `stop(reason)` | Cancel the run, movement and owned subgoal; preserve a terminal reason. |
| `pause(reason)` | Suspend progression without reporting success. |
| `noteFailure(reason)` | Count a bounded failure and stop after the configured maximum. |
| `recordCell(position)` | Store a bounded visited-cell marker for loop prevention. |
| `localTarget(world, threat)` | Choose a nearby candidate only from collision-classified terrain and a valid route. |
| `ignoreDrop(name)` | Prevent repeatedly attempting a drop that timed out or lacked inventory confirmation. |
| `opportunisticDrop(world, foodOnly)` | Select an observed eligible dropped item; does not imply pickup. |
| `survivalGoal(world)` | Manage the current survival subgoal using observed hunger, drops and inventory deltas. |
| `targetFromGoal(world)` | Resolve current objective into one locally verified waypoint or a typed pause reason. |
| `pulse()` | Run one bounded decision step; stop for stale state, death, dimension/session change, threat or run budget. |
| `snapshot()` | Return goal, phase, verified counters and last reason. |

The gameplay agent is an experimental bounded navigator/survival task runner. It does not currently implement autonomous combat, food use, crafting, mining at scale or construction.

### `scripts/bedrock-open-world-skills.cjs`

| Function | Responsibility |
|---|---|
| `safeProposal(input)` | Validate a declarative proposed skill; reject arbitrary executable/model code. |
| `capabilityState(manifest, name)` | Read the authoritative current capability state; unknown names default to blocked. |
| `taskPreflight(world, manifest, task)` | Return the first unmet prerequisite for a built-in task. |
| `improvementHint(reason)` | Convert known failure reasons into safe next-observation guidance. |
| `constructor(options)` | Initialize bounded store, counters, curriculum state and session ID. |
| `load()` | Load only schema-validated compatible records; ignore/cull invalid records. |
| `persist()` | Atomically persist bounded verified learning history. |
| `taskById(taskId)` | Resolve one built-in or reviewed declarative proposal. |
| `buildPlan(world, manifest, taskId)` | Build a prerequisite-ordered declarative plan; never execute code from the skill catalog. |
| `start(world, manifest, taskId, options)` | Require confirmation, ownership and successful preflight; start the existing Bedrock agent. |
| `enableAutopilot(world, manifest, options)` | Require explicit consent; start an eligible task or remain armed in a waiting state with blocker details. |
| `disableAutopilot(world, reason)` | Disable the controller and stop only its currently owned task. |
| `stop(world, reason)` | Stop the active learning task and record an interruption. |
| `propose(input)` | Save a validated declarative proposal for review; does not make it executable. |
| `updateCounters(world)` | Reconcile verified counters across agent resets without double-counting. |
| `critic(task, agent, run)` | Accept only the task-specific server-verified terminal evidence and minimum progress. |
| `recordRun(task, result, run)` | Store bounded success/failure/interruption history and update mastery statistics. |
| `observe(world, manifest)` | Advance task lifecycle from an explicit runtime tick; complete, verify, fail or choose the next task. |
| `curriculum(world, manifest)` | Rank currently eligible built-in tasks and return one recommendation. |
| `curriculumReadiness(world, manifest)` | Report remaining, eligible and blocked tasks with stable prerequisite reasons. |
| `snapshot(world, manifest)` | Pure read-only state for UI/diagnostics. |
| `catalog()` | Return immutable primitive/composition definitions and proposal schema. |

### `scripts/bedrock-skill-manifest.cjs`

- `evaluateCapabilities(world)`: compute current world and per-skill states from real freshness, terrain, inventory and executor readiness.
- `odysseyCapabilityStates(world, manifest)`: map upstream composition dependencies to MinePilot capability states; unsupported families stay unsupported.
- `learningEngineFor(world)`: return the single learning-engine instance owned by the current world object.
- `gameplaySkillManifest(world)`: return a read-only combined capability/ODYSSEY/learning snapshot.
- `tickLearningEngine(world)`: the only exported adapter for advancing the learning state machine.
- `startLearningTask(world, taskId, options)`: route a confirmed manual task request into the engine.
- `stopLearningTask(world, reason)`: stop the owned manual learning run.
- `startLocalAutopilot(world, options)`: enable the local curriculum after confirmation.
- `stopLocalAutopilot(world, reason)`: disable the local curriculum.
- `proposeLearningSkill(world, proposal)`: validate and store a declarative proposal.
- `evaluateOdysseySkill(...)`, `listOdysseySkills(...)`, `planOdysseySkill(...)`: query and preview upstream skill dependency metadata; no upstream JavaScript is executed.

### `scripts/bedrock-stack-request-manager.cjs`

| Function | Responsibility |
|---|---|
| `BedrockStackRequestError(message, details)` | Typed failure with request/correlation details. |
| `normalizeSlotInfo(info, label)` | Validate a Bedrock inventory slot address and network/stack identity. |
| `normalizeAction(action)` | Validate an allowlisted stack action shape and its required fields. |
| `constructor(client, options)` | Attach one response listener and enforce negotiated server-authoritative mode. |
| `nextRequestId()` | Allocate a valid bounded request ID. |
| `send(actions, options)` | Allow one outstanding server-authoritative request; await its correlated response with timeout/cancellation. |
| `receive(packet)` | Resolve only the matching request and reject server errors. |
| `snapshot()` | Report pending request and negotiated mode without mutating it. |
| `close(reason)` | Reject pending operations and remove response listener. |

### `scripts/bedrock-odyssey-bedrock-adapter.cjs` and `scripts/bedrock-odyssey-observation-executor.cjs`

- `evaluatePrimitive(name, capabilities)`: determine whether the primitive is read-only, executable, experimental or blocked from the current registry.
- `buildBedrockPrimitivePlan(skill, capabilities)`: produce an ordered declarative prerequisite/action plan; never dispatch by itself.
- `validatePrimitiveCoverage(catalog)`: ensure every upstream primitive referenced by all 183 compositions has an explicit adapter contract.
- `executeBedrockObservation(bridge, primitive, args)`: execute only a whitelisted read-only observation against the same authenticated world; never writes a gameplay action.

## 2. Android Java responsibilities

### `DashboardActivity`

- `show(tab)`: render the selected dashboard destination.
- `showCommandCenter(signedIn)`: compose world, gameplay and learning controls.
- `worldRequest(method, sessionId, extras)`: make a private provider call; catch provider lifecycle/security failures as unavailable.
- `refreshCommandCenter()`: asynchronously refresh one status snapshot and avoid stale-generation UI updates.
- `showWorldStatus(bundle)`: render sanitized status, task, Autopilot wait/blocker and ODYSSEY readiness.
- `requestGameplay(action, confirmed, ...)`: enqueue one allowlisted command and show queue status only.
- `toggleLocalAutopilot()`: require a visible user confirmation before enabling/stopping local Autopilot.
- `confirmLearningStart()`: confirm a selected bounded learning task.
- `requestWorldStop()`: stop the active session using its session ID.
- `showManualJoin()`, `launchBotFlow(...)`, `openBotFlow(...)`: validate and launch the account/world join flow.
- `showRuntimeLogs(...)`, `refreshRuntimeLogs()`, `formatRuntimeEvents(...)`: render sanitized diagnostics.
- `showSkills()`, `skillCard(...)`: render catalog status; UI labels never grant capability.
- UI helpers (`dp`, `surface`, `text`, `label`, `button`, `primaryButton`, `action`, `panelLayout`, `actionButton`, `section`, `card`, `hero`, `accountCard`, `addVital`) only construct presentation. They must not issue network/gameplay commands.

### Full `DashboardActivity` method map

The dashboard is still a large Activity and should be split into screen controllers/components in a later Android refactor. Until then, these methods have the following responsibilities:

| Method | Responsibility / contract |
|---|---|
| `dp(value)` | Convert layout dimensions from density-independent units. |
| `surface(color, radius)` | Build a presentation-only rounded surface. |
| `text(value, size, color, bold)` | Build a text view with explicit typography. |
| `label(value, size)` | Build a secondary text label. |
| `button(name, callback)` | Build a non-primary action button. |
| `primaryButton(name, callback)` | Build the primary action button for the current screen. |
| `action(name, primary, callback)` | Select the appropriate action-button style. |
| `panelLayout(margin)` | Return standard panel layout parameters. |
| `actionButton(name, primary, callback)` | Build and style a clickable action row/button. |
| `section(name)` | Add a screen section heading. |
| `accountCard(signedIn)` | Render account identity/sign-in status without showing secrets. |
| `hero(eyebrow, headline, detail)` | Render the dashboard's introductory hero. |
| `launchDiagnostic(activityName)` | Start an allowlisted diagnostics activity and report unavailable screens safely. |
| `showSignInReturnStatus(intent)` | Process the sanitized result after returning from account sign-in. |
| `openBotFlow(host, switchAccount)` | Begin the selected bot join flow with optional account switching. |
| `launchBotFlow(host, switchAccount)` | Launch the join flow for the selected host/account mode. |
| `launchBotFlow(host, switchAccount, friends)` | Launch the join flow with the friend-world flag explicitly chosen. |
| `showXboxFriends()` | Render friend/owner discovery choices; no account identity is inferred. |
| `show(tab)` | Select and render one dashboard tab. |
| `card()` | Create a presentation-only card container. |
| `showCommandCenter(signedIn)` | Compose the main authenticated command-center screen. |
| `addVital(row, title, gap)` | Add one bounded vital metric to the screen. |
| `showSkills()` | Render the capability/skill catalog from runtime readiness, not UI assumptions. |
| `skillCard(name, availability, color, description)` | Render one skill and its current supported/blocked status. |
| `worldRequest(method, sessionId)` | Call the private provider with no extra payload. |
| `worldRequest(method, sessionId, extras)` | Call the private provider with a bounded typed payload; catch provider lifecycle/security errors. |
| `refreshCommandCenter()` | Request one status snapshot off the UI thread and discard stale screen generations. |
| `showWorldStatus(current)` | Render connection, vitals, gameplay, learning, Autopilot and capability state from one snapshot. |
| `requestFollowPlan()` | Select/preview a follow target; preview is not movement success. |
| `showBlockBreakDialog()` | Explain the single-block experimental/manual action and require confirmation. |
| `chooseIntelligentGameplayGoal()` | Present supported gameplay goals; do not enable actions beyond the selected goal's capabilities. |
| `requestGameplayAgent(goal, playerName)` | Submit a confirmed bounded gameplay goal to the active session. |
| `showAutonomyConfirmation()` | Explain limits and obtain confirmation before enabling bounded autonomy. |
| `requestCollectionPlan()` | Preview a currently observed item-drop collection objective. |
| `requestShelterPlan()` | Preview shelter prerequisites only; do not claim block placement is executable. |
| `requestPlankCraftPlan()` | Preview recipe prerequisites only; do not claim crafting is executable. |
| `requestGameplay(action, confirmed)` | Submit one allowlisted gameplay command without player-target parameters. |
| `requestGameplay(action, confirmed, playerName)` | Submit one allowlisted gameplay command with a validated selected player name. |
| `toggleLocalAutopilot()` | Show the confirmation step and then enable/disable the user-owned local curriculum. |
| `confirmLearningStart()` | Confirm and submit one selected built-in learning task. |
| `requestWorldStop()` | Stop only the session ID currently owned by the dashboard. |
| `showRuntimeLogs(signedIn)` | Render sanitized runtime diagnostics for the account/session state. |
| `refreshRuntimeLogs()` | Refresh the bounded recent-event list. |
| `formatRuntimeEvents(events)` | Convert a bounded deque of sanitized events into display text. |
| `showManualJoin()` | Collect/validate host and friend-world settings before launching the join flow. |
| `showStatus(message)` | Show one user-facing status message without treating queueing as success. |

### `WorldSessionProvider`

- `call(method, sessionId, extras)`: verify that the runtime session is active and route `status`, `gameplay` and `stop`.
- `queueGameplay(directory, extras, result)`: validate command allowlist/confirmation, enforce single pending command, atomically create inbox and set `accepted=true` only when queued.
- ContentProvider CRUD overrides: deliberately unsupported and must not expose arbitrary file/database access.

### `XboxSignInService`

- `onStartCommand(intent, flags, startId)`: create foreground notification and begin exactly one runtime attempt.
- `startProbe(host, friends)`: unpack SDK, wire private credential pipe, start ARM64 Node and supervise final cleanup.
- `readAndSaveAccount(source)` / `persistAccount(bytes)`: accept the bounded account result and commit through encrypted `BotAccount` storage.
- `saveActiveNetworkAddresses(directory)`: stage usable Android addresses for the runtime.
- `readStatus()`: read and parse the sanitized atomic runtime status.
- `finalMessage(snapshot, exitCode)`: map final state to a safe user-facing summary.
- `showSignInCompleteNotification(...)`: update notification without leaking account secrets.

### `BotAccount`, `BotSessionProvider`, `MinePilotService`, `BedrockEngine`

- `BotAccount.file/key/save/read/forget/refreshToken/gamertag/xuid`: manage encrypted bot-account storage and display-safe identity.
- `BotSessionProvider.openFile(uri, mode)`: stream only the refresh credential through a private pipe.
- `MinePilotService.onCreate/onStartCommand/onTimeout/onBind`: **diagnostic-only service**; it does not connect to Minecraft.
- `BedrockEngine.Unavailable`: fail-closed placeholder until an Android engine implementation is genuinely installed; never advertise capabilities.

## 3. Transport-independent prototypes

### `src/core/bot-runtime.ts`

- `BotRuntime.connect()`: connect through an injected adapter with generation/cancellation protection.
- `BotRuntime.setTarget(target)`: validate and store a finite position.
- `BotRuntime.step()`: take one observation and choose idle, bounded movement or safety stop.
- `BotRuntime.disconnect()`: abort current work and disconnect once.

This TypeScript runtime is not the packaged Android friend-world connection unless a tested adapter is explicitly wired into that path.

### `src/gameplay/companion-engine.ts`

- `distance(a, b)`: Euclidean distance for validated 3D positions.
- `decideGameplay(world, goal)`: pure planner returning descriptive intents; intents are not protocol actions.

### `integration/addon-autonomy/autonomy-core.js`

- `MovementAuthority.request/release/clear/step`: select one unexpired highest-priority movement request and report stall; adapter decides whether the request is permitted.
- `TaskScheduler.enqueue/cancel/step/pause/retry`: serialize bounded tasks with timeout and retry budget.
- `assessSurvival(observation)`: pure survival priority assessment.
- `AutonomyCore.tick(context)`: combine survival override, task step and movement arbitration.

This add-on-derived autonomy core is a separate integration prototype. It must not become a second source of movement or task ownership in the Android runtime.

## 4. Cross-function invariants

- Status/snapshot/manifest functions are read-only.
- Every command has schema validation, explicit owner, session validation and bounded input.
- Every asynchronous operation has cancellation, timeout and cleanup.
- Only one movement writer may own the Bedrock input stream at a time.
- Only one server-authoritative stack request may be outstanding at a time.
- Every action distinguishes queued, dispatched, acknowledged and postcondition-verified states.
- Unknown data remains unknown; no guessed packet fields, item IDs, block states or player identities.
- The 183 skill compositions are metadata until every dependency has a protocol-backed executor and server-verified tests.
