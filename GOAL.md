# Buildy — finish the small user MVP

**Maak van je verbouwing een verhaal om te bewaren.**

The first release must let an owner save renovation photos and updates, share the story with a friend, receive a like/comment, and see a digital Bouwboek grow from the same content.
Physical ordering is later. Stripe and Peecho remain off.

## Canonical working map

- [GRAPH](docs/architecture/GRAPH.md): scope, modules, dependencies and boundaries.
- [FLOWS](docs/architecture/FLOWS.md): owner/viewer journeys and observable acceptance checks.
- [STATE](docs/architecture/STATE.md): dated evidence, active blocker and next action.

Read [AGENTS.md](AGENTS.md) for the change loop. Do not duplicate status here.

## Done means a persisted outcome

Two real users on one verified deployment can create a private renovation, save photos, reload, share, interact and inspect the resulting digital Bouwboek. Unauthorized reads/writes are denied and revocation works.
A static example, local-only photo demo, a green build, or fixture-backed tests alone does not satisfy this goal.

Do not rewrite working services, change auth/storage providers, or expand the social product before that journey succeeds.
The existing Google OIDC implementation still requires owner-approved configuration and a real login test. Skipping setup does not remove this dependency.
No Computer Use. No credentials in chat. No production changes or paid upgrades without authorization.
