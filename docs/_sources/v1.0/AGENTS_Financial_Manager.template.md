# Financial Manager — AGENTS.md (template)

## Source of truth
- Start with `docs/00-index.md`.
- Work against an explicit `US-xxx` story or W0 spike.
- Do not invent requirements. If official documents conflict, report the conflict and stop the affected change.
- ADRs override older technical decisions only for the scope they explicitly supersede.

## Product invariants
- Never represent money with floating point. Use MoneyMinor/integer.
- Workspace is the tenant/data-isolation boundary.
- Financial values, transaction descriptions, CPF/CNPJ and document contents must not be written to operational logs.
- A Desktop local workspace can exist without any cloud user.
- Web is cloud-only and must not implement a persistent local financial vault.
- Imports must use staging/review before affecting balances.
- Sync conflicts must not be silently resolved with last-write-wins.
- Destructive changes must preserve the lifecycle/retention rules documented in the PRD/architecture.

## Engineering rules
- Use pnpm and repository scripts.
- Do not add a production dependency without explaining why existing dependencies cannot solve the problem.
- Any schema change requires a migration and a test.
- Keep domain rules out of UI components and transport adapters.
- Update an ADR/documentation when an architectural decision changes.
- Run relevant lint, typecheck, unit/integration tests and build before claiming completion.

## Security
- Never commit or print secrets.
- Never use real customer/personal financial data in fixtures or tests.
- Do not bypass authorization or RLS to make tests pass.
- New external integrations require explicit configuration and threat review.
- Treat code-signing keys, store credentials and production cloud credentials as unavailable unless the user explicitly grants access.

## Review focus
Prioritize findings about data loss, duplicate financial effects, workspace isolation, money precision, auth/RLS, secrets, sensitive logging, migration safety, sync convergence, import idempotency and missing tests.
