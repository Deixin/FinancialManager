# Decisões pendentes

Registro inicial de divergências encontradas na documentação v1.0. Nenhuma delas impede organizar o repositório; devem ser resolvidas antes da implementação afetada.

| ID    | Assunto                             | Evidência                                                                                                                                                        | Decisão necessária                                                                                                 |
| ----- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| DP-01 | Validade de acesso offline em nuvem | [PRD](../product/01-prd.md), RF-31: revalidação em até 24 horas. [Arquitetura](04-technical-architecture.md), política offline e ADR-014: proposta de 7 dias.    | Aprovar prazo e alinhar produto, contratos e testes.                                                               |
| DP-02 | Retenção residual de backups        | [PRD](../product/01-prd.md), exclusão definitiva: expiração em até 30 dias depois. [Arquitetura](04-technical-architecture.md), retenção e ADR-015: até 35 dias. | Aprovar prazo técnico e comunicação das datas concretas.                                                           |
| DP-03 | Nome do papel de leitura            | [Modelo de dados](03-data-model.md), workspace_member.role: READER. [Arquitetura](04-technical-architecture.md), autorização: VIEWER.                            | Unificar enum e contratos, preservando as capacidades especificadas.                                               |
| DP-04 | Decisões físicas W0                 | [Backlog](../delivery/05-backlog.md), US-001 a US-007.                                                                                                           | Validar criptografia/SQLCipher, INT64, OIDC, RLS, sync e parsers; registrar escolhas físicas e evidências em ADRs. |

A separação ui-dom/design-tokens segue a arquitetura técnica. A referência genérica a um pacote ui no guia não define um componente DOM compartilhado com React Native.

Os [conceitos visuais](../ux/concepts/README.md) incluem elementos que precisam ser reinterpretados conforme o PRD, como IA, originais anexados, probabilidades, aprovações e compromissos futuros. Uma imagem não amplia o escopo do MVP.
