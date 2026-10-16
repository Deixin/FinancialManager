# test-fixtures

Fixtures sintéticas compartilhadas. Nunca incluir dados pessoais ou financeiros reais.

FIN-001 contém três contas fictícias em BRL, referências, receita/gasto, transferência, compra de cartão, pagamento, estorno e projeções staging/deleted. Os totais mensais esperados são escritos explicitamente, sem usar os algoritmos testados para calculá-los.

O pacote depende apenas de domain para construir MoneyMinor e tipar as fixtures. Destina-se a testes; não deve ser dependência de produção dos apps. Consulte a [política](../../docs/quality/fixtures.md) e o [cenário](../../docs/development/domain-core.md). pnpm test constrói as dependências antes da suíte.
