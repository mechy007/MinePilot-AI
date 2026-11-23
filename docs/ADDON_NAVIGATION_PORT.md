# Add-on Gameplay Port — Android Bedrock Navigation

Sources inspected from user uploads:
- `Ai-multiplayer-1.9-release.mcaddon` / `bp/scripts/ai_navigation.js` (`requestMove`, `releaseMove`, ownership priorities, 20-tick lease, stuck and detour tracking), `ai_player_physics.js` (steering), `ai_goals.js` (priority and mode consistency), `ai_water_escape.js` (water handling).
- `AI-Player-Plus-v3.0.mcaddon` / `AI_Player_Plus_BP/scripts/main.js` (follow/stay/explore/gather/mine/farm/clear task modes and the multi-loop companion controller).

## Implemented in MinePilot

- New TypeScript BedrockMotionArbiter in `src/gameplay/addon-navigation.ts`, inspired by the provided navigation authority and adapted to an external Xbox-authenticated player.
- Competitors: survival 60, combat 50, water 45, job 40, follow 30, shallow-water 22, wander 10. Manual input has a separate 70 priority. Source priority picks just one active owner.
- Requests expire after 100–5000ms, can be released individually, and are reset on Stop, start_game, dimension change or session shutdown.
- A new incoming server position observation is necessary before stuck detection counts a sample. The threshold is the reference source's 0.12 blocks and 25 stuck samples.
- The arbiter may propose a detour only when the surrounding positions have been positively verified as navigable. It does not invent ground terrain from chunk headers.
- A named-follow or return goal from Layer 2 now refreshes the follow source in the arbiter, but remains unexecuted until a validated collision decoder and physical movement action loop exist.
- The Xbox friend-world Android runtime creates one instance in the same session; the debug provider and dashboard expose owner/state/reason. The full Android Node SDK stages its compiled code.
- Unit and packaged same-client tests ensure competing source priority, expiration, fresh server samples, stuck handling, emergency stop, dimension reset and **no outgoing PlayerAuthInput packets from planning**.

## What cannot directly run

Each provided MCADDON is built for Minecraft's internal `@minecraft/server` and resource/behavior packs. Calls like `ai.applyImpulse`, `entity.teleport`, `dimension.getBlock`, entity hit events and Script-API forms cannot execute from MinePilot's standalone Android Node process just by copying the JavaScript files. An actual in-world server-side bot from these addons is a *custom entity*, not the independent Xbox player currently connected through NetherNet.

Do not interpret a compiled priority scheduler as completed physical movement/mining/crafting. The known physical test reported a joined but nonmoving, noninteractive player. Spawn and loading behavior is separately addressed in draft PR #99; the protocol and actual host response still need on-device verification.

No extra APK installation is necessary after each PR; use the consolidated ARM64 runtime build when doing the next physical test.