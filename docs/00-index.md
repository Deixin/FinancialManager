# Financial Manager — índice da documentação

A [US-044 compartilhada](development/categories.md) implementa categorias por workspace sobre PostgreSQL/SQLite. Consulte o [ADR-0056](architecture/adr/0056-categorias-compartilhadas-por-workspace.md). Próximo incremento integra o Desktop; homologações humanas permanecem após integração completa. Entradas abaixo são históricas.

A [US-043 no Desktop](development/desktop-card-payments.md) integra cartões, pagamentos atômicos e histórico ao cofre local. Consulte o [ADR-0055](architecture/adr/0055-cartoes-e-pagamentos-no-desktop.md). Próxima história: US-044; importação/conciliação e homologações humanas integradas permanecem nos próprios gates. Entradas abaixo são históricas.

A [US-043 compartilhada](development/card-payments.md) acrescenta pagamentos atômicos de cartão, separando consumo e liquidação de dívida. Consulte o [ADR-0054](architecture/adr/0054-pagamentos-de-cartao-compartilhados.md). Próximo incremento: integração Desktop; homologações humanas permanecem após integração completa. Os parágrafos abaixo preservam os incrementos anteriores.

A [US-042 Desktop](development/desktop-transfers.md) integra os dois lados da transferência ao cofre local e suas revisões. Consulte o [ADR-0053](architecture/adr/0053-transferencias-no-desktop-sqlcipher.md). Próxima história: US-043; homologações humanas permanecem após a integração completa.

A [base compartilhada US-042](development/transfers.md) implementa transferências atômicas com grupos, pares e revisões. Consulte o [ADR-0052](architecture/adr/0052-transferencias-compartilhadas-atomicas.md). Próximo incremento: integração Desktop; homologações humanas continuam após a integração completa.

A [US-041 no Desktop](development/desktop-movements.md) acrescenta entradas/gastos, edição, exclusão reversível, histórico e ajustes identificados ao cofre local. Consulte o [ADR-0051](architecture/adr/0051-movimentacoes-manuais-desktop.md). Próximo incremento: US-042; homologações humanas permanecem após a integração completa. Os parágrafos abaixo preservam o estado dos incrementos anteriores.

A [fundação US-041](development/manual-movements.md) acrescenta a política compartilhada de lançamentos manuais com versões, histórico e sinais por natureza da conta. A integração Desktop dessa história é o próximo incremento; homologação humana continua após integração completa.

A [US-040 no Desktop](development/desktop-accounts.md) integra contas, referências e conferência de saldo ao cofre SQLCipher, com testes Chromium/WebView2 e restauração em outra instalação. A [base compartilhada](development/financial-accounts.md) atende PostgreSQL/SQLite. Próxima história: US-041, movimentações manuais; homologação humana fica para após integrar todo o sistema.

A gestão de múltiplos espaços locais está documentada na [US-036](development/workspace-manager.md), com criação independente, seletor completo, filtro Local/Nuvem e repetição segura após resposta perdida.

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
- [Restauração US-035](development/local-restore.md), com prévia validada, novo workspace/IDs/chave, staging e confirmação idempotente.
- [Backup criptografado US-034](development/local-backup.md), com manifesto autenticado, senha independente, snapshot consistente e publicação sem sobrescrita.
- [Homologação humana pós-integração](architecture/adr/0044-homologacao-humana-apos-integracao.md), conforme instrução do usuário; pendências não são aprovações antecipadas.
- [Bloqueio local US-033](development/local-privacy.md), com PIN opcional, Windows Hello, liberação de chaves no Rust e homologação interativa pendente.
- [Cofre Desktop US-032](development/desktop-vault.md), com chave Windows, falhas de migrations e recuperação de journal criptografado.
- [Espaço local anônimo US-031](development/local-workspaces.md), com criação idempotente, persistência SQLCipher mínima, chave Windows e reabertura sem identidade cloud.
- [Entrada Desktop US-030](development/desktop-entry.md), com modo local sem identidade, frontend Vite e homologação Tauri/WebView2.
- [Suíte de invariantes US-027](development/cross-engine-invariants.md), com roteiro comum, oráculo independente e comparação de estado/auditoria PostgreSQL/SQLite.
- [Revisões financeiras US-026](development/financial-revisions.md), com versão-base, snapshots atômicos, reversão segura e adapters PostgreSQL/SQLite.
- [Fixtures financeiras canônicas US-025](development/canonical-fixtures.md), com dataset portátil, carga atômica e goldens PostgreSQL/SQLite.
- [Ports e repositories US-024](development/data-access.md), com G07-QUERY, contexto autorizado e fronteiras de tabelas por módulo.
- [Núcleo monetário puro US-013](development/domain-core.md), com MoneyMinor, saldos, transferências e cartões.
- [Contratos OpenAPI e clientes US-012](development/api-contracts.md), com geração e validação compartilhadas.
- [Fundação dos ambientes US-014](development/environments.md), com perfis Docker sintéticos e protocolo de isolamento/limpeza.
- [Observabilidade base US-015](development/observability.md), com correlação, OpenTelemetry manual e scrub por allowlist.
- [Design tokens e shells US-016](development/design-system.md), com exemplo DOM acessível e adaptação Native.
- [Flags e configuração US-017](development/runtime-configuration.md), com defaults desativados, atualização em execução e autorização separada.
- [Schema PostgreSQL US-020](development/postgresql-schema.md), com migração versionada, constraints, RLS restritiva e protocolo real.
- [Schema SQLite e equivalência US-021](development/sqlite-schema.md), com corpus compartilhado e SQLCipher real Windows/Android.
- [Framework de migrations US-022](development/schema-migrations.md), com up/down e recuperação após término de processos PostgreSQL/SQLite.
- [UUIDv7 e política temporal US-023](development/identity-and-time.md), com CSPRNG por host, codecs canônicos e protocolos reais.
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
