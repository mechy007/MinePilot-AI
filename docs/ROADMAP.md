# MinePilot development roadmap

Target: Minecraft Bedrock 1.26.66.1 on Vivo V2544, 8 GB RAM.

## Phase 0 — prove feasibility
- [ ] Confirm Minecraft protocol 2225 interoperability
- [ ] Test Microsoft/Xbox login with separate bot identity
- [ ] Discover correct owner-hosted world via NetherNet
- [ ] Verify same-phone session while Minecraft stays foregrounded
- [ ] Validate Android ARM64 embedded runtime and lifecycle policy

## Phase 1 — gameplay
- [ ] Decode chunks, position, inventory and entity updates
- [ ] Implement move/follow/stop with confirmed state changes
- [ ] Add safe reconnect and diagnostics

## Phase 2 — intelligence
- [ ] Task graph, priorities and cancellation
- [ ] World memory, experience records and checkpoints
- [ ] Mining, crafting, survival and cooperation

## Phase 3 — advanced skills
- [ ] Building blueprints and placement verification
- [ ] Combat tactics and owner protection
- [ ] Bedrock-specific Redstone circuit templates

No Bedrock connectivity, Android runtime, or APK is implemented by this foundation commit.
