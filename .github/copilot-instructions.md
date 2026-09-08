# Buildy — Copilot entry point

Read [AGENTS.md](../AGENTS.md), then [GRAPH](../docs/architecture/GRAPH.md) and [STATE](../docs/architecture/STATE.md).
Load only the affected section of [FLOWS](../docs/architecture/FLOWS.md) and its code/test links.

Work on one end-to-end flow at a time. State the flow ID and affected dependency edges before editing.
Preserve the current design, data and stack; fix demonstrated blockers rather than rebuilding the application.
Keep accounts, private renovations, photo updates, sharing, likes/comments and a digital Bouwboek as the small MVP.
Stripe, Peecho, physical ordering and unrelated platform features are not release requirements. Keep checkout off.
`public_demo` and `feedback_beta` are existing runtime profiles; do not confuse the deployed demo with the target app.
Missing provider credentials require an owner action, not an authentication bypass or another auth architecture.
No Computer Use. CLI/API, Playwright and owner-performed personal login are sufficient tooling.

Update graph edges only when dependencies change, flow contracts only when behavior changes, and STATE only with real evidence.
Record commit, environment, result and proof type. Tests with mocked APIs never prove hosted persistence.
Keep instructions concise. Do not create graph infrastructure, new CI machinery or a new documentation framework for this graph pack.
Visible product text is Dutch. Use `Verbouwing`, `Bouwmoment`, `Verhaal` and `Bouwboek`; preserve historical technical names when renaming adds risk.
