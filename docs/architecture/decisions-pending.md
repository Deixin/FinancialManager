# Decisões pendentes

Registro inicial de divergências encontradas na documentação v1.0. Nenhuma delas impede organizar o repositório; devem ser resolvidas antes da implementação afetada.

Avanço US-021 em 2026-10-16: [ADR-0032](adr/0032-schema-sqlite-e-equivalencia.md) e [protocolo](../development/sqlite-schema.md) validam o corpus persistido em PostgreSQL, SQLite e SQLCipher Windows/Android. G07-TIME avançou nesses recortes; iOS e corpus ampliado continuam pendentes. G07-VAULT exige adoção no validador/migração/backup do cofre de produto. G07-IDS/QUERY/JOBS/PDF e DP-01 a DP-04 não foram encerrados.

Avanço US-020 em 2026-10-16: [ADR-0031](adr/0031-schema-inicial-postgresql.md) especifica o núcleo PostgreSQL com migração/constraints e RLS restritiva sem grants de produto. O protocolo valida o lado PostgreSQL de G07-TIME; bindings SQLCipher e comparação permanecem pendentes. G07-QUERY continua antes de fixar repositories. A migração não inclui enum de membros e não resolve DP-03. Nenhuma pendência de offline/retenção foi alterada.

US-007 consolidada em 2026-10-16 no [ADR-0024](adr/0024-consolidacao-fisica-e-gates.md): os seis itens de aceite possuem propostas/evidências ou gates pendentes explícitos no [protocolo](../development/spikes/us-007-physical-decisions.md). O probe SQLite aprovou armazenamento de UUID, datas/instantes e decimais; não homologa bindings nativos, PostgreSQL, geradores ou novas bibliotecas. DP-04 continua aberta para adoção e validações restantes. DP-01, DP-02 e DP-03 não foram resolvidas por essa consolidação.

| ID    | Assunto                             | Evidência                                                                                                                                                        | Decisão necessária                                                                                                 |
| ----- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| DP-01 | Validade de acesso offline em nuvem | [PRD](../product/01-prd.md), RF-31: revalidação em até 24 horas. [Arquitetura](04-technical-architecture.md), política offline e ADR-014: proposta de 7 dias.    | Aprovar prazo e alinhar produto, contratos e testes.                                                               |
| DP-02 | Retenção residual de backups        | [PRD](../product/01-prd.md), exclusão definitiva: expiração em até 30 dias depois. [Arquitetura](04-technical-architecture.md), retenção e ADR-015: até 35 dias. | Aprovar prazo técnico e comunicação das datas concretas.                                                           |
| DP-03 | Nome do papel de leitura            | [Modelo de dados](03-data-model.md), workspace_member.role: READER. [Arquitetura](04-technical-architecture.md), autorização: VIEWER.                            | Unificar enum e contratos, preservando as capacidades especificadas.                                               |
| DP-04 | Decisões físicas W0                 | [Backlog](../delivery/05-backlog.md), US-001 a US-007.                                                                                                           | Validar criptografia/SQLCipher, INT64, OIDC, RLS, sync e parsers; registrar escolhas físicas e evidências em ADRs. |

A separação ui-dom/design-tokens segue a arquitetura técnica. A referência genérica a um pacote ui no guia não define um componente DOM compartilhado com React Native.

Evolução parcial de DP-04 em 2026-10-13: US-001 foi validada, incluindo restauração em outra instalação Windows. [ADR-0017](adr/0017-spike-cofre-desktop.md), [ADR-0018](adr/0018-homologacao-desktop-vm-docker.md) e [evidência](../quality/evidence/us-001-windows-vm-2026-10-13.json) subsidiam US-007. Os demais spikes e a adoção final das decisões físicas continuam pendentes; DP-04 não foi encerrada integralmente.

Os [conceitos visuais](../ux/concepts/README.md) incluem elementos que precisam ser reinterpretados conforme o PRD, como IA, originais anexados, probabilidades, aprovações e compromissos futuros. Uma imagem não amplia o escopo do MVP.

Evolução parcial de DP-04 em 2026-10-15: a US-002 passou na homologação Android, com [evidência](../quality/evidence/us-002-android-2026-10-15.json) e [ADR-0019](adr/0019-spike-cofre-mobile.md). iOS permanece pendente. O instrumento não resolve concessão/expiração de acesso offline da DP-01 nem adota definitivamente a stack de produção.

US-003 também avançou no recorte local em 2026-10-15: [ADR-0020](adr/0020-spike-identidade-oidc-local.md) e [evidência](../quality/evidence/us-003-local-2026-10-15.json). Keycloak local não é a escolha do provider SaaS; conectores Google/Apple, integração Next.js e runtimes nativos permanecem pendentes. DP-04 continua aberta.

US-004 foi concluída como spike em 2026-10-15: [ADR-0021](adr/0021-spike-isolamento-postgresql-rls.md) e [evidência](../quality/evidence/us-004-postgresql-2026-10-15.json) validam RLS, pool e contexto transacional contra PostgreSQL real. Permissões booleanas são exclusivas da fixture; DP-03 não foi resolvida. Typed-query, schema e autorização definitivos continuam pendentes; DP-04 permanece aberta.

Evolução parcial em 2026-10-16: US-005 validada como spike de duas réplicas ([ADR-0022](adr/0022-spike-sincronizacao-dois-clientes.md)) e US-006 validada com OFX/CSV, staging e benchmark de 10 mil linhas ([ADR-0023](adr/0023-spike-parsers-ofx-csv.md)). As evidências subsidiam US-007, sem adotar automaticamente os adaptadores ou encerrar DP-04. Permanecem a consolidação física, integrações/plataformas e os conectores pendentes; DP-01 a DP-03 não foram alteradas.
