# contracts

Contratos compartilhados entre clientes, API e processamento. Dinheiro em JSON usa strings decimais canônicas.

US-012 implementada na fundação: OpenAPI 3.1.1/API 1.0.0, tipos readonly, SDK e parsers/validadores gerados para contas, saldo e movimentações. Web/Desktop/Mobile compartilham o SDK com transporte injetado. Sem novas dependências externas de produção.

Consulte [uso e limites](../../docs/development/api-contracts.md) e o [ADR-0026](../../docs/architecture/adr/0026-contratos-openapi-e-clientes.md). Execute pnpm contracts:generate ao editar openapi/v1.json e pnpm contracts:check para detectar divergências. pnpm test compila e testa os clientes com peer HTTP sintético; pnpm check inclui o gate completo. API e integrações de runtimes permanecem pendentes.
