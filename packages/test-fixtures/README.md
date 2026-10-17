# test-fixtures

Fixtures sintéticas compartilhadas. Nunca incluir dados pessoais ou financeiros reais.

FIN-002 v1 é o [dataset canônico US-025](../../docs/development/canonical-fixtures.md), com 41 registros portáveis PostgreSQL/SQLite e goldens independentes. Use o subpath @financial-manager/test-fixtures/canonical ou fixtures/fin-002.json. O export é profundamente imutável; fixtures:generate/check mantém JSON/TS sincronizados. O vetor de documentos é preparatório e possui marcador explícito de schema pendente.

FIN-001 contém três contas fictícias em BRL, referências, receita/gasto, transferência, compra de cartão, pagamento, estorno e projeções staging/deleted. Os totais mensais esperados são escritos explicitamente, sem usar os algoritmos testados para calculá-los.

O pacote depende apenas de domain para construir MoneyMinor e tipar as fixtures. Destina-se a testes; não deve ser dependência de produção dos apps. Consulte a [política](../../docs/quality/fixtures.md) e o [cenário](../../docs/development/domain-core.md). pnpm test constrói as dependências antes da suíte.
