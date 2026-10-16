# Registros de decisão de arquitetura

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
