# Estado do projeto

## Desktop — US-030: entrada local integrada e validada — 2026-10-16

A primeira entrada de produto React/Vite + Tauri apresenta Continuar sem conta como ação principal, com Entrar/Criar conta visíveis e indisponíveis nesta etapa. A escolha local chega ao início de WS-01 sem credencial, ID ou usuário cloud, funciona offline, conserva o modo após mudar a rede e permite voltar/repetir sem efeitos persistentes. O destino informa que criação de espaços ainda está indisponível; a US-031 implementará essa persistência. [Guia](../development/desktop-entry.md), [ADR-0039](../architecture/adr/0039-entrada-desktop-anonima.md).

Os [12 gates Chromium](../quality/evidence/us-030-entry-browser-2026-10-16.json) e [nove Windows/WebView2](../quality/evidence/us-030-entry-windows-2026-10-16.json) passaram com assets Vite reais/embutidos: teclado/foco, axe, reflow/texto 200%, cores forçadas, boot offline, ida/volta e ausência de identidade/egress/storage. Native executou fmt, Clippy com warnings negados e builds locked de produto/teste. Seu sinal offline/IO foi injetado sem desligar rede do SO; perfil temporário foi removido após a WebView liberar handles. O binário padrão não registra handler de teste, concede zero permissões e não adota o schema experimental do spike.

pnpm check passou com 277 testes Node, sem skips, formatação, lint/fronteiras/geração, tipos e build; 19 workspaces e 94 Markdown. Passaram novamente os [quatro perfis Docker](../quality/evidence/us-014-environments-2026-10-16-us030.json), [12 gates DOM](../quality/evidence/us-016-dom-2026-10-16-us030.json), [oito de flags](../quality/evidence/us-017-flags-2026-10-16-us030.json), [22 de repositories](../quality/evidence/us-024-repositories-2026-10-16-us030.json), [12 de fixtures](../quality/evidence/us-025-fixtures-2026-10-16-us030.json), [28 de revisões](../quality/evidence/us-026-revisions-2026-10-16-us030.json) e [50 de invariantes](../quality/evidence/us-027-invariants-2026-10-16-us030.json) com fontes atuais. Relatórios anteriores preservados como históricos, sem reescrever hashes. Bancos, senhas, contêineres/redes próprios e perfil de homologação removidos. CI nova configurada, sem afirmar execução remota.

Vite 8.3.4 é ferramenta de build; react-dom 19.3.0 passa a dependência explícita para montar React. O novo crate reutiliza versões Tauri/tauri-build fixadas no spike, com lock próprio; dynamic ACL/serde de homologação ficam na feature de teste. Não houve alteração financeira de schema/dados, deploy ou release assinado. Aceite US-030 até modo local atendido; RF-01/FL-01 até painel, criação/cofre, cloud, assinatura/updater, leitor de tela manual e plataformas adicionais seguem nos seus gates. DP-01 a DP-04 e sete originais preservados. Próxima história: US-031, criar workspace local anônimo.

## Fundação — US-027: invariantes validadas em PostgreSQL/SQLite — 2026-10-16

FIN-INVARIANTS-001 v1 atende as seis famílias de aceite: transferências, rateios, cartão, saldo, reversão e exclusão. O roteiro executa os mesmos comandos nos adapters reais e compara o estado lógico das 12 tabelas por workspace depois de cada sucesso/rejeição. Snapshots antes/depois, versões e histórico são conferidos; rejeições/no-op preservam o estado inteiro. Redutor BigInt independente de Domain, nove checkpoints literais e 24 vetores limitados de ida/volta verificam resultados. [Guia](../development/cross-engine-invariants.md), [ADR-0038](../architecture/adr/0038-suite-invariantes-cross-engine.md).

Os [50 gates reais](../quality/evidence/us-027-invariants-2026-10-16.json) passaram com PostgreSQL 18.6/SQLite 3.53.3, migrations v2 e FIN-002 preservado: 43 cenários compartilhados, dois corpus de 33 casos de schema, geração/migrations, reabertura, logs e limpeza. Há rejeição de subcategoria/soma inválida, perna parcial, edição cruzada, base obsoleta e reversão superada. Rateio de MIN_INT64 em MAX_INT64 + 1 e falha específica no COMMIT diferido comprovam precisão e rollback. IDs/relógio determinísticos ficam exclusivamente no instrumento sintético; produção mantém CSPRNG.

pnpm check passou com 274 testes Node, sem skips, formatação, lint/fronteiras/geração, tipos e build. São 19 workspaces e 92 Markdown. Os [quatro perfis Docker](../quality/evidence/us-014-environments-2026-10-16-us027.json), [12 gates DOM](../quality/evidence/us-016-dom-2026-10-16-us027.json), [oito de flags](../quality/evidence/us-017-flags-2026-10-16-us027.json), [22 de repositories](../quality/evidence/us-024-repositories-2026-10-16-us027.json), [12 de fixtures](../quality/evidence/us-025-fixtures-2026-10-16-us027.json) e [28 de revisões](../quality/evidence/us-026-revisions-2026-10-16-us027.json) passaram novamente com fontes atuais. Evidências anteriores preservadas como históricas. Bancos/journals, senhas, contêineres e redes próprios removidos. CI configurada; execução remota deste incremento e Native não executadas.

Não houve dependência externa nova, alteração de schema, dados reais ou deploy. O aceite do núcleo US-027 foi atendido; isso não encerra todas as invariantes ERD I-01 a I-18, CT-08/CT-16 completos, policy engine/HTTP, undo de importação, outbox/feed/tombstone/idempotência ou Native/cofre/iOS. DP-01 a DP-04 e os sete documentos originais permanecem preservados. Próxima história: US-030, tela de entrada Desktop com Continuar sem conta.

## Fundação — US-026: revisões atômicas validadas nas duas engines — 2026-10-16

domain/revisions e finance-ports/revisions implementam plano/coordenador puros, com base/versão i64 em strings, snapshot v1 antes/depois e ator do contexto confiável. PostgreSQL/Kysely e SQLite persistem movimentação, rateios, tags e revisão na mesma transação; grupos exigem as duas pernas. Base obsoleta falha, no-op conserva versão e reversão exige a revisão atual, produzindo nova versão. Criação usa base 0/versão 1; desfazê-la faz exclusão lógica. [Guia](../development/financial-revisions.md), [ADR-0037](../architecture/adr/0037-revisoes-financeiras-atomicas.md).

Os [28 gates reais](../quality/evidence/us-026-revisions-2026-10-16.json) passaram em PostgreSQL 18.6/SQLite 3.53.3 com FIN-002/migrations v2: nove cenários por engine e dez transversais. Há provas de rollback na segunda revisão de transferência e após encerrar backend PostgreSQL, versões acima de 2^53/limite i64, conflito concorrente, histórico imutável, relógio regredindo, reabertura, local sem usuário cloud, revogação no worker, nesting, logs e limpeza. Quatorze testes Node novos cobrem plano, captura, escopos, limites, adapter e evidência. Um lote de 65 alterações permanece em uma unidade; o teto explícito é 10000, com rejeição integral antes de storage. Não há benchmark de 10 mil gravações nesta história.

pnpm check passou com 267 testes Node, sem skips, além de formatação, lint/fronteiras/geração, tipos negativos e build. São 19 workspaces e 90 Markdown. Os [quatro perfis Docker](../quality/evidence/us-014-environments-2026-10-16-us026.json), [12 gates DOM](../quality/evidence/us-016-dom-2026-10-16-us026.json), [oito de flags](../quality/evidence/us-017-flags-2026-10-16-us026.json), [22 de repositories](../quality/evidence/us-024-repositories-2026-10-16-us026.json) e [12 de fixtures](../quality/evidence/us-025-fixtures-2026-10-16-us026.json) passaram novamente com hashes atuais. Relatórios anteriores preservados como históricos, sem edição manual de hashes; produtores/relatórios novos mantêm validação estrita. Bancos/journals, senhas, contêineres e redes próprios foram removidos. CI configurada, execução remota deste incremento e Native não executadas.

Nenhuma biblioteca externa ou alteração de schema foi adicionada. storage-schema agora depende internamente de domain/finance-ports para compartilhar as regras. Os grants/policies adicionais são exclusivos dos testes; produto permanece default deny. API/worker têm factories internas, sem novo handler/seed de produto. Fluxos de importação/conflito, policy engine, recibo/feed/outbox/tombstone e adoção Native/cofre seguem nas histórias/gates próprios; não se declaram RF-14/29/30/31 ou US-027 completos. DP-01 a DP-04 e os sete originais foram preservados. Próxima história: US-027, suíte de invariantes cross-engine.

## Fundação — US-025: dataset canônico validado nas duas engines — 2026-10-16

FIN-002 v1 entrega 41 registros sintéticos nas 12 tabelas, dois workspaces e goldens literais de sete saldos, dois resumos, dois patrimônios e duas somas de rateio. A fonte determinística gera JSON portátil e export TS profundamente imutável no pacote test-fixtures, sem dependência nova de produção. FIN-001/FIN-SCHEMA-001 e os sete documentos originais permanecem preservados. [Guia](../development/canonical-fixtures.md), [ADR-0036](../architecture/adr/0036-fixtures-financeiras-canonicas.md).

O [protocolo real](../quality/evidence/us-025-fixtures-2026-10-16.json) passou nos 12 gates com PostgreSQL 18.6/SQLite 3.53.3 e migrations v2: mesmos snapshots por workspace, goldens sobre dados relidos, precisão i64, referências de início/fim do dia, rollback parcial, recusa de duplicata sem overwrite, RLS sem WHERE/contexto forjado, reabertura, logs e limpeza. Nove testes Node novos cobrem dados, geração, freeze, grupos, parâmetros, SQLite, vetor preparatório e evidência. O job canonical-fixtures está configurado; execução remota deste incremento pendente.

pnpm check passou com 253 testes Node, sem skips, além de formatação, lint/fronteiras/geração, tipos e build. São 19 workspaces e 88 Markdown. Os [quatro perfis Docker](../quality/evidence/us-014-environments-2026-10-16-us025.json), [12 gates DOM](../quality/evidence/us-016-dom-2026-10-16-us025.json), [oito de flags](../quality/evidence/us-017-flags-2026-10-16-us025.json) e [22 de repositories](../quality/evidence/us-024-repositories-2026-10-16-us025.json) passaram novamente com hashes atuais. Evidências anteriores preservadas; bancos/journals, senhas, contêineres e redes próprios removidos. Não houve reexecução Native.

O aceite da US-025, dataset carregável nas duas engines com totais versionados, foi atendido. O vetor CT-08 de itens/dois pagamentos permanece marcado como preparatório para schema/busca/conciliação de documentos; CT-08/CT-16 completos, Native/iOS e a suíte US-027 continuam nas suas histórias/gates. Não houve alteração de schema, seed de produção, dados reais ou deploy. DP-01 a DP-04 permanecem abertas. Próxima história: US-026, revisão/versionamento financeiro.

## Fundação — US-024: ports de leitura e fronteiras implementados — 2026-10-16

G07-QUERY passou em PostgreSQL 18.6 real antes da adoção de Kysely 0.29.6 no adapter Node. finance-ports permanece puro; persistence-postgres implementa Accounts/Transactions sem cliente SQL público, com composição explícita em API/worker. Cada unidade autoriza workspace/contas, usa o mesmo client em READ ONLY/SET LOCAL/RLS e expira seus ports ao terminar. Associações de rateio/tag/revisão filtram a conta do pai no mesmo SQL. Dinheiro/versão são strings exatas, calendário e UTC/ms preservados. [Guia](../development/data-access.md), [ADR-0035](../architecture/adr/0035-ports-e-repositories-por-modulo.md).

O [protocolo](../quality/evidence/us-024-repositories-2026-10-16.json) passou nos 22 gates: tipos, BIGINT, contexto, RLS sem WHERE/WITH CHECK, rollback, conexão perdida, concorrência/locks/paginação e onze verificações dos ports, logs/limpeza. A base migrou para v2 antes das leituras. Nove testes Node novos cobrem violações de arquitetura, lifecycle, autorização, descarte/ownership do pool e evidência. A matriz atribui as 12 tabelas a cinco módulos e impede tabelas alheias/raw SQL/dynamic imports nos adapters de leitura. CI scoped-repositories configurada, execução remota pendente.

pnpm check passou com 244 testes Node, sem skips, além de formatação, lint/fronteiras, geração/configuração, tipos negativos e build. São 19 workspaces e 86 Markdown. Os [quatro perfis Docker](../quality/evidence/us-014-environments-2026-10-16-us024.json), [12 gates DOM](../quality/evidence/us-016-dom-2026-10-16-us024.json) e [oito de flags](../quality/evidence/us-017-flags-2026-10-16-us024.json) passaram novamente com hashes atuais. Bancos, senhas, contêineres e redes de teste próprios removidos; relatórios anteriores e sete documentos originais preservados.

Não há port de escrita financeira, policy engine/handler HTTP novo ou adapter nativo de produto. O schema mantém default deny; permissões do protocolo são exclusivamente sintéticas. Cursors internos vinculam workspace/filtros e não substituem tokens HTTP ou feed de sync. Relatórios US-023 foram preservados como históricos após mudança do lockfile/validador; nenhum teste Native foi reexecutado nesta história. G07-QUERY foi atendido neste recorte; G07-VAULT/JOBS/PDF, iOS e DP-01 a DP-04 continuam nos seus escopos. Próxima história independente: US-025, fixtures financeiras canônicas.

## Fundação — US-023 implementada nas plataformas disponíveis; iOS/integração pendentes — 2026-10-16

UUIDv7 usa 48 bits de Unix ms e 74 bits aleatórios novos, sem contador/fallback Math.random. Web/API/worker usam Web Crypto; Mobile usa getRandomValues do Expo; Rust usa uuid/getrandom fixados. resourceId preserva UUIDs legados canônicos v1–v8. O domínio fornece codecs UTC/ms exatos e mantém data financeira sem fuso; relógio/ID não arbitra revisão ou conflito. Chrono 0.4.45, já transitivo no lock Rust, passa a dependência direta para calendário/UTC, justificada no [ADR-0034](../architecture/adr/0034-uuidv7-e-politica-temporal.md). [Guia](../development/identity-and-time.md).

Os [14 gates Node/Chromium/PostgreSQL/SQLite](../quality/evidence/us-023-node-2026-10-16.json) e os [sete Windows/SQLCipher](../quality/evidence/us-023-windows-2026-10-16.json)/[sete Android/SQLCipher](../quality/evidence/us-023-android-2026-10-16.json) passaram. Vetores RFC, 4096 IDs por ms fixo, avanços/regressões, instâncias independentes, calendário/UTC, histórico pré-1970, limites e rejeições foram conferidos; quatro fusos rodaram em Node/Chromium. Android verificou migrations v2 com SHA-256 nativo/UTF-8, persistência, PIDs distintos, SecureStore e limpeza offline, sem alegar reboot de SO novo. Bases/segredos/contêiner/rede próprios removidos; app US-023 desinstalado e emulador iniciado no turno encerrado.

Onze testes Node novos cobrem codecs, falhas fechadas, bridge sanitizado, preservação de legado e independência do resumo financeiro da ordem dos IDs. pnpm check passou com 235 testes, sem skips, formatação, lint/fronteiras, geração/contratos/configuração, tipos e build. Cargo fmt/Clippy e os 15 testes Rust passaram, incluindo regressões de cofre/backup/processo/schema. Os [quatro perfis Docker](../quality/evidence/us-014-environments-2026-10-16-us023.json), [12 gates DOM](../quality/evidence/us-016-dom-2026-10-16-us023.json) e [oito de flags](../quality/evidence/us-017-flags-2026-10-16-us023.json) passaram novamente. São 17 workspaces e 82 Markdown; sete originais e relatórios anteriores preservados. CI nova configurada, execução remota pendente.

G07-IDS/TIME avançaram nos runtimes testados; iOS segue pendente. Factories/bridge ainda precisam ser ligados aos comandos/repositories/fluxos de produto. Não houve mudança de formato/IDs dos cofres históricos, deploy ou dados reais. G07-VAULT/QUERY/JOBS/PDF e DP-01 a DP-04 permanecem nos seus escopos. Próxima história: US-024, começando pelo spike G07-QUERY antes de escolher typed-query e implementar os ports autorizados.

## Fundação — US-022 framework validado; adoção nos hosts pendente — 2026-10-16

O subpath migrations de storage-schema oferece verificação SHA-256, planejamento integral, histórico contíguo e runner SQLite. A ferramenta PostgreSQL usa o mesmo planejador, role dedicada e advisory lock do baseline. O catálogo conserva a versão 1 e acrescenta a versão 2 reversível: histórico técnico ampliado e índice derivado, sem reescrever dados financeiros. Downgrade é explícito; migrations destrutivas são recusadas até integração do snapshot protegido. Nenhuma dependência externa de produção nova. [Guia](../development/schema-migrations.md), [ADR-0033](../architecture/adr/0033-migrations-dual-engine.md).

O [protocolo real](../quality/evidence/us-022-migrations-2026-10-16.json) passou em PostgreSQL 18.6/SQLite 3.53.3, com dez gates. Foram seis encerramentos forçados por engine, em up/down após DDL/histórico e antes de commit, sem estado intermediário persistido ou alteração dos snapshots financeiros. Instalação vazia, adoção v1, concorrência, idempotência, planos inválidos, runners antigos e 33 casos financeiros por engine passaram. RLS/FORCE RLS e privilégios do histórico foram preservados; arquivos, segredo, contêiner e rede próprios removidos.

Oito testes Node novos cobrem comportamento e evidência; job dual-migrations configurado. Integração/homologação do novo runner nos hosts Rust/Expo, backup_manifest/restore, mudanças destrutivas e adaptadores de clientes API continuam nas histórias próprias. A evidência nativa da US-021 conserva seu alcance anterior. G07-VAULT e DP-01 a DP-04 permanecem abertos; nenhum dado real, deploy ou formato de backup alterado. Próxima história: US-023, UUIDv7/política temporal por plataforma.

pnpm check aprovado localmente com 224 testes Node, além de formatação, lint/fronteiras, contratos/geração/configuração, tipos e build. São 17 workspaces e 80 documentos Markdown. Os [quatro perfis Docker](../quality/evidence/us-014-environments-2026-10-16-us022.json), [12 gates DOM](../quality/evidence/us-016-dom-2026-10-16-us022.json) e [oito de flags](../quality/evidence/us-017-flags-2026-10-16-us022.json) passaram novamente. Evidências anteriores e sete documentos originais preservados. Execução remota da CI deste incremento pendente.

## Fundação — US-021 equivalente nos casos homologados; cofre de produto/iOS pendentes — 2026-10-16

storage-schema 0.1.0 entrega a migração SQLite das 12 entidades financeiras, com STRICT, FKs por workspace, i64, calendário/UTC ms, índices, revisão imutável e rateio completo no commit. Um guard com FK diferível e soma por componentes inteiros evita float/overflow, inclusive em INT64_MIN. O pacote é interno a Desktop/Mobile; Domain segue independente e não há biblioteca externa de produção nova. [Guia](../development/sqlite-schema.md), [ADR-0032](../architecture/adr/0032-schema-sqlite-e-equivalencia.md).

Os mesmos 33 casos persistidos passaram em [PostgreSQL/SQLite](../quality/evidence/us-021-dual-engine-2026-10-16.json), [SQLCipher Windows](../quality/evidence/us-021-desktop-2026-10-16.json) e [SQLCipher Android](../quality/evidence/us-021-android-2026-10-16.json). O protocolo dual acrescenta dez gates de migração/FK/guard/escritor/reabertura/local/RLS/logs/limpeza. Windows confirmou criptografia/chaves/reabertura/integridade; Android confirmou SecureStore, APK/runtime, reboot completo offline (5 → 6), chave e saldo persistentes, limpeza de bases/chave. O perfil Android tem app ID próprio e preserva main padrão US-002.

Oito testes Node novos cobrem geração reproduzível, normalização, corpus SQLite, migração e evidências. Cargo test/Clippy do novo teste Rust passaram. O job dual-schema repete o ensaio PostgreSQL/SQLite; o teste Rust participa do job Desktop. Execução CI remota deste incremento e iOS continuam pendentes.

A adoção no validador/migração/backup do cofre de produto mantém G07-VAULT. G07-TIME avançou nas plataformas testadas; G07-IDS/QUERY/JOBS/PDF e DP-01 a DP-04 seguem nos seus escopos. Policy engine/escopo por conta, normalização Unicode ampliada, framework completo de migrations e revisão automática continuam nas histórias próprias. Nenhum dado real ou deploy. Próxima história: US-022, migrations dual-engine.

pnpm check aprovado localmente com 216 testes Node, oito novos, além de formatação, lint/fronteiras, contratos/geração/configuração, tipos e build. São 17 workspaces e 78 documentos Markdown. Os [quatro perfis Docker](../quality/evidence/us-014-environments-2026-10-16-us021.json), [12 gates DOM](../quality/evidence/us-016-dom-2026-10-16-us021.json) e [oito de flags](../quality/evidence/us-017-flags-2026-10-16-us021.json) passaram novamente. Relatórios anteriores preservados; bancos/chaves/contêineres/redes próprios removidos, app US-021 desinstalado e emulador iniciado no turno encerrado. Os sete originais permanecem intactos.

## Fundação — US-020 schema PostgreSQL validado; integração pendente — 2026-10-16

O schema fm entrega 12 tabelas do núcleo, com IDs fornecidos pela aplicação, FKs compostas por workspace, BIGINT exato, DATE/UTC ms, nomes ativos únicos, rateios com soma diferível/locks e revisões imutáveis. Migração inicial usa transação, advisory lock e checksum; repetição é idempotente e falha após DDL não deixa schema parcial. [Guia](../development/postgresql-schema.md), [ADR-0031](../architecture/adr/0031-schema-inicial-postgresql.md).

O [protocolo PostgreSQL real](../quality/evidence/us-020-postgresql-2026-10-16.json) passou em 20 gates, incluindo isolamento/FKs, extremos i64, precisão temporal, concorrência de migração/rateio, histórico, privilégios, logs e limpeza. Bootstrap não faz CRUD financeiro; as fixtures usam logins distintos, permissões explícitas e RLS ativa. A migração de produto tem apenas policies restritivas e nenhum runtime grant, preservando default deny até a policy engine. Quatro testes Node novos cobrem evidência e falhas seguras do runner.

G07-TIME avançou no lado PostgreSQL; SQLCipher/cross-engine continuam pendentes. Não foi fixado typed query/repository (G07-QUERY), enum de membros (DP-03), revisão automática, feed/tombstone, migração dual-engine ou integração NestJS. Nenhuma biblioteca externa de produção, dado real ou deploy. Os sete originais e DP-01/02/04 permanecem preservados. Próxima história: US-021, schema SQLite equivalente, com os gates dos bindings/cofre e tempo.

pnpm check aprovado localmente com 208 testes Node, quatro novos, além de formatação, lint/fronteiras, contratos/configuração, tipos e build. Os [quatro perfis Docker](../quality/evidence/us-014-environments-2026-10-16-us020.json) e os [12 gates DOM](../quality/evidence/us-016-dom-2026-10-16-us020.json)/[oito de flags](../quality/evidence/us-017-flags-2026-10-16-us020.json) passaram novamente, com limpeza e histórico preservado. São 16 workspaces e 75 documentos Markdown. CI postgres-schema configurada; execução remota deste incremento pendente.

## Fundação — US-017 implementada; integração de produto pendente — 2026-10-16

runtime-config 0.1.0 fornece configuração pública imutável por ambiente, cinco flags false por padrão, validação estrita e revisão. Gate atualizado em execução bloqueia novas operações, exige autorização independente e consulta novamente após o await. Falha/rollback desliga opcionais; trabalho já iniciado não é interrompido. Domain permanece puro e local continua sem login/nuvem. [Guia](../development/runtime-configuration.md), [ADR-0030](../architecture/adr/0030-flags-e-configuracao-por-ambiente.md).

Factories Web/Desktop/Mobile filtram seções e recusam rota desativada. API/worker fixam superfície/autoridade e recebem configuração explícita. A demonstração sintética atualiza navegação, cartões, busca e rota sem recompilar; sua operação HTTP também respeita o gate. Cinco templates públicos ficam desligados, sem segredos, fornecedor externo ou nova biblioteca externa de produção.

15 testes Node comportamentais e dois de evidência foram adicionados. O [protocolo Chromium de flags](../quality/evidence/us-017-flags-2026-10-16.json) passou em oito gates, incluindo bundle idêntico, reload, bloqueio no servidor, origem externa e falha. Os [12 gates DOM](../quality/evidence/us-016-dom-2026-10-16-us017.json) foram reexecutados. Os quatro perfis Docker também passaram novamente, com limpeza e [evidência atual](../quality/evidence/us-014-environments-2026-10-16-us017.json); relatórios anteriores preservados.

Integração Next.js/NestJS/Tauri/Expo e handlers reais, propagação/autenticidade remota e persistência da revisão continuam pendentes. Native permanece tipado, com execução Android/iOS/leitores de tela pendente. Nenhuma flag altera telemetria, políticas offline, retenção, autoridade ou os gates G07/DP-01 a DP-04. Não houve deploy ou uso de dados reais. CI remota deste incremento pendente. Próximo incremento: US-020, schema físico PostgreSQL, respeitando os gates e conflitos documentados.

pnpm check aprovado localmente: 204 testes Node, formatação, lint/fronteiras, contratos, cinco perfis de configuração, tipos DOM/Native/host e build. São 16 workspaces e 73 documentos Markdown. Os sete documentos originais permanecem intactos.

## Fundação — US-016 DOM validado; Native tipado, homologação pendente — 2026-10-16

design-tokens/ui-dom 0.1.0 entregam tokens imutáveis e modelo puro de apresentação, AppShell/ContentNotice React e wrappers WebShell/DesktopShell. Mobile tem NativeShell/NativeShellExample próprios, com os mesmos tokens e sem dependência DOM. Sete seções P0, local sem login, cloud explícito, estados distintos, foco/teclado e texto escalável. [Guia](../development/design-system.md), [ADR-0029](../architecture/adr/0029-design-tokens-e-shells.md).

O protocolo real Chromium passou em 12 gates, com Axe nos seis estados, navegação, foco, status, retry, troca de espaço/busca, Web cloud, reflow em 320/375/768, fonte raiz a 200%, forced-colors e ausência de storage/tráfego externo/erros. [Evidência sanitizada](../quality/evidence/us-016-dom-2026-10-16.json). Browser/listener de teste encerrados e capturas somente sintéticas/ignoradas. 12 testes Node de comportamento e três de evidência acompanham o incremento.

Como package.json, lockfile e CI mudaram, a US-014 foi reexecutada nos quatro perfis Docker reais: todos os gates e limpeza passaram. [Relatório atual](../quality/evidence/us-014-environments-2026-10-16-us016.json) com hashes atuais; os dois anteriores permanecem como histórico validado.

pnpm check aprovado localmente com 187 testes Node, 15 novos, além de formatação, lint/fronteiras, contratos/configuração, tipos DOM/Native/host e build. Repositório com 15 workspaces e 70 documentos Markdown. O novo job ui-shell executa o protocolo Chromium no Ubuntu; execução remota deste incremento pendente.

React 19.3.0 existente é reutilizado no DOM; React DOM/esbuild/Axe são ferramentas de desenvolvimento do exemplo. Nenhum dado real, API, banco, fonte externa ou deploy neste incremento. A entrada nativa US-002 e as especificações originais foram preservadas. Ainda faltam homologação Native Android/iOS, TalkBack/VoiceOver, avaliação humana WCAG e integração Next.js/Vite/Tauri/rotas/dados de produto. DP-01 a DP-04/G07 seguem nos seus escopos. Próximo incremento independente: US-017, flags/configuração por ambiente.

## Fundação — US-015 implementada — 2026-10-16

packages/observability fornece correlação request_id/trace_id/span_id, OpenTelemetry manual privado e logs/spans JSON com allowlist tipada. API/worker exportam factories com service fixo. Emissão é desativada por padrão e exige destino explícito; nenhum collector, backend externo ou provider global é configurado. Erros não expõem mensagem/stack/cause e operações usam catálogos fechados. [Guia](../development/observability.md), [ADR-0028](../architecture/adr/0028-observabilidade-com-scrub.md).

17 testes novos passaram localmente: canários sensíveis nas duas saídas, erros/objetos hostis, concorrência de 32 operações, snapshot, defaults, trust/headers, escopo encerrado e sink falho. HTTP loopback real e worker Node em processo separado comprovam correlação entre request/job/sync/db com spans distintos. db.query é operação sintética sem SQL; não há fila persistente. Listener/processo são encerrados e não se salvam payloads ou logs brutos.

A alteração do lockfile motivou nova execução real completa da US-014 nos quatro perfis Docker. Todos os gates e limpeza passaram; [nova evidência](../quality/evidence/us-014-environments-2026-10-16-us015.json) corresponde às fontes atuais e o relatório anterior foi preservado. O teste da evidência exige correspondência de hashes no relatório novo e mantém a validação estrutural/gates do histórico.

pnpm check aprovado localmente com 172 testes Node, 17 novos, além de formatação, lint/fronteiras, contratos, configuração de ambientes, tipos e build. Repositório com 15 workspaces e 68 documentos Markdown; a CI quality existente inclui a suíte em Windows/Linux, com execução remota deste incremento pendente.

Novas dependências de produção são @opentelemetry/api 1.9.1, sdk-trace-base/resources 2.12.0, justificadas no ADR. A matriz permite o pacote somente em API/worker. O critério da fundação US-015 foi atendido; integrações NestJS/Next.js/Tauri/Expo, spans reais de banco/fila, collector/OTLP e fornecedor de error tracking/analytics permanecem pendentes. A US-166 não está encerrada. Nenhum deploy ou dado real neste incremento; originais e DP-01 a DP-04/G07 preservados. Próximo incremento independente: US-016, design tokens e shell acessível.

## Fundação — US-014 validada em Docker local; integrações pendentes — 2026-10-16

Foram configurados quatro perfis isolados, local/ci/integration/staging, com PostgreSQL, Keycloak em PostgreSQL, Mailpit e Caddy HTTPS. O usuário escolheu staging em Docker local isolado. Manifesto, modelo gerador e comandos up/verify/down/test usam imagens por digest, portas loopback, credenciais/CA por instância e dados somente sintéticos. [Guia](../development/environments.md), [ADR-0027](../architecture/adr/0027-ambientes-docker-reproduziveis.md).

O protocolo real passou nos quatro perfis, com 12 gates por perfil e sete transversais: falha de startup/recuperação, proteção de instância existente, credenciais e CA cruzadas recusadas, subida repetida, recriação e limpeza. [Evidência sanitizada](../quality/evidence/us-014-environments-2026-10-16.json), Docker Linux no Docker Desktop 29.8.2/Compose 5.6.0. Contêineres, redes e segredos próprios removidos. Bootstrap 0001 cria apenas roles/banco de identidade/marcador técnico; não há schema financeiro de produto. pg 8.23.1 foi reutilizado como ferramenta de desenvolvimento, sem dependência nova de produção.

pnpm check aprovado localmente com 155 testes Node, 14 novos, além de tipos, lint/fronteiras, geração de contratos, configuração de ambientes, formatação e build. A CI quality não exige Docker; novo job environment-stack executa o protocolo real e limpeza em Ubuntu. Execução remota deste incremento pendente.

A fundação Docker da US-014 está validada; topologia Web/BFF/API/worker/objetos de produto continua pendente das integrações correspondentes. O staging local não é declarado equivalente ao SaaS completo ou a um staging remoto. Não houve deploy ou dados reais neste incremento; originais e DP-01 a DP-04/G07 preservados. Próximo incremento independente: US-015, observabilidade base com scrub por padrão.

## Fundação — US-012 implementada — 2026-10-16

packages/contracts contém a fonte OpenAPI 3.1.1/API 1.0.0 para contas, saldo e movimentações manuais, com tipos, SDK, parsers e validadores ESM gerados. Web/Desktop/Mobile compartilham o cliente com transporte/sessão injetados. Contratos incluem strings i64, UUID/data/instante, paginação keyset, requestId, version, erro seguro e Idempotency-Key. [Uso e limites](../development/api-contracts.md), [ADR-0026](../architecture/adr/0026-contratos-openapi-e-clientes.md).

pnpm check aprovado localmente com 141 testes, 26 novos. Peer HTTP loopback real exercitou os três módulos compilados, extremos monetários, cursor, headers e redirect recusado. Tipos negativos, validação e reprodução dos artefatos passaram; contracts:check integra lint/CI. Fixtures são sintéticas e o listener próprio foi encerrado. As únicas novas bibliotecas externas são ferramentas de desenvolvimento openapi-typescript/Ajv; runtime depende apenas dos módulos internos.

O aceite da fundação US-012 foi atendido; servidor NestJS/BFF, persistência/autorização, idempotência durável, cursor persistente e homologação Next.js/Tauri/Expo continuam nas histórias próprias. Não houve migração, publicação ou deploy neste incremento. DP-01 a DP-04 e G07 permanecem nos respectivos escopos; originais preservados. Próximo incremento independente: US-014, ambientes reproduzíveis com dados sintéticos. A CI remota deste incremento não foi executada.

## Fundação — US-013 implementada — 2026-10-16

packages/domain agora entrega MoneyMinor como string canônica i64, aritmética BigInt sem float monetário, rateios exatos, saldo por referência com início/fim do dia e cobertura explícita, consolidação de ativos/passivos e planos imutáveis de transferência/pagamento de cartão. O resumo por período separa consumo e caixa; pagamento não duplica despesa e estorno pertence à própria data. [API e cenário](../development/domain-core.md), [ADR-0025](../architecture/adr/0025-nucleo-monetario-puro.md).

Foram acrescentados 35 testes comportamentais e contratos negativos de tipos. FIN-001 em test-fixtures contém apenas dados sintéticos e totais esperados independentes. pnpm check aprovado localmente com 115 testes Node, além de tipos, lint/fronteiras, formatação e build. A única nova dependência é interna, test-fixtures → domain; o núcleo não tem dependências de produção. Nenhum schema ou documento original foi alterado.

O resultado conclui o núcleo puro exigido pela US-013; não entrega persistência transacional, API/OpenAPI, autorização, conciliação de importações ou interfaces. A próxima história independente é US-012, para versionar contratos e gerar clientes tipados usando a representação monetária comum. A adoção de schema/cofres continua sujeita aos gates G07 e US-020 a US-027. DP-01 a DP-04 e homologações pendentes não foram encerradas. A CI remota deste incremento ainda não foi executada.

## W0 — US-007 consolidada com gates explícitos — 2026-10-16

O [ADR-0024](../architecture/adr/0024-consolidacao-fisica-e-gates.md) registra os seis itens de aceite: UUID SQLite, timestamps, binding SQLCipher, typed query, job queue e PDF parser. Cada item tem proposta concreta, evidência e gate de adoção. O [protocolo](../development/spikes/us-007-physical-decisions.md) define G07-IDS/TIME/VAULT/QUERY/JOBS/PDF, as histórias afetadas, ambientes e critérios de saída. Não há aprovação humana formal de produção registrada; a história está concluída como consolidação conforme o aceite, que permite spikes pendentes explícitos.

Foi acrescentado um probe de representações físicas no SQLite real: UUID TEXT canônico, UTC em milissegundos, DATE, DECIMAL_EXACT textual, FK composta, migração/checksum, rollback e reabertura. Nove verificações passaram; banco/journals sintéticos removidos. [Evidência sanitizada](../quality/evidence/us-007-physical-2026-10-16.json). pnpm check aprovado com 80 testes, incluindo execução do probe SQLite e regressões de codecs/evidência. A CI quality já executa essa suíte em Windows/Linux; execução remota permanece pendente.

O teste não executa SQLCipher ou PostgreSQL nem valida geração UUIDv7 por plataforma. Os bindings e os invariantes financeiros comuns mantêm seus gates. W0/DP-04, US-002/iOS, US-003/provedores/runtimes e DP-01 a DP-03 continuam pendentes. O próximo incremento independente é US-013, de MoneyMinor e regras puras; o schema de produto segue condicionado aos gates de US-020 a US-027.

## W0 — US-006 concluída como spike — 2026-10-16

Foram implementados leitores OFX 1.02/OFX XML e CSV com mapping explícito em packages/importers/spikes/us-006, com normalização exata, provenance, erros por linha e staging transacional isolado. [Protocolo e catálogo](../development/spikes/us-006-parsers.md), [ADR-0023](../architecture/adr/0023-spike-parsers-ofx-csv.md) e [evidência sanitizada](../quality/evidence/us-006-parsers-2026-10-16.json) registram dependências, ameaças, limites e medições.

As 17 verificações reais passaram, incluindo nove ensaios de prévia de 10 mil linhas, três por layout, em processos Node novos. Todos ficaram abaixo da meta de 30 segundos; o relatório contém tempos completos, RSS e máquina de referência. Cada campo e INTEGER i64 persistido foi conferido. Cancelamento, morte do processo, fonte hostil e descarte de revisão de 500 linhas não alteraram a base financeira sintética. Entradas, bancos e journals próprios removidos. pnpm check aprovado com 76 testes. CI parser-spike configurada para Windows/Linux; execução remota pendente.

A conclusão é experimental: não há integração de interface/cofre nativo, confirmação/reversão financeira, deduplicação contra registros integrados ou suporte universal a bancos. XLSX/PDF/XML fiscal e corpus autorizado continuam nas histórias posteriores. DP-01 a DP-04, US-002/iOS e US-003/provedores/runtimes continuam pendentes. O próximo passo é a US-007, para consolidar decisões físicas e registrar os bloqueios restantes sem presumir que toda a W0 terminou.

## W0 — US-005 concluída como spike — 2026-10-16

Foi implementado o protocolo experimental em apps/api/spikes/us-005 e infra/sync, com PostgreSQL real, duas réplicas em processos separados e fila persistente SQLite sintética. [Protocolo](../development/spikes/us-005-sync.md), [ADR-0022](../architecture/adr/0022-spike-sincronizacao-dois-clientes.md) e [evidência sanitizada](../quality/evidence/us-005-sync-2026-10-16.json) registram push/pull, confirmação idempotente, histórico, merge, tombstones e conflitos explícitos.

As 22 verificações reais cobrem perda da resposta depois do commit, encerramento abrupto de clientes, rollback de fila/cursor, falha de servidor, precisão i64, isolamento, resolução auditada, revogação de membro/dispositivo/conta e rebootstrap por cursor/geração. Em 12 alterações concorrentes do mesmo campo, uma foi aplicada e 11 preservadas como conflitos; 12 reenvios do vencedor não duplicaram revisão. PostgreSQL, credenciais e bancos locais próprios removidos. pnpm check aprovado com 54 testes. Job two-client-sync configurado; execução remota pendente.

O instrumento usa sessões sintéticas e SQLite sem criptografia exclusivamente para fixtures. Integração OIDC/NestJS e adaptadores SQLCipher nativos, UI, transações financeiras dependentes, lease e purga permanecem nas histórias de produto. DP-01 a DP-03 seguem abertas. US-002/iOS e US-003/provedores/runtimes continuam pendentes. O próximo spike independente é US-006, de parsers e volume de importação; US-007 consolida decisões físicas.

## W0 — US-004 concluída como spike — 2026-10-15

Foi implementado o experimento de RLS/pool em apps/api/spikes/us-004, com migração sintética versionada, roles separados, runtime sem ownership/BYPASSRLS, ACL por statement e contexto LOCAL na mesma conexão durante a transação. [Protocolo](../development/spikes/us-004-postgresql-rls.md), [ADR-0021](../architecture/adr/0021-spike-isolamento-postgresql-rls.md) e [evidência sanitizada](../quality/evidence/us-004-postgresql-2026-10-15.json) registram implementação, ameaças e resultados.

PostgreSQL 18.6 real em container Linux no Docker Desktop/Windows: 20 verificações aprovadas, incluindo queries sem WHERE, escrita cruzada, conta restrita, exportação, revogação, FK composta, prepared statement, rollback/savepoint, conexão interrompida e 48 requests concorrentes. stdout/stderr não contiveram os valores/identificadores/senhas sintéticos usados como sentinelas. Container, tmpfs e arquivos de credenciais próprios foram removidos. pnpm check aprovado com 39 testes. Job postgres-rls da CI configurado, execução remota pendente.

A conclusão é experimental: não entrega NestJS, policy engine completa, vínculo OIDC→cloud_user ou permissões definitivas de produto. GUC depende da identidade fornecida pelo servidor confiável. DP-01 a DP-03 seguem abertas; US-002/iOS e US-003/provedores sociais/runtimes continuam pendentes. O próximo spike independente é a US-005, de sincronização mínima entre dois clientes.

## W0 — US-003 em andamento — 2026-10-15

Foi implementado o instrumento local OIDC em apps/web/spikes/us-003, com Keycloak separado em Docker, verificação/recuperação de e-mail no Mailpit, BFF Node HTTPS com sessão opaca e client público PKCE. O [protocolo](../development/spikes/us-003-oidc.md) e o [ADR-0020](../architecture/adr/0020-spike-identidade-oidc-local.md) delimitam os resultados e as ameaças. O usuário confirmou que não há ambiente Google/Apple configurado e autorizou a validação local com identidade sintética.

pnpm check aprovado com 31 testes. A [homologação local de navegador](../quality/evidence/us-003-local-2026-10-15.json) passou em Chromium 156.0.8078.4 com 15 verificações de ambiente/protocolo: isolamento Docker, e-mail, recovery, BFF/cookies/CSRF, renovação/logout, PKCE, falhas negativas, rotação/revogação e vínculo/expiração/replay de callback/sessão. Containers próprios, H2/e-mails temporários e arquivos efêmeros foram removidos; não houve uso de contas reais.

Google/Apple, integração Next.js e runtimes nativos com browser externo/deep link/secret store permanecem pendentes; US-003 não está concluída. A homologação iOS da US-002 também continua pendente. Nenhuma política offline, papel ou prazo de retenção das DP-01 a DP-03 foi alterado.

## W0 — US-002 em andamento — 2026-10-15

Foi implementado o instrumento Expo em apps/mobile/spikes/us-002, com SQLCipher por config plugin, chaves por workspace no SecureStore e contrato experimental de INT64 como strings decimais canônicas. O [protocolo](../development/spikes/us-002-mobile-vault.md) distingue unitários, typecheck, build e execução nativa; o [ADR-0019](../architecture/adr/0019-spike-cofre-mobile.md) justifica as dependências e registra ameaças.

pnpm check aprovado com 25 testes; typecheck Expo e build Android nativo aprovados. A [homologação Android](../quality/evidence/us-002-android-2026-10-15.json) passou em emulador AOSP Android 16/API 36 x86_64, com SQLCipher 4.17.0 community. Foram verificadas três fases: preparação, reabertura após reinício completo (boot_count 2 → 3) e limpeza das bases/chaves próprias. Modo avião, Wi-Fi e dados móveis foram conferidos antes/depois do reboot. O emulador foi encerrado após a execução.

O ambiente atual é Windows; o roteiro iOS está preparado para Mac, sem presumir acesso a Xcode ou credenciais. A homologação iOS permanece pendente e a história não está concluída. O instrumento não implementa login, autorização cloud, sincronização ou concessão de acesso offline. DP-01 a DP-03 continuam abertas. As adaptações necessárias de build/empacotamento e a divergência do verificador de compatibilidade Expo estão registradas no ADR-0019; o resultado Android não aprova a stack de produção.

## W0 — US-001 concluída como spike — 2026-10-13

Foi implementado o primeiro spike em apps/desktop/spikes/us-001: Tauri, SQLCipher, Windows Credential Manager, envelope Argon2id/AES-256-GCM, prévia e restauração em staging com nova chave e novo workspace LOCAL. O [ADR-0017](../architecture/adr/0017-spike-cofre-desktop.md) registra as escolhas experimentais e ameaças. O [protocolo da US-001](../development/spikes/us-001-desktop-vault.md) preserva os critérios de saída.

Evidência local:

- pnpm env:check --desktop: aprovado em Windows 11 x64, build 26200; Node 24.19.0 e pnpm 11.25.0.
- Rust 1.99.0, Cargo 1.99.0, target x86_64-pc-windows-msvc e componente C++ detectados.
- WebView2 Runtime 154.0.4258.62 detectado; programa Rust temporário compilado, vinculado e executado com sucesso.
- pnpm check: aprovado, incluindo 19 testes das regras do repositório, diagnóstico e integridade temporal da evidência, typecheck e build dos módulos TypeScript.
- pnpm spike:desktop:check: fmt, Clippy sem avisos, 13 testes Rust, build Tauri e smoke real WebView/IPC aprovados. O engine reportou SQLCipher 4.14.0 community; o relatório local fica ignorado pelo Git.
- Testes de recuperação usam processos separados, removem cofre/chave de origem, interrompem o processo em dois checkpoints e confirmam limpeza e preservação byte a byte do cofre existente.
- Kit reproduzível e [roteiro para outro perfil/máquina](../development/spikes/us-001-homologation.md) preparados; não contêm segredos ou dados reais.
- Homologação host → VM Windows 11 independente: aprovada, com remoção do cofre/chave de origem, falhas negativas, dois checkpoints de interrupção, prévia, novo workspace, fixture exata e preservação do existente. Após reiniciar o Windows, chaves recuperadas pelo Credential Manager e smoke real Tauri/WebView aprovados. Fixtures/credenciais próprias removidas e contêiner parado.
- [Evidência sanitizada](../quality/evidence/us-001-windows-vm-2026-10-13.json): guest Windows 10.0.26200.0, SQLCipher 4.14.0 community, hashes dos executáveis/imagem, resultado produzido após a reinicialização. Infraestrutura e ameaças no [ADR-0018](../architecture/adr/0018-homologacao-desktop-vm-docker.md).

US-001 concluída no escopo experimental do protocolo: a VM possui instalação Windows, perfil e Credential Manager independentes do host. Não se trata de dois diretórios no mesmo perfil. O resultado não entrega o produto financeiro, schema/formato finais, instalador assinado, homologação em hardware físico diferente ou teste de queda de energia. A CI nativa foi configurada e ainda não foi executada remotamente. US-002 a US-007 e a adoção final das decisões físicas continuam pendentes; DP-01 a DP-03 permanecem abertas.

## Bootstrap — 2026-10-12

Foram organizados a documentação e os conceitos, criados os workspaces e preparados os arquivos Git, as ferramentas compartilhadas e a CI.

- US-010: estrutura inicial, compilação isolada dos módulos e verificação de dependências. As aplicações ainda não têm seus frameworks integrados.
- US-011: ferramentas e gates iniciais. A cobertura de comportamento do produto será implementada junto às histórias.
- W0, US-001 a US-007: pendentes no bootstrap de 2026-10-12; a conclusão posterior da US-001 está registrada acima.
- W1–W6: implementação do produto pendente.

O roteiro continua sendo o [plano original](06-implementation-plan.md). Antes das implementações afetadas, resolva as [divergências documentais](../architecture/decisions-pending.md) e registre evidências dos spikes.

## Próximos passos previstos

1. Executar a homologação iOS da US-002 em Mac/Xcode; Android aprovado em 2026-10-15. Manter a história em andamento até a evidência iOS.
2. Implementar US-013, MoneyMinor e regras puras com fixtures; a consolidação US-007 e seus gates estão registrados no ADR-0024.
   A US-003 possui instrumento local; concluir a homologação de identidade com os conectores e runtimes pendentes antes de declará-la encerrada.
3. Executar G07-IDS/TIME/VAULT/QUERY antes das implementações de persistência afetadas; G07-JOBS/PDF antes das respectivas integrações cloud/documentais. Integrar os frameworks conforme as dependências das histórias.
4. Expandir CI com os testes financeiros, de integração e das plataformas.
