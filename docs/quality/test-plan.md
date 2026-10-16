# Plano de testes

## Schema SQLite e equivalência — US-021

FIN-SCHEMA-001 contém 33 casos persistidos, executados em PostgreSQL/SQLite e nos bindings SQLCipher Windows/Android. Compara saldos/consumo/cartão, i64, datas/UTC, paginação, FKs, categoria/subcategoria, rateio completo/atômico/carry/INT64_MIN, histórico e normalização. Dez gates duais cobrem migração/FK/guard, dois escritores reais, reabertura, local sem identidade, RLS/logs/limpeza. [Dual](evidence/us-021-dual-engine-2026-10-16.json), [Windows](evidence/us-021-desktop-2026-10-16.json), [Android](evidence/us-021-android-2026-10-16.json), [guia](../development/sqlite-schema.md), [ADR-0032](../architecture/adr/0032-schema-sqlite-e-equivalencia.md).

Windows passou com SQLCipher 4.14.0/SQLite 3.51.3 e teste Cargo/Clippy. Android passou com SQLCipher 4.17.0/SQLite 3.53.3, SecureStore, APK/libs, reboot offline 5 → 6, reabertura e limpeza. Oito testes Node novos verificam geração/checksum, nome, corpus, falha/FK e evidências. iOS, CI remota, adoção no cofre/backup de produto e suíte ampla US-027 permanecem pendentes.

As mudanças de monorepo/CI motivaram novas execuções dos [quatro perfis Docker](evidence/us-014-environments-2026-10-16-us021.json), [12 gates DOM](evidence/us-016-dom-2026-10-16-us021.json) e [oito de flags](evidence/us-017-flags-2026-10-16-us021.json), mantendo os relatórios anteriores como histórico. Nenhuma evidência arquivada contém linha financeira, segredo ou log bruto.

pnpm check aprovado localmente com 216 testes Node, oito novos, sem testes ignorados, além de formatação, lint/fronteiras, contratos/geração/configuração, tipos e build. App sintético US-021 e emulador iniciado no turno foram removido/encerrado após a evidência; os sete documentos originais foram preservados.

## Schema físico PostgreSQL — US-020

pnpm schema:test passou em 20 gates PostgreSQL reais: migração interrompida/reaplicada/concorrente e checksum; roles/default deny; 12 tabelas/11 FKs compostas; seed autorizado; isolamento/contexto forjado; FKs cruzadas; checks/enums/obrigatoriedade; i64/overflow; DATE/UTC ms; nomes normalizados; subcategoria; rateio atômico/extremo e concorrência com lock observado; revisão/soft delete; referência/cartão; keyset/índices; DDL/TRUNCATE recusados; logs e limpeza. [Evidência](evidence/us-020-postgresql-2026-10-16.json), [guia](../development/postgresql-schema.md), [ADR-0031](../architecture/adr/0031-schema-inicial-postgresql.md).

Quatro testes Node verificam gates/hashes/escopo/limpeza e sanitização de falhas de conexão/rollback. O CRUD financeiro usa logins restritos e RLS ativa; bootstrap serve apenas a provisioning/inspeção. A autorização sintética do ensaio não conclui a policy engine ou escopo de contas de produto. Schema/migrations equivalentes SQLite, cross-engine, gerador UUIDv7, repositories/typed query e revisão automática mantêm suas histórias/gates.

Package/CI alterados motivaram novas execuções dos [quatro perfis Docker](evidence/us-014-environments-2026-10-16-us020.json), [12 gates DOM](evidence/us-016-dom-2026-10-16-us020.json) e [oito gates de flags](evidence/us-017-flags-2026-10-16-us020.json). Os relatórios anteriores permanecem históricos. CI postgres-schema configurada, execução remota deste incremento pendente.

pnpm check aprovado localmente com 208 testes Node, quatro novos, além de formatação, lint/fronteiras, contratos/configuração, tipos e build. Nenhum teste foi ignorado. Os sete documentos originais permanecem intactos.

## Cobertura do bootstrap

O bootstrap verifica sintaxe e tipos, formatação, links Markdown locais, compilação independente dos módulos e limites de dependência/importação. Os testes automatizados exercitam casos permitidos e proibidos do verificador estrutural.

A cobertura inicial isoladamente não valida comportamento financeiro, interfaces, banco de dados, criptografia, autenticação ou integração dos frameworks. Os incrementos abaixo registram as provas adicionais e seus limites.

## Flags e configuração da US-017

15 testes Node verificam cinco perfis desativados, parsing estrito, imutabilidade, allowlist ambiental, superfícies/autoridades, revisão/idempotência/rollback, falha com fechamento, autorização estrita e desligamento durante await. Modelos Web/Desktop/Mobile recusam rotas desativadas. Jobs são consultados ao executar; trabalho iniciado preserva seu resultado/erro. Um listener HTTP real recusa habilitação forjada pelo cliente e mantém a autorização separada.

O protocolo Chromium passou em oito gates: habilitar/desligar seção/operação; limpar rota/busca/cartões; manter o mesmo bundle; configuração pública/no-store; reload e recuperação por revisão superior; rejeitar origem externa; fechar opcionais após falha; Axe/ausência de storage, tráfego externo e erros. Browser/listener encerrados. [Evidência](evidence/us-017-flags-2026-10-16.json), [guia](../development/runtime-configuration.md), [ADR-0030](../architecture/adr/0030-flags-e-configuracao-por-ambiente.md).

Os 12 gates DOM foram reexecutados com [relatório atual](evidence/us-016-dom-2026-10-16-us017.json). Dois testes adicionais validam o histórico UI e a nova evidência de flags, com hashes atuais e escopo fechado. A reexecução dos quatro perfis Docker também possui [relatório atual](evidence/us-014-environments-2026-10-16-us017.json), preservando os três anteriores.

Integrações de handlers/roteadores/frameworks, distribuição remota e persistência de revisão permanecem pendentes. Native continua tipado; não há alegação de homologação em dispositivo. A CI ui-shell passa a executar ambos os protocolos; a execução remota deste incremento permanece pendente.

pnpm check passou localmente com 204 testes Node, 17 novos, além de formatação, lint/fronteiras, geração de contratos, configuração de ambientes/flags, tipos e build. Nenhum teste foi ignorado e os sete documentos originais foram preservados.

## Tokens e shells da US-016

12 testes Node novos verificam versionamento/imutabilidade, contraste, escala/alvos, contexto local/cloud, estados, snapshot, SSR sem conteúdo antigo e escape de texto. Três testes verificam a evidência contra hashes atuais, gates obrigatórios, limpeza, datas e limites. A tipagem inclui NativeShell/NativeShellExample e o host DOM de demonstração.

O protocolo pnpm ui:check passou em 12 gates Chromium reais: navegação/foco por teclado, skip link, seis estados e status, Axe sem violações nos seis estados avaliados, retry, limpeza de busca/rota na troca de espaço, Web cloud, reflow 320/375/768 com nome longo, fonte raiz a 200%, forced-colors e ausência de storage/egress/erro de script. Browser/listener encerrados, capturas sintéticas ignoradas. [Evidência](evidence/us-016-dom-2026-10-16.json), [guia](../development/design-system.md), [ADR-0029](../architecture/adr/0029-design-tokens-e-shells.md).

O resultado não declara conformidade WCAG completa: testes humanos com leitor de tela, zoom em outros modos, runtimes Native e integrações Next.js/Vite/Tauri continuam pendentes. O novo job ui-shell executa o protocolo DOM no Ubuntu; quality mantém unitários/tipos no Windows/Linux. Execução remota deste incremento pendente.

pnpm check aprovado localmente com 187 testes, 15 novos, além de tipos DOM/Native/host, lint/fronteiras, formatação, contratos/configuração e build. Mudanças de package/lockfile/CI motivaram a reexecução completa dos quatro ambientes Docker, que passou com limpeza e [evidência atual](evidence/us-014-environments-2026-10-16-us016.json), preservando o histórico.

## Observabilidade base da US-015

17 testes novos executam a API pública compilada: emissão desativada por padrão, allowlist e tipos de metadados, snapshot, erros/stack/causas, getters/Proxy, códigos e nomes fechados, sink falho, encerramento, 32 operações concorrentes, propagação interna explícita e reinício em entrada pública/headers inválidos. HTTP loopback real e worker Node em processo independente demonstram um trace/request comum entre request/job/sync/db, com spans e parentesco distintos. As saídas das duas partes são verificadas contra canários sintéticos; nenhuma saída bruta é salva. Listener e processo são encerrados.

O gate pnpm check inclui a suíte na CI quality existente para Windows/Linux. O teste db.query não executa SQL e o worker não usa fila persistente. O resultado não homologa middleware NestJS/Next.js, runtimes nativos, collector, fornecedor externo ou política operacional de retenção/acesso. [Guia](../development/observability.md), [ADR-0028](../architecture/adr/0028-observabilidade-com-scrub.md). US-166 continua aberta para as integrações futuras.

pnpm check aprovado localmente com 172 testes Node, 17 novos, além de formatação, lint/fronteiras, contratos, configuração, tipos e build. Execução remota deste incremento pendente.

## Ambientes sintéticos da US-014

O protocolo pnpm env:stack:test passou em quatro perfis Docker reais, 12 gates por perfil e sete transversais: imagens/dono, rede/portas, tmpfs, credenciais, SQL/marcador/roles, TLS, OIDC/JWKS, Mailpit, logs, senha/CA cruzadas, repetição, recriação e limpeza após startup parcialmente falho por porta ocupada. A stack é gerada e não lê overrides ambientais. O teste exclusivo recusa tomar instância do desenvolvedor. [Guia](../development/environments.md), [ADR-0027](../architecture/adr/0027-ambientes-docker-reproduziveis.md) e [evidência sanitizada](evidence/us-014-environments-2026-10-16.json).

14 testes Node novos verificam configuração inválida, pins, portas, parâmetros/caminhos, junction, isolamento do ambiente de processo, locks e metadados/fonte/limpeza da evidência. pnpm check passou com 155 testes e env:stack:check no lint. Esses unitários não iniciam Docker. Novo job environment-stack em Ubuntu executa o protocolo real, com down em todos os perfis no always; execução remota pendente. Não há prova de API de produto, topologia SaaS completa, armazenamento de objetos ou staging remoto.

Após a US-015 alterar o lockfile, o protocolo completo passou novamente: [evidência atual](evidence/us-014-environments-2026-10-16-us015.json). O relatório anterior permanece como histórico. O gate exige hashes atuais na nova execução e valida formato, gates e metadados do relatório histórico sem compará-lo a fontes posteriores.

## Contratos e clientes da US-012

26 testes novos exercitam os parsers/SDK compilados e a fonte OpenAPI: i64 textual, UUID/data/instante, headers e Idempotency-Key obrigatórios, campos indevidos, escopo, período, paginação, snapshot antes de await, CSRF/sessão, mensagens seguras, rede sem retry e geração reproduzível. O teste HTTP real usa os clientes Web/Desktop/Mobile exportados, peer loopback sintético e Fetch Node, incluindo recusa de redirect. Listener encerrado e fixtures somente em memória. Contratos negativos de tipos verificam campos obrigatórios, MoneyMinor, readonly e criação unitária sem transferência.

pnpm check passou localmente com 141 testes, além de tipos, lint/fronteiras, formatação, build e contracts:check. A CI quality existente inclui o gate de geração em Windows/Linux; execução remota pendente. [Protocolo e limites](../development/api-contracts.md), [ADR-0026](../architecture/adr/0026-contratos-openapi-e-clientes.md). Não há prova de autorização/RLS, idempotência persistente, API de produto ou execução do SDK em navegador/Tauri/Expo.

## Núcleo puro da US-013

35 testes comportamentais novos executam a API pública compilada de domain, com FIN-001 compartilhada por test-fixtures: precisão acima de 2^53, extremos i64/overflow, JSON textual canônico, rateios, referência no início/fim do dia, exclusão de staging/deleted, cobertura incompleta, escopo, moeda, consolidação, planos compostos, pagamento parcial/crédito de cartão, períodos e estornos. Totais mensais são golden values escritos independentemente dos cálculos. Testes de tipos rejeitam Number, strings não validadas e mutação de plano. [API, cenário e comandos](../development/domain-core.md); [ADR-0025](../architecture/adr/0025-nucleo-monetario-puro.md).

pnpm test constrói os módulos antes de importar seus exports, inclusive sem dist prévio. Na entrega da US-013, pnpm check passou com 115 testes Node, formatação, lint/fronteiras, tipos e build. Esta prova é do núcleo puro: atomicidade em banco, equivalência financeira PostgreSQL/SQLCipher, autorização, UI e runtimes nativos continuam nas histórias específicas. A CI quality já chama o mesmo comando em Windows/Linux; execução remota desse incremento pendente.

## Preparação da US-001

O pnpm test também verifica o diagnóstico Desktop: detecção de WebView2 por usuário, rejeição de registros inválidos, target Rust incorreto, inventário indisponível, falha/timeout de compilação, falha de execução e limpeza dos temporários. Esses testes usam respostas sintéticas de ferramentas, sem exigir SDKs nativos, e fazem parte do comando executado pela CI Windows/Linux.

O comando pnpm env:check --desktop faz a verificação real de ferramentas no Windows x64 e compila, vincula e executa um probe Rust temporário. Esse diagnóstico sozinho não comprova integração dos frameworks ou criptografia.

## Integração nativa da US-001

pnpm spike:desktop:check executa fmt, Clippy, testes Rust, build Tauri e smoke real de WebView/IPC. O job desktop-vault da CI Windows possui esse gate separado do pnpm check TypeScript; execução remota ainda pendente. O [protocolo](../development/spikes/us-001-desktop-vault.md) e o [estado](../delivery/status.md) registram evidência local e ambiente.

Os testes usam SQLCipher real, fixtures sintéticas com extremos i64 e Windows Credential Manager. Cobrem cofre sem/chave incorreta, falta/negação de chave, isolamento por instalação, journal, migration atômica, envelope autenticado, limites e schema hostil. Testes entre processos removem a origem, simulam término abrupto antes/depois da persistência da chave e reabrem a instalação para limpar staging/credenciais órfãs. Preservação do cofre existente é verificada byte a byte.

O smoke Tauri chama apenas comandos sintéticos sem parâmetros de SQL, arquivos ou chaves. A [homologação em outra instalação](../development/spikes/us-001-homologation.md) passou entre o host e uma VM Windows 11 independente, incluindo recuperação da chave após reiniciar o Windows e smoke real da WebView. A [evidência](evidence/us-001-windows-vm-2026-10-13.json) registra hashes, versões e timestamps; dois testes de metadados rejeitam relatório anterior ao reboot ou sem confirmação de persistência. Essa cobertura não entrega os fluxos BK-01/02 nem o schema definitivo do produto.

## Cobertura a implementar

A US-007 registra a [matriz física e os gates pendentes](../development/spikes/us-007-physical-decisions.md). O probe SQLite real passou em nove verificações de migração, UUID, FK, datas/instantes, decimal textual, rollback e reabertura: [evidência](evidence/us-007-physical-2026-10-16.json). A suíte Node contém 80 testes; os quatro novos cobrem codecs, execução do probe e metadados. A suíte executada por quality em Windows/Linux inclui SQLite real. Esse resultado não equivale a SQLCipher, equivalência financeira PostgreSQL/SQLite ou aprovação dos candidatos typed-query/fila/PDF.

A US-006 foi validada como spike com [protocolo/catálogo](../development/spikes/us-006-parsers.md) e [evidência](evidence/us-006-parsers-2026-10-16.json). As 17 verificações reais exercitam nove processos de benchmark, 10 mil registros por ensaio, corpus hostil, staging atômico, cancelamento e interrupção sem alterar saldo. A suíte Node contém 76 testes; os 22 novos cobrem dinheiro/data/sinal, layouts, erros, candidatos, persistência/migração e integridade da evidência. CI parser-spike configurada para Windows/Linux; execução remota pendente. Essa prova computacional não homologa UI, cofre nativo de staging ou confirmação/reversão financeira.

A US-005 foi validada como spike com [protocolo](../development/spikes/us-005-sync.md) e [evidência](evidence/us-005-sync-2026-10-16.json). As 22 verificações usam PostgreSQL real e processos clientes independentes com filas em disco: desconexão/reinício abrupto, perda de ACK, idempotência e reenvio concorrente, merge, conflito base/local/remoto e resolução auditada, exclusão, paginação, rollback de dados/cursor, revogação e geração. A suíte Node contém 54 testes; os 15 novos verificam contrato, persistência e evidência. CI two-client-sync configurada, execução remota pendente. Integração nativa SQLCipher, UI, lease e purga de produto não são comprovadas por este recorte.

A US-004 foi validada como spike com [protocolo](../development/spikes/us-004-postgresql-rls.md) e [evidência PostgreSQL](evidence/us-004-postgresql-2026-10-15.json). As 20 verificações reais cobrem RLS forçada, grants, contexto ausente/inválido, CRUD/INT64, queries sem filtros, escopo por conta, exportação, FK composta, revogação, prepared statement, reutilização/rollback, 48 requests concorrentes, savepoint e conexão interrompida. Nenhuma prova de isolamento usa mock de banco. A suíte Node passa a conter 39 testes; os oito novos exercitam lifecycle do adapter e validação da evidência. CI postgres-rls configurada, execução remota pendente.

A US-003 possui [protocolo OIDC local](../development/spikes/us-003-oidc.md) com Keycloak/Mailpit reais e Chromium. Unitários exercitam consumo/expiração de sessão, cookies e fronteiras do callback/identidade; a homologação exercita o grant real, e-mail, recovery, CSRF, renovação, logout, PKCE, assinatura adulterada e rejeições. Google, Apple e integrações nativas/Next.js permanecem pendentes; esse recorte não encerra a história.

O recorte local passou em 2026-10-15: [evidência sanitizada](evidence/us-003-local-2026-10-15.json), 15 verificações e teardown confirmado. A suíte Node contém 31 testes. A evidência não contém identidade, senha, token, código de autorização ou link de recuperação.

A US-002 possui [protocolo próprio](../development/spikes/us-002-mobile-vault.md), unitários de INT64/relatórios e typecheck Expo. A homologação de SQLCipher/SecureStore depende de build nativo e execução em cada plataforma. Prebuild ou typecheck aprovados não encerram o teste de segurança. O instrumento prepara dados sintéticos, reabre após reinício e limpa seus próprios artefatos.

Android passou no emulador AOSP Android 16/API 36 x86_64: [evidência sanitizada](evidence/us-002-android-2026-10-15.json), com SQLCipher 4.17.0 community, bibliotecas de runtime conferidas no APK, três fases nativas e reinício completo sem rede. iOS segue pendente; nenhum resultado Android é usado para encerrar essa homologação. pnpm test contém 25 testes, incluindo regressão para OpenSSL ausente ou empacotado no ABI errado.

Os critérios de aceite do [PRD](../product/01-prd.md), do [backlog](../delivery/05-backlog.md) e os gates do [plano](../delivery/06-implementation-plan.md) orientam os testes:

- Precisão monetária e decimal, saldo de contas e cartões, transferências e relatórios.
- Importação, deduplicação, atomicidade, idempotência, reversão e descarte de originais.
- Extração fiscal, busca por itens e conciliação N:N.
- Autorização, RLS e vazamento entre workspaces e escopos de conta.
- Sync entre clientes, conflitos, revogação e expiração do offline.
- Backup criptografado, corrupção, restauração, migração e retenção.
- Fluxos Desktop, Web e Mobile, acessibilidade e builds nativos.

Cada história deve registrar quais testes foram executados e limitações. Os spikes W0 devem produzir evidências reproduzíveis, especialmente para INT64, criptografia, RLS, OIDC, sync e volume de importação.
