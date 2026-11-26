# Layer 7 — Companion advice and private session memory

Layer 7 runs a small original deterministic policy inside the *same* Xbox-authenticated Bedrock client. It uses existing server-reported world, vitals, resource, following, crafting and workflow **planning states**. It does not import a model, require an API key, or execute game actions.

**Defaults:** the advisor is OFF on every new connection or dimension switch. The user must explicitly enable \`suggestions\` mode. Only \`advisor_review\` records a decision. Each event is a whitelisted action/reason/time triple; at most 32 entries, in-memory only. Turning off wipes all entries.

**Priority:** critical health/air -> stop suggestion; missing world -> wait; low hunger plus observed food -> plan-food suggestion; interrupted task -> manual review; unverified Follow/resource route -> verify terrain; insufficient building materials -> review materials; pending workflow -> manual checkpoint; otherwise inspect. Suggestions are never mapped to Bedrock packets and include \`executed:false\`. Emergency movement cancellation is the existing Layer 4 mechanism; an advisor suggestion does not impersonate it.

**Testing:** advisor safety priority, missing-world gate, deduplicated bounded journal, session reset and cross-layer same-client integration. Android exposes an opt-in control, a review control, redacted recommendation/status and journal count. Disable by default is intentional.

**Remaining blocker:** this is NOT autonomous survival, walking, crafting, building, Qwen reasoning or a verified skill executor. Before permissioned autonomy, implement and verify movement, chunk collision, server response acknowledgements and an independent safety supervisor.