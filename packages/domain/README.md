# domain

Regras de negócio puras, sem dependência de UI, banco de dados, transporte ou runtime nativo.

US-013 implementada: MoneyMinor como string canônica i64, aritmética BigInt, rateios, saldos com referência/cobertura, consolidação por natureza, planos de transferência/pagamento de cartão e resumo separado de consumo e caixa. Sem dependências de produção.

Consulte a [API e os exemplos](../../docs/development/domain-core.md) e o [ADR-0025](../../docs/architecture/adr/0025-nucleo-monetario-puro.md). Execute pnpm --filter @financial-manager/domain typecheck ou build; pnpm test verifica comportamento pela API compilada. Persistência, autorização e contratos HTTP/IPC pertencem às camadas de aplicação/adaptadores.
