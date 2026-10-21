# Registros de decisão de arquitetura

[0068 — Central compartilhada de importações](0068-central-compartilhada-de-importacoes.md): preparação idempotente, leitura consistente por lote, contas autorizadas e ledger v3 opt-in com downgrade vazio. Ativação Desktop junto de backup/restauração no próximo incremento.

[0067 — Contrapartes no Desktop](0067-contrapartes-no-desktop.md): cadastro e associação explícita ao SQLCipher, projeção mínima na transação, paridade Rust/TypeScript, grupos completos e intenções congeladas. Próximo incremento US-050.

[0064 — Editor de rateios no Desktop](0064-editor-de-rateios-no-desktop.md): comando específico, soma exata, parcelas/IDs/notas, validação conjunta de grupos e revisão SQLCipher; próximo incremento US-047.

[0063 — Rateios versionados compartilhados](0063-rateios-versionados-compartilhados.md): intenções KEEP/CLEAR/REPLACE, soma exata com intermediários amplos e revisão atômica; editor Desktop é o próximo incremento.

[0062 — Editor versionado de classificação no Desktop](0062-editor-versionado-de-classificacao-no-desktop.md): novo comando específico, planejador/gravador de revisões reutilizados, grupos completos, referência ativa e intenção congelada; próximo incremento US-046.

[0061 — Filtros de classificação no Desktop](0061-filtros-de-classificacao-no-desktop.md): snapshot SQLCipher completo com catálogo, opção explícita no comando de leitura existente, filtros puros deduplicados e detalhes preservados; editor sobre revisões é o próximo incremento da US-045.

[0060 — Catálogos de subcategorias e tags no Desktop](0060-catalogos-de-subcategorias-e-tags-no-desktop.md): Configurações, planos nativos SQLCipher, 27 comandos, ACK validado e intenção congelada; editor financeiro e filtros são o próximo incremento da US-045.

[0059 — Associação versionada de classificação](0059-associacao-versionada-de-classificacao.md): categorias/subcategorias/tags sobre revisão-base e histórico existentes, referências validadas na transação e filtros puros sem duplicar transações; integração Desktop e leitura completa autorizada permanecem pendentes.

[0058 — Catálogos de subcategorias e tags](0058-catalogos-compartilhados-de-subcategorias-e-tags.md): política pura, autorização por workspace, busca, reordenação de filhos e arquivamento em PostgreSQL/SQLite; associação financeira e Desktop são incrementos seguintes.

[0055 — Cartões e pagamentos no Desktop](0055-cartoes-e-pagamentos-no-desktop.md): leitura coerente e pagamento conjunto SQLCipher, 23 comandos estreitos, UI de dívida/crédito e dados transitórios; importação/conciliação permanece pendente.

[0054 — Pagamentos de cartão compartilhados](0054-pagamentos-de-cartao-compartilhados.md): par ASSET/CREDIT_CARD, dívida/caixa separados de consumo, revisões e rollback atômicos; US-043 em andamento até Desktop/conciliação.

[0050 — Política de movimentações manuais](0050-politica-de-movimentacoes-manuais.md): comandos de intenção sobre revisões autorizadas, base inteira/conta atual, exclusão reversível, rateio preservado e ajuste separado; US-041 em andamento até Desktop.

[0049 — Contas no Desktop SQLCipher](0049-contas-no-desktop-sqlcipher.md): snapshot consistente, dois comandos estreitos, planos Rust conferidos com Domain e UI com dinheiro exato; aceite local US-040, próxima US-041.

[0048 — Operações compartilhadas de contas](0048-operacoes-compartilhadas-de-contas.md): criação atômica, base explícita, arquivamento e referências preservadas, com leitura de saldo em snapshot; US-040 em andamento, integração Desktop pendente.

[0047 — Múltiplos espaços locais](0047-multiplos-espacos-locais.md): catálogo nativo completo, novas intenções independentes, retry imutável e descarte da tela anterior; cloud autenticado e homologação humana integrada mantêm seus gates.

[0046 — Restauração como novo workspace](0046-restauracao-como-novo-workspace.md): seleção nativa, segredo, prévia em staging, novas identidades/chave/geração e confirmação idempotente; homologações humanas pós-integração.

[0045 — Backup criptografado de produto](0045-backup-criptografado-de-produto.md): snapshot SQLCipher, manifesto autenticado, senha independente, seletor Windows estreito e publicação sem sobrescrita; US-035 e homologação humana diferidas.

[0044 — Homologação humana após integração](0044-homologacao-humana-apos-integracao.md): instrução do usuário para continuar desenvolvimento/automação sem aguardar confirmações humanas por incremento, preservando os testes diferidos.

[0043 — Windows Hello local](0043-windows-hello-local.md): adapter desktop real, opt-in com PIN, migração da política e descarte de consentimento atrasado; autenticação interativa pendente.

[0042 — Bloqueio local por PIN](0042-bloqueio-local-por-pin.md): sessão opcional protegida no Rust/Windows, falhas sem rekey, bloqueio por foco e espera persistida; biometria pendente.

[0041 — Homologação do cofre de produto](0041-homologacao-cofre-produto.md): aceite US-032 Windows, falhas de secret store, migrations interrompidas e journal quente; backup/restore e G07-VAULT global pendentes.

[0040 — Workspace local anônimo](0040-workspace-local-anonimo.md): criação/reabertura no schema de produto com staging, três comandos e proteção mínima SQLCipher/Windows; G07-VAULT ampliado segue aberto.

[0039 — Entrada Desktop anônima](0039-entrada-desktop-anonima.md): React/Vite + Tauri sem privilégios, EN-01 até modo local e testes Chromium/WebView2; criação/cofre/cloud seguem pendentes.

[0038 — Suíte de invariantes cross-engine](0038-suite-invariantes-cross-engine.md): seis famílias financeiras testadas com estado/auditoria comparados, oráculo independente e propriedades reproduzíveis PostgreSQL/SQLite.

[0037 — Revisões financeiras atômicas](0037-revisoes-financeiras-atomicas.md): agregado versionado nas duas engines, conflitos explícitos e reversão por nova revisão; fluxos de produto/sync/Native pendentes.

[0036 — Fixtures financeiras canônicas](0036-fixtures-financeiras-canonicas.md): FIN-002 versionado, snapshots/goldens iguais PostgreSQL/SQLite e vetor preparatório para documentos.

[0035 — Ports e repositories por módulo](0035-ports-e-repositories-por-modulo.md): G07-QUERY validado; leituras PostgreSQL por workspace/conta e verificação de fronteiras. Escritas, policy engine/HTTP e adapters nativos pendentes.

[0034 — UUIDv7 e política temporal](0034-uuidv7-e-politica-temporal.md): codecs e geradores por plataforma, com CSPRNG e relógio separado de regras de negócio; iOS/integração de produto pendentes.

[0033 — Migrations dual-engine](0033-migrations-dual-engine.md): framework validado em PostgreSQL/SQLite com interrupções de processo; adoção nativa/cofre e mudanças destrutivas pendentes.

[0032 — Schema SQLite e equivalência persistida](0032-schema-sqlite-e-equivalencia.md): fundação validada nos casos homologados em PostgreSQL/SQLite e SQLCipher Windows/Android; cofre de produto e iOS pendentes.

[0031 — Schema financeiro inicial PostgreSQL](0031-schema-inicial-postgresql.md): adotado para a US-020, com migração/constraints validadas; policy engine, repositories e cross-engine pendentes.

A [arquitetura técnica](../04-technical-architecture.md) contém o registro original ADR-001 a ADR-015, incluindo propostas ainda sujeitas a validação. Esses números ficam reservados; a existência na tabela não implica que todos tenham sido aprovados.

Novos registros usam arquivos numerados a partir de 0016 e o [template](0000-template.md). Declare status, escopo, histórias, alternativas, consequências e evidência. Um ADR só substitui uma decisão anterior no escopo explicitamente indicado.

| ADR                                                                                   | Status                                                        | Escopo                                                    |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| [0016 — Bootstrap do repositório](0016-bootstrap-do-repositorio.md)                   | Adotado para o bootstrap                                      | Organização e ferramentas iniciais                        |
| [0017 — Cofre Desktop experimental](0017-spike-cofre-desktop.md)                      | Validado como spike, incluindo outra instalação Windows       | SQLCipher, Credential Manager e backup US-001             |
| [0018 — Homologação em VM Docker](0018-homologacao-desktop-vm-docker.md)              | Homologação executada e aprovada                              | Windows 11 independente para US-001                       |
| [0019 — Cofre Mobile experimental](0019-spike-cofre-mobile.md)                        | Android validado como spike; iOS pendente                     | Expo, SQLCipher, SecureStore e INT64 US-002               |
| [0020 — Identidade OIDC local](0020-spike-identidade-oidc-local.md)                   | Recorte local validado; sociais e runtimes pendentes          | IdP separado, BFF HTTPS e protocolo PKCE US-003           |
| [0021 — Isolamento PostgreSQL RLS](0021-spike-isolamento-postgresql-rls.md)           | Validado como spike; integração ao produto pendente           | RLS, contexto transacional e pool US-004                  |
| [0022 — Sincronização entre dois clientes](0022-spike-sincronizacao-dois-clientes.md) | Validado como spike; integração ao produto pendente           | Fila durável, feed, tombstones e conflitos US-005         |
| [0023 — Parsers OFX/CSV e benchmark](0023-spike-parsers-ofx-csv.md)                   | Validado como spike; integração ao produto pendente           | Staging, normalização e benchmark 10k US-006              |
| [0024 — Consolidação física e gates](0024-consolidacao-fisica-e-gates.md)             | Propostas consolidadas; aprovação/adoção por gate pendentes   | Seis decisões físicas, representações e pendências US-007 |
| [0025 — Núcleo monetário puro](0025-nucleo-monetario-puro.md)                         | Adotado no núcleo; integrações pendentes                      | MoneyMinor, saldos, transferências e cartões US-013       |
| [0026 — Contratos OpenAPI e clientes](0026-contratos-openapi-e-clientes.md)           | Adotado na fundação; servidor/runtimes pendentes              | OpenAPI, tipos, validação e SDK US-012                    |
| [0027 — Ambientes Docker reproduzíveis](0027-ambientes-docker-reproduziveis.md)       | Fundação Docker local validada; topologia de produto pendente | Local/CI/integration/staging sintéticos US-014            |
| [0028 — Observabilidade com scrub](0028-observabilidade-com-scrub.md)                 | Fundação Node validada; frameworks/coleta remota pendentes    | Correlação, spans manuais e JSON com allowlist US-015     |
| [0029 — Tokens e shells DOM/Native](0029-design-tokens-e-shells.md)                   | DOM validado; Native tipado com homologação pendente          | Tokens versionados, estados e exemplos acessíveis US-016  |
| [0030 — Flags e configuração](0030-flags-e-configuracao-por-ambiente.md)              | Fundação validada; integração de produto pendente             | Configuração pública, revisão e gates em execução US-017  |

[0051 — Movimentações manuais Desktop](0051-movimentacoes-manuais-desktop.md): adotado no Desktop local US-041; testes automatizados locais, homologação humana pós-integração.

[0052 — Transferências compartilhadas atômicas](0052-transferencias-compartilhadas-atomicas.md): adotado no núcleo US-042; integração Desktop pendente.

[0053 — Transferências Desktop SQLCipher](0053-transferencias-no-desktop-sqlcipher.md): adotado no Desktop local US-042; homologação humana pós-integração.

[0056 — Categorias compartilhadas por workspace](0056-categorias-compartilhadas-por-workspace.md): adotado no núcleo US-044; integração Desktop pendente.

[0057 — Categorias no Desktop SQLCipher](0057-categorias-no-desktop-sqlcipher.md): adotado no Desktop local US-044; homologação humana pós-integração.
