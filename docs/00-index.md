# Financial Manager — documentação atual

Estado de produto: **núcleo compartilhado da US-052 entregue**, com OFX normalizado e proveniência determinística. Próximo incremento: **integração Desktop e paridade Rust da US-052**. Consulte o [contrato OFX](development/ofx-parser.md). A US-051 de seleção/leitura/inspeção e a central US-050 permanecem integradas ao Desktop, incluindo backup e restauração. A validação segue o [ADR-0070](architecture/adr/0070-validacao-incremental-e-evidencias-imutaveis.md).

## Leitura por tarefa

1. [Estado atual](delivery/status.md) e [processo de desenvolvimento](development/validation-workflow.md).
2. Critérios da história no [backlog](delivery/05-backlog.md) e requisitos correspondentes no [PRD](product/01-prd.md).
3. Apenas a arquitetura e o protocolo pertinentes à mudança; consulte o [índice de ADRs](architecture/adr/README.md).

| Assunto                   | Fonte                                                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Produto e UX              | [PRD](product/01-prd.md), [telas e fluxos](product/02-screens-flows.md)                                                                                    |
| Persistência e fronteiras | [Modelo de dados](architecture/03-data-model.md), [arquitetura](architecture/04-technical-architecture.md)                                                 |
| Sequência                 | [Backlog](delivery/05-backlog.md), [plano](delivery/06-implementation-plan.md)                                                                             |
| Divergências abertas      | [Decisões pendentes](architecture/decisions-pending.md) — DP-01 a DP-04 mantêm seus escopos                                                                |
| Importações atuais        | [Núcleo](development/import-central.md), [Desktop](development/desktop-imports.md), [ADR-0069](architecture/adr/0069-central-de-importacoes-no-desktop.md) |
| Validação e segurança     | [Plano de testes](quality/test-plan.md), [ameaças](quality/threat-model.md), [fixtures](quality/fixtures.md)                                               |
| Contribuição              | [AGENTS.md](../AGENTS.md), [CONTRIBUTING.md](../CONTRIBUTING.md)                                                                                           |

Precedência: ADR aprovado mais recente apenas na decisão substituída; PRD; telas; modelo de dados; arquitetura; backlog/plano. Conflitos não são resolvidos silenciosamente.

O [índice histórico](00-index-history.md) preserva a versão anterior e os links de todas as entregas. Os sete documentos originais, [proveniência](_sources/v1.0/README.md) e [exportações](_exports/v1.0/README.md) permanecem preservados. Consulte o histórico quando a tarefa depender dele, sem relê-lo integralmente a cada incremento.
