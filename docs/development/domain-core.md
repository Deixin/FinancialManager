# US-013 — MoneyMinor e regras puras

Implementação em packages/domain, conforme [RF-05–08](../product/01-prd.md), [US-013](../delivery/05-backlog.md) e [ADR-0025](../architecture/adr/0025-nucleo-monetario-puro.md). O pacote exporta as regras pelo entrypoint público; não depende de UI, transporte, banco ou runtime nativo.

## Contratos e operações

| API                                                          | Comportamento                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| moneyMinor, moneyInteger, fromMoneyInteger                   | Validação de string canônica i64 e conversão exata para/de BigInt                          |
| addMoney, subtractMoney, negateMoney, sumMoney, compareMoney | Operações inteiras com overflow explícito no resultado final                               |
| validateAllocationAmounts                                    | Parcelas positivas cuja soma coincide com o valor absoluto do lançamento                   |
| financialDate                                                | Dia de calendário válido, YYYY-MM-DD, sem instante/fuso                                    |
| calculateAccountBalance                                      | Referência + confirmados posteriores, início/fim do dia, data limite e avisos de cobertura |
| consolidateBalances                                          | Ativos, passivos e patrimônio líquido em BRL, mesma data e workspace                       |
| planTransfer, planCardPayment, validateCompositePlan         | Plano completo imutável com grupo e duas pernas, origem antes do destino                   |
| summarizeMovements                                           | Consumo, estorno, receita e fluxo de caixa distintos em período inclusivo                  |

MoneyMinor é texto em unidade mínima, sem pontuação decimal. A UI converte/valida sua entrada antes de construir esse tipo. Valores Number são rejeitados mesmo quando parecem inteiros seguros. Nenhuma operação monetária usa Number internamente.

```ts
import { addMoney, moneyMinor } from '@financial-manager/domain';

const amount = addMoney(moneyMinor('9007199254740993'), moneyMinor('2'));
// amount === '9007199254740995'
JSON.stringify({ amount_minor: amount });
// {"amount_minor":"9007199254740995"}
```

Cada resultado monetário, inclusive totais de relatórios, deve caber em i64. As operações lançam DomainError com code estável. O erro não contém o valor recebido. Somar MAX, 1 e -1 é válido em qualquer ordem; negar MIN ou retornar um agregado fora do intervalo é erro.

## Saldo, cobertura e escopo

O chamador fornece conta autorizada, referência ACTIVE ou null, projeções de movimentos, data final e history_coverage (COMPLETE, INCOMPLETE ou UNKNOWN). COMPLETE significa cobertura conhecida do intervalo necessário após a referência até a data final; não é deduzido da lista de movimentos. Sem referência, o resultado mostra apenas o movimento acumulado disponível, marcado INCOMPLETE/MISSING_REFERENCE, mesmo que a cobertura seja COMPLETE.

START_OF_DAY inclui os movimentos da data de referência; END_OF_DAY exclui essa data. Datas anteriores e posteriores à data final não alteram o saldo. Referência posterior à data final é rejeitada. Contas arquivadas continuam legíveis, mas não aceitam novos planos de transferência/pagamento.

Movement.posting_state é projeção derivada; CONFIRMED entra no cálculo, STAGING e DELETED não entram. Não representa alteração do schema. O adaptador só deve construir projeções com dados normalizados válidos. Plano recém-criado não é confirmado automaticamente.

Cada cálculo rejeita IDs repetidos e escopo divergente, inclusive em linhas ignoradas pelo período/estado. Isso evita mistura acidental; o serviço ainda precisa autorizar as contas, carregar revisões corretas, escolher a referência vigente e garantir a cobertura informada. Deduplicação de importações com IDs diferentes continua nas histórias de importação.

## Sinais e períodos

| Evento                | Variação ASSET                    | Variação LIABILITY            | Efeito econômico                      |
| --------------------- | --------------------------------- | ----------------------------- | ------------------------------------- |
| Receita em conta      | Positiva                          | —                             | Receita                               |
| Gasto em conta        | Negativa                          | —                             | Consumo                               |
| Compra de cartão      | —                                 | Positiva                      | Consumo                               |
| Estorno de cartão     | —                                 | Negativa                      | Redução de consumo na data do estorno |
| Transferência própria | Origem negativa, destino positivo | —                             | Zero                                  |
| Pagamento de cartão   | Banco negativo                    | Cartão negativo               | Zero; saída de caixa no banco         |
| Ajuste/OTHER          | Conforme informação explícita     | Conforme informação explícita | Não inferido como receita/despesa     |

As classificações econômicas INCOME/EXPENSE/EXPENSE_REVERSAL exigem sinais coerentes com a natureza da conta e valor não zero. Movimentos de saldo neutro classificados como ajuste/OTHER são representáveis. O saldo calcula deltas independentemente da classificação; o relatório valida os sinais econômicos dos movimentos incluídos.

A fixture FIN-001 é inteiramente fictícia e compartilhada em packages/test-fixtures. Saldo de abertura: banco 100000, poupança 0, cartão 0. Setembro: receita 50000, gasto bancário 20000, compra de cartão 12000 e transferência 10000. Outubro: pagamento 12000 e estorno 2000. Há também linhas STAGING/DELETED que devem ser ignoradas.

| Projeção                              | Setembro               | Outubro                |
| ------------------------------------- | ---------------------- | ---------------------- |
| Consumo bruto                         | 32000                  | 0                      |
| Estornos                              | 0                      | 2000                   |
| Consumo líquido                       | 32000                  | -2000                  |
| Caixa líquido                         | 30000                  | -12000                 |
| Saldo final banco / poupança / cartão | 120000 / 10000 / 12000 | 108000 / 10000 / -2000 |

cash_in/out somam fluxos ASSET nas contas fornecidas e incluem transferências nos totais brutos. Não são receitas/despesas econômicas. Importar compra e pagamento exige conciliação/persistência posteriores; este recorte garante a regra de classificação, não descobre automaticamente duplicatas de fontes distintas.

## Verificação

```sh
pnpm install --frozen-lockfile
pnpm --filter @financial-manager/domain typecheck
pnpm test
pnpm check
```

pnpm test constrói domain e test-fixtures antes de executar a API pública compilada, inclusive em checkout sem dist. Os 35 testes em infra/scripts/domain-money.test.mjs e domain-finance.test.mjs usam cenários e totais esperados sintéticos. O typecheck inclui contratos negativos de tipos sem distribuir seus arquivos no build. A CI quality existente executa pnpm check em Windows/Linux; execução remota deste incremento ainda pendente.

O resultado entrega o núcleo puro da US-013. Schema/migrações, atomicidade real de banco, outbox, API/OpenAPI, autorização, integração dos cofres e interfaces ficam nas histórias correspondentes. Os gates G07 e as decisões de prazo/papéis DP-01 a DP-03 permanecem explícitos; nenhum deles foi escolhido implicitamente por essas funções.
