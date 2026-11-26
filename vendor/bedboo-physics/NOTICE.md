# MinePilot Bedrock movement vendor notices

The Bedrock player physics implementation in `lib/physics/` is vendored from
[LiteLDev/bedboo](https://github.com/LiteLDev/bedboo), pinned to commit
`1d8d2ae4e7b5c062f71a6373b7aede65d6810bb9`.

- The Bedrock physics fork is distributed under LGPL-3.0-only; see `COPYING` and
  `COPYING.LESSER`. MinePilot changed the engine's vector import to use the
  repository's small local `Vec3` compatibility helper; the physics algorithms
  remain the pinned upstream source.
- Its AABB and attribute helpers are derived from PrismarineJS
  [prismarine-physics](https://github.com/PrismarineJS/prismarine-physics), MIT.
- The versioned Bedrock collision data in `BEDROCK-DATA-NOTICE.md` includes
  Minecraft-data (MIT) and CloudburstMC/Data (Apache-2.0) material and retains
  the original source attribution.
- MinePilot's adapter and runtime integration are maintained separately under
  the MinePilot repository's own license.

The upstream physics engine's recorded accuracy fixtures are based on BDS
1.26.51.1. MinePilot targets Bedrock 1.26.60 / protocol 2225, so real-world
movement and prediction-reconciliation validation on protocol 2225 remains a
required acceptance test; this vendor import alone does not claim that test
has passed.
