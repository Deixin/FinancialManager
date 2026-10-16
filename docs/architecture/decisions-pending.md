# Decisões pendentes

Registro inicial de divergências encontradas na documentação v1.0. Nenhuma delas impede organizar o repositório; devem ser resolvidas antes da implementação afetada.

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
