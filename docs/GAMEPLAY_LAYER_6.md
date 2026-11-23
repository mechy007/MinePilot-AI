# Layer 6 — Navigation and workflow checkpoints

This slice is stacked on Layer 5, with **no phone reinstall**. It adds a bounded A* grid, farm/storage preview goals and a small checkpoint lifecycle. No autonomous player movement or block transactions are enabled.

- **Navigation:** \`SafeGridPlanner\` searches only explicitly verified \`walkable\` tiles (within 31×31, max 512 expansions). A Bedrock chunk header or changed-block runtime ID is **not** accepted as verification. In the current Android session no trusted voxel decoder populates the grid, so routes cannot be executed.
- **Gameplay observation:** \`inventory_content\` windows beyond the player's own inventory are counted as external container snapshots; only slot occupancy is stored. It cannot open, deposit or withdraw from chests. Server block updates count as farming-related changes only after a user selects farm preview; block types, crop maturity and harvesting remain unknown.
- **Intelligence:** \`plan_workflow\` accepts \`farm_preview\`, \`storage_preview\` and \`collect_preview\`. Checkpoints track observation and inventory review, then deliberately block at terrain and/or recipe verification. \`review_checkpoint\` cannot make a task execute.
- **Safety:** Critical health/air pauses plans. Stop and dimension transition clear workflow state. Input probe refuses while workflow preview is selected.
- **Testing:** TypeScript A* unknown-terrain tests; checkpoint/invalid-world/cancel tests; packaged same-session Bedrock integration proving no outgoing gameplay packets; Android provider and command center expose only sanitized status.

**Not proof of gameplay:** No actual farming, chest access, safe pathfinding in a real chunk, swimming, water physics, mining, crafting or task execution is established. Collision-aware navigation and game actions require host verification before promotion.