# Financial Manager — índice da documentação

## Leitura inicial

| Ordem | Documento                                                        | Conteúdo                                |
| ----- | ---------------------------------------------------------------- | --------------------------------------- |
| 1     | [PRD](product/01-prd.md)                                         | Escopo, regras de negócio e requisitos  |
| 2     | [Telas e fluxos](product/02-screens-flows.md)                    | Navegação, estados de UI e fluxos       |
| 3     | [Modelo de dados](architecture/03-data-model.md)                 | Entidades e invariantes de persistência |
| 4     | [Arquitetura técnica](architecture/04-technical-architecture.md) | Fronteiras, stack, segurança e operação |
| 5     | [Backlog técnico](delivery/05-backlog.md)                        | Épicos, histórias e critérios de aceite |
| 6     | [Plano de implementação](delivery/06-implementation-plan.md)     | W0–W6, marcos e gates                   |
| 7     | [Guia de início](development/07-getting-started.md)              | Preparação e sequência inicial          |

## Precedência das decisões

1. ADR aprovado mais recente, apenas para a decisão técnica que ele substitui explicitamente.
2. PRD para comportamento de produto e negócio.
3. Telas e fluxos para comportamento de UX.
4. Modelo de dados para invariantes de persistência.
5. Arquitetura técnica para implementação.
6. Backlog e plano para sequenciamento.

Conflitos devem ser registrados e resolvidos por ADR ou correção documental. As [decisões pendentes](architecture/decisions-pending.md) não foram resolvidas pelo bootstrap.

## Material de apoio

- [Estado do projeto](delivery/status.md).
- [Núcleo monetário puro US-013](development/domain-core.md), com MoneyMinor, saldos, transferências e cartões.
- [Contratos OpenAPI e clientes US-012](development/api-contracts.md), com geração e validação compartilhadas.
- [Implementação e protocolo do spike Desktop US-001](development/spikes/us-001-desktop-vault.md), com [roteiro de homologação externa](development/spikes/us-001-homologation.md).
- [Implementação e protocolo do spike Mobile US-002](development/spikes/us-002-mobile-vault.md).
- [Implementação e protocolo local de identidade US-003](development/spikes/us-003-oidc.md).
- [Implementação e protocolo de isolamento PostgreSQL US-004](development/spikes/us-004-postgresql-rls.md).
- [Implementação e protocolo de sincronização entre dois clientes US-005](development/spikes/us-005-sync.md).
- [Implementação e benchmark de parsers OFX/CSV US-006](development/spikes/us-006-parsers.md).
- [Consolidação física e gates de adoção US-007](development/spikes/us-007-physical-decisions.md).
- [ADRs](architecture/adr/README.md).
- [Conceitos visuais](ux/concepts/README.md), usados como referência visual.
- [Fixtures](quality/fixtures.md), [plano de testes](quality/test-plan.md) e [modelo de ameaças inicial](quality/threat-model.md).
- [Exportações Word v1.0](_exports/v1.0/README.md).
- [Proveniência e templates originais](_sources/v1.0/README.md).
- [Orientações para agentes](../AGENTS.md) e [contribuição](../CONTRIBUTING.md).

Os sete documentos Markdown foram reorganizados sem alteração de conteúdo. Os diagramas referenciados foram recuperados dos respectivos arquivos Word.
