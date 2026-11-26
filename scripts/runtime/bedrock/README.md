# MinePilot Bedrock Runtime Extensions

This package is the modular extension layer invoked by the existing BedrockGameplayBridge.

- contracts.cjs: runtime limits and version marker.
- compatibility/versions.cjs: compatibility ledger for every audited source.
- actions/envelope.cjs: confirmation, freshness, controller ownership and held-control masking.
- actions/outcomes.cjs: temporal postcondition verifier requiring fresh server evidence.
- inventory/containers.cjs: Bedboo-inspired window mapping, click previews and read-only inventory aggregation.
- navigation/astar.cjs: binary-heap A* over a caller-supplied verified grid.
- planning/goap.cjs: bounded symbolic goal planner.
- planning/obtain.cjs: Bedboo planner adapter over MinePilot's existing ledger and recipe snapshots.
- safety/policy.cjs: observation-only survival and hazard policy.
- tasks/runner.cjs: serial bounded orchestration requiring a validated adapter and verified outcomes.
- learning/curriculum.cjs: verified skill-progress tracking; never auto-starts.
- diagnostics/recorder.cjs: bounded redacted command telemetry.
- index.cjs: extension factory consumed by the existing bridge.

The package creates no second Minecraft client, Xbox login, NetherNet channel, inventory authority, stack-request manager or movement controller. Planning and inventory helpers return previews only. plan_obtain does not dispatch mining, gathering, smelting, crafting or inventory transactions.

Bedrock 1.26.66.1 remains unverified. The repository's known codec baseline is 1.26.60 / protocol 2225. See docs/INTEGRATION_RESTRUCTURE.md.
