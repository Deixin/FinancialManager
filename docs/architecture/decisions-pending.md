# Decisões pendentes

US-045 Desktop, catálogos: [ADR-0060](adr/0060-catalogos-de-subcategorias-e-tags-no-desktop.md) integra subcategorias/tags ao SQLCipher, com bases completas, 27 comandos e paridade. Associação/filtros de movimentações são o próximo incremento. Sem migration, dependência nova, mudança de backup ou resolução de DP-01 a DP-04. Homologações humanas pós-integração preservadas.

US-045, associação compartilhada: [ADR-0059](adr/0059-associacao-versionada-de-classificacao.md) compõe intenções de classificação sobre revisões, com consulta transacional aos catálogos e filtros puros deduplicados. Desktop, autorização/cobertura dos snapshots de leitura e cloud de produto permanecem pendentes. Sem migration, dependência nova ou alteração de DP-01 a DP-04; homologações humanas pós-integração preservadas.

US-045 em andamento: [ADR-0058](adr/0058-catalogos-compartilhados-de-subcategorias-e-tags.md) adota catálogos de subcategorias e tags, bases completas, arquivamento e pesquisa, com preservação financeira. Associação às transações e Desktop permanecem pendentes. Sem migration, dependência nova ou resolução de DP-01 a DP-04; homologações humanas pós-integração preservadas.

US-044 Desktop: [ADR-0057](adr/0057-categorias-no-desktop-sqlcipher.md) integra categorias ao SQLCipher com bases completas, 25 permissões e paridade nativa. Dependência Rust fixada aplica NFKC. Sem migration, mudança de backup ou decisão de prazo. DP-01 a DP-04, escrita cloud com versão/auditoria/outbox e homologação humana pós-integração preservadas.

US-044 compartilhada: [ADR-0056](adr/0056-categorias-compartilhadas-por-workspace.md) adota sugestões explícitas v1 em catálogo vazio, metadados com base completa e arquivamento sem exclusão. Sem migration ou dependência nova. Desktop, versão/auditoria/outbox e homologação humana mantêm seus gates; DP-01 a DP-04 preservadas.

US-043 Desktop: [ADR-0055](adr/0055-cartoes-e-pagamentos-no-desktop.md) adota cartão/pagamento local com paridade Rust, 23 permissões e revisão conjunta. Pagamento sem detalhamento não presume conciliação. Não muda schema, dependências ou prazos; DP-01 a DP-04 e homologação humana pós-integração preservadas. Próxima história US-044.

US-043 em andamento: [ADR-0054](adr/0054-pagamentos-de-cartao-compartilhados.md) compõe pagamento de cartão sobre revisões existentes. Transferência e pagamento têm sinais distintos; consumo permanece na compra. Desktop/importação/conciliação e cloud mantêm seus gates. Sem migration ou dependência nova; DP-01 a DP-04 e homologação humana pós-integração preservadas.

US-042 Desktop: [ADR-0053](adr/0053-transferencias-no-desktop-sqlcipher.md) adota leitura de grupos e comando conjunto SQLCipher, com 21 permissões de produto. O coordenador compartilhado recusa projeções parciais de membros existentes. Nenhum prazo ou enum pendente foi escolhido; DP-01 a DP-04 e homologação humana pós-integração permanecem.

US-042 compartilhada: [ADR-0052](adr/0052-transferencias-compartilhadas-atomicas.md) adota política de transferência e criação do grupo dentro do coordenador de revisões existente. Desktop é o próximo incremento. Não altera estados de grupo na exclusão, não resolve DP-01 a DP-04 e não antecipa homologação humana.

US-041 Desktop: [ADR-0051](adr/0051-movimentacoes-manuais-desktop.md) adota comandos específicos, leitura consistente e política nativa confrontada com o serviço compartilhado. Não resolve DP-01 a DP-04, outbox/feed cloud, paginação ou release. A homologação humana continua após integração completa (ADR-0044).

US-041 em andamento: [ADR-0050](adr/0050-politica-de-movimentacoes-manuais.md) adota política compartilhada sobre as revisões existentes, sem schema, dependência de produção ou IPC novo. Desktop/manual/ajuste em CT-03, campos e gestão de classificações posteriores, transport limitado e outbox/recibos cloud mantêm seus gates. Homologação humana segue ADR-0044; DP-01 a DP-04 preservadas.

US-040 local: [ADR-0049](adr/0049-contas-no-desktop-sqlcipher.md) integra contas/referências/conferência no Desktop SQLCipher com dois novos comandos específicos, 17 no total. Não altera schema ou dependências de produção. Limites de leitura recusam snapshots grandes sem truncar; paginação, versão monotônica/auditoria/outbox e escrita cloud permanecem nos respectivos gates. Próxima história US-041, movimentações manuais e ajuste identificado. Homologação humana segue diferida conforme ADR-0044. DP-01 a DP-04 preservadas; entradas abaixo são históricas.

US-040 em andamento: [ADR-0048](adr/0048-operacoes-compartilhadas-de-contas.md) adota a base compartilhada de contas/referências sem nova migration, dependência ou IPC. Base de metadados é comparada por valores; versão/linhagem, recibos, auditoria/outbox e escrita cloud permanecem pendentes. Próximo incremento integra Desktop, sem aguardar homologação humana por história. DP-01 a DP-04 e registros anteriores preservados.

US-036: [ADR-0047](adr/0047-multiplos-espacos-locais.md) implementa gestão de múltiplos espaços locais independentes sem cap comercial. Catálogo e troca usam o cofre nativo existente; nenhum novo schema, dependência ou IPC. Cloud autenticado permanece na US-095; homologação humana segue ADR-0044. Próxima história US-040. DP-01 a DP-04 e registros anteriores preservados.

US-035: [ADR-0046](adr/0046-restauracao-como-novo-workspace.md) integra restauração de produto em nova autoridade local, com prévia, IDs/chave/geração novos e repetição segura de confirmação. Não substitui espaços existentes ou reconecta cloud. Homologações humanas seguem diferidas conforme ADR-0044; próxima história US-036. As entradas abaixo preservam decisões anteriores.

Em 2026-10-17, o usuário determinou que homologações humanas serão feitas após integrar todo o sistema. [ADR-0044](adr/0044-homologacao-humana-apos-integracao.md) registra o avanço sem exigir essas confirmações por incremento. Windows Hello/US-033 continua com homologação interativa diferida, sem aprovação humana registrada; isso não bloqueia US-034 ou as histórias seguintes. Automação e gates de segurança continuam obrigatórios.

US-034: [ADR-0045](adr/0045-backup-criptografado-de-produto.md) implementa pacote de produto v1 autenticado, manifesto/schema/checksum, snapshot SQLCipher e senha independente, com seletor nativo estreito e publicação sem sobrescrita. Restauração em novo workspace pertence à US-035. Interação humana do seletor é diferida; G07-VAULT global, outras plataformas, distribuição, outbox e DP-01 a DP-04 mantêm seus escopos. Registros abaixo descrevem as decisões anteriores.

Complemento US-033 em 2026-10-17: [ADR-0043](adr/0043-windows-hello-local.md) implementa Windows Hello com consulta real de disponibilidade, interop desktop, opt-in/PIN e migração da política v1/v2. O host informa Available, que pode incluir PIN Windows; isso não comprova sensor ou autenticação biométrica. Testes automáticos não encerram a homologação interativa; pacote sintético preparado para confirmação pelo usuário. US-033 permanece com esse gate aberto. Próximo trabalho independente: US-034. Demais gates e DP-01 a DP-04 preservados. O registro abaixo descreve o incremento PIN anterior.

Avanço US-033 em 2026-10-17: [ADR-0042](adr/0042-bloqueio-local-por-pin.md) implementa o caminho PIN opcional em Windows x64, com liberação de chaves no Rust, bloqueio por foco/saída/reinício e espera persistida. Biometria é informada indisponível nesta versão e requer adapter/hardware homologados. PIN não substitui chave SQLCipher ou senha de backup. Backup/restore, outbox, distribuição e DP-01 a DP-04 permanecem nos seus gates.

Avanço US-032 em 2026-10-17: [ADR-0041](adr/0041-homologacao-cofre-produto.md) valida chave Windows, falhas do secret store, migrations interrompidas e journal quente no core SQLCipher de produto, preservando a política vigente de abertura/compatibilidade. Aceite da história atendido em Windows x64; G07-VAULT global mantém backup_manifest/restore em outra instalação, outbox e distribuição/plataformas pendentes. DP-01 a DP-04 permanecem abertas.

Avanço US-031 em 2026-10-17: [ADR-0040](adr/0040-workspace-local-anonimo.md) adota o mínimo SQLCipher/secret store necessário a criar/reabrir espaços de produto sem identidade cloud, com schema v2, staging e testes entre processos. Substitui apenas a ausência de IPC/persistência da US-030 por três comandos estreitos. Não encerra US-032/G07-VAULT ampliado, backup/restore, distribuição ou outras plataformas. DP-01 a DP-04 permanecem abertas.

Avanço US-030 em 2026-10-16: [ADR-0039](adr/0039-entrada-desktop-anonima.md) valida a entrada React/Vite + Tauri até início de WS-01 local, sem cadastro/identidade cloud. Não adota o schema do spike, não cria workspace persistente nem encerra cofre, login cloud, release assinado ou RF-01/FL-01 completos até painel. DP-01 a DP-04 permanecem abertas; a entrada não escolhe prazos offline ou papéis.

Avanço US-027 em 2026-10-16: [ADR-0038](adr/0038-suite-invariantes-cross-engine.md) valida as seis famílias em PostgreSQL/SQLite com roteiro comum, constraints e oráculos independentes. Não encerra todas as invariantes ERD, Native/cofre/iOS, autorização de produto, sync ou documentos. DP-01 a DP-04 seguem abertas; nenhuma duração ou enum conflitante foi escolhida.

Avanço US-026 em 2026-10-16: [ADR-0037](adr/0037-revisoes-financeiras-atomicas.md) valida revisão/versionamento atômico de movimentações e relações atuais em PostgreSQL/SQLite. Não encerra undo de import_batch, merge, feed/outbox/tombstone ou adoção Native/cofre. DP-01 a DP-04 permanecem abertas; grants de teste não definem prazo offline ou enum de papel.

Avanço US-025 em 2026-10-16: [ADR-0036](adr/0036-fixtures-financeiras-canonicas.md) valida FIN-002 v1 no PostgreSQL/SQLite, com totais esperados independentes. Não amplia o gate para Native/iOS nem encerra CT-08/CT-16 de produto ou US-027. DP-01 a DP-04 e as demais homologações permanecem abertas nos seus escopos.

Avanço US-024 em 2026-10-16: [ADR-0035](adr/0035-ports-e-repositories-por-modulo.md) adota Kysely 0.29.6 no adapter PostgreSQL após G07-QUERY real. Ports de leitura/backend aplicam workspace/conta; não autorizam engine/driver nativo, escrita financeira, policy engine ou handlers. DP-01 a DP-04 e os demais gates mantêm seus escopos. Não foi escolhido enum de papel.

Registro inicial de divergências encontradas na documentação v1.0. Nenhuma delas impede organizar o repositório; devem ser resolvidas antes da implementação afetada.

Avanço US-023 em 2026-10-16: [ADR-0034](adr/0034-uuidv7-e-politica-temporal.md) implementa UUIDv7/CSPRNG e codecs temporais nas plataformas disponíveis, com RFC, relógio fixo/regressivo, instâncias independentes e persistência. G07-IDS/TIME mantêm iOS pendente. G07-QUERY precede US-024; comandos de produto/cofre/restore permanecem em G07-VAULT. Nenhuma duração offline, retenção ou papel foi escolhida; DP-01 a DP-04 continuam abertas.

Avanço US-022 em 2026-10-16: [ADR-0033](adr/0033-migrations-dual-engine.md) valida histórico/checksum, up/down não destrutivo e recuperação após término de processos PostgreSQL/SQLite. G07-VAULT exige adoção nos hosts, backup_manifest/restore e snapshot protegido antes de migrations destrutivas. A função de compatibilidade não define a janela de clientes da API. DP-01 a DP-04 e G07-IDS/QUERY/JOBS/PDF seguem abertos nos seus escopos.

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
