# MinePilot — Companion Mechanics Research from User-Provided MCADDON Packages

## Inspected packages

1. AI Player+ 3.0 (behavior and resource packs): controller item, custom humanoid entity, animations/emotes, inventory, jobs, companion task loop, follow and combat animations. Manifest credits GURJAR and explicitly states **All Rights Reserved**.
2. AI Multiplayer 1.9 (behavior and resource packs): entity definitions, scripted navigation and physics, goals, water escape, fall protection, survival, jobs, item pickup, shelter, camp, conversations, duels, and more. No explicit reuse license was found in the provided manifest.

## Important execution boundary

Both addons rely on the Minecraft `@minecraft/server` / `@minecraft/server-ui` Script API. That API runs *inside a world that has the addon installed*. The scripts commonly call `entity.applyImpulse`, `entity.teleport`, `entity.dimension.getBlock`, `system.runInterval`, `world.afterEvents`, `EntityComponentTypes`, or similar server-world privileges. MinePilot instead connects from a separate Android process with a Microsoft/Xbox account and sends Bedrock protocol packets. Simply copying these scripts into its app would not make them run.

The addon 'players' are custom entities controlled by the server, not guaranteed to be registered in the host as independent Microsoft/Xbox players. Neither addon supplies a magic fix for a joined-but-ghosted authentic player; the spawn/authority/position handshake remains a separate PR #99 issue.

## What this PR originally implements (not copied)

- Companion cue priorities: critical-health stop, incomplete spawn, spectator/creative mode warning, missing movement authority, dwindling air, food suggestion, task interruption and nighttime shelter advisory.
- Reuse trusted observations already available in the Android Bedrock session and Layer 4 survival manager. These are read-only suggestions from live game-mode/handshake snapshots.
- Bounded in-memory intent leases for future verified movement/task arbitration: owner, priority, 100–5000 ms expiration and emergency preemption. The lease emits **no Minecraft packets**.
- Existing Layer 7 offline advisor remains off by default, uses original cue logic when the user enables suggestions, and retains its bounded private decision journal.
- Android receives the selected advisor action/reason through the existing private provider; Android Node SDK staging includes the new policy module.
- TypeScript tests for cue priority, nonexecution, unsupported/invalid leases, journal integration and no hidden autonomy.

## Deliberately not imported

- No raw JavaScript from either package, behavior/entity JSON, animation controller, images, models, pack icons, emotes or sound assets.
- No copied text dialogue/banter database or proprietary mechanics implementation.
- No requirement that the user's friend install or enable behavior/resource packs.
- No attempt to call server-side Script API privileges from Android.

## Next functional milestones

Resolve in-world player simulation from PR #99 and confirm host-side movement. Then implement decoded chunk terrain, bounded collision-aware movement, packet-valid and server-acknowledged interaction skills. Only after verified action execution should follow/mining/building become autonomous.

Add-on inspiration here denotes general design concepts; code is original and is not a port of copyrighted add-on source. Feature names and behavior differences are intentional.