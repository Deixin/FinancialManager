# Financial Manager

A [US-045 começou pelo catálogo compartilhado](docs/development/taxonomy.md): subcategorias e tags com criação, edição, pesquisa e arquivamento em PostgreSQL/SQLite. Associação às transações e integração Desktop são os próximos incrementos. Homologações humanas seguem após integração completa; entradas abaixo são históricas.

A [US-044 no Desktop](docs/development/desktop-categories.md) integra sugestões, criação, edição, ordem e arquivamento de categorias ao cofre SQLCipher. Próximo passo: US-045, subcategorias, tags e associações. Homologações humanas seguem após integração completa; entradas abaixo são históricas.

A [US-044 compartilhada](docs/development/categories.md) acrescenta sugestões de categorias por finalidade, edição, ordenação e arquivamento isolados por workspace, com preservação do histórico. Próximo incremento: integração Desktop. Homologações humanas seguem após integração completa; entradas abaixo são históricas.

A [US-043 no Desktop](docs/development/desktop-card-payments.md) integra cartões e pagamentos com revisão conjunta no SQLCipher, sem duplicar consumo. Próxima história: US-044. Importação/conciliação e homologações humanas integradas mantêm seus gates.

US-043 em andamento: [pagamentos de cartão compartilhados](docs/development/card-payments.md), com liquidação atômica sem duplicar consumo. Próximo incremento integra o Desktop; homologações humanas permanecem após integração completa.

A [US-042 no Desktop](docs/development/desktop-transfers.md) integra transferência com confirmação dos dois lados, edição, exclusão/restauração e histórico no SQLCipher. A [base compartilhada](docs/development/transfers.md) mantém PostgreSQL/SQLite. Próximo incremento: US-043, pagamento de cartão. Homologações humanas continuam após integrar todo o sistema; os registros abaixo são históricos.

A [fundação US-042](docs/development/transfers.md) acrescenta transferências atômicas no núcleo PostgreSQL/SQLite: grupo, dois lançamentos e revisões confirmados juntos, com versões e exclusão/restauração. A integração Desktop é o próximo incremento. Homologações humanas permanecem após integrar todo o sistema; registros abaixo preservam as entregas anteriores.

A [US-041 no Desktop](docs/development/desktop-movements.md) integra movimentações manuais, exclusão/restauração e histórico ao SQLCipher, com ajuste identificado e validação no Rust. As homologações humanas ficam após integrar todo o sistema. Próxima história: US-042, transferências atômicas. Os registros abaixo preservam o histórico dos incrementos.

A [fundação US-041](docs/development/manual-movements.md) implementa política de criação, edição, exclusão lógica, restauração e ajuste identificado sobre o histórico transacional existente, com validação PostgreSQL/SQLite. A história segue em andamento: o próximo incremento integra comandos e telas de movimentações ao Desktop.

A [US-040 no Desktop](docs/development/desktop-accounts.md) permite criar, editar, arquivar/reativar contas, registrar/corrigir referências e conferir saldos no cofre SQLCipher. Valores usam i64 exato, referências mantêm histórico e a troca de workspace ou bloqueio remove a tela financeira anterior. A [base compartilhada](docs/development/financial-accounts.md) também atende PostgreSQL/SQLite. Próxima história: US-041, movimentações manuais. Homologações humanas ficam para após integrar todo o sistema.

A [US-036](docs/development/workspace-manager.md) permite criar e alternar entre múltiplos espaços locais independentes, sem limite comercial. O seletor mostra finalidade e Local; o filtro Nuvem explica a indisponibilidade do acesso cloud. Os testes verificam persistência SQLCipher e troca de contexto. Homologações humanas ficam para após a integração completa.

Gestão financeira pessoal, com evolução prevista para MEI e pequenas empresas. O produto combina Desktop local gratuito, Web em nuvem e Mobile com réplica offline autorizada, mantendo o workspace como fronteira de dados, acesso e cobrança.

Este repositório contém a documentação v1.0, a estrutura inicial de desenvolvimento e um experimento nativo executável da US-001: Tauri, SQLCipher, chave protegida pelo Windows e backup autenticado. O experimento usa apenas dados sintéticos; a aplicação financeira de produto ainda será implementada. O bootstrap cobre a preparação da US-010 e parte da US-011. A US-001 foi homologada entre o host e uma VM Windows 11 independente, conforme a [evidência registrada](docs/quality/evidence/us-001-windows-vm-2026-10-13.json).

## Documentação

A [US-035](docs/development/local-restore.md) integra a restauração de backup com senha e prévia verificada, criando outro workspace local com IDs, geração e chave Windows novos. Não substitui espaços existentes; repetir a mesma confirmação não duplica a cópia. Homologações humanas continuam diferidas para após integrar o sistema, conforme instrução do usuário. Registros abaixo preservam os incrementos anteriores.

A [US-034](docs/development/local-backup.md) adiciona criação de backup .fmbackup com manifesto autenticado, schema/checksum, snapshot consistente e senha independente do Windows. Destino é escolhido no diálogo nativo, sem sobrescrever arquivos existentes. Restauração de produto segue na US-035. Por instrução do usuário, [homologações humanas ficam para após a integração completa](docs/architecture/adr/0044-homologacao-humana-apos-integracao.md), sem bloquear os próximos incrementos ou marcar testes não executados como aprovados. Registros abaixo preservam os incrementos anteriores.

O complemento da [US-033](docs/development/local-privacy.md) implementa Windows Hello opcional com rosto, digital ou PIN Windows, mantendo PIN do aplicativo como alternativa. Consulta nativa confirmou disponibilidade neste host; autenticação interativa ainda não foi homologada. Há protocolo/pacote sintético para o usuário validar consentimento e cancelamento, sem compartilhar credenciais. [ADR-0043](docs/architecture/adr/0043-windows-hello-local.md). O registro abaixo descreve a entrega PIN anterior.

A [US-033](docs/development/local-privacy.md) adiciona PIN opcional no Desktop Windows, com bloqueio no Rust, reinício/foco/saída e espera após erros. pnpm desktop:lock:check/native executam os protocolos Chromium/WebView2 e dez testes Rust novos. Biometria aparece indisponível nesta versão. Próximo incremento: US-034, backup de produto autenticado/versionado. Registros abaixo preservam os incrementos anteriores.

A [US-032](docs/development/desktop-vault.md) valida o cofre SQLCipher de produto e chave Windows, com falhas do secret store, migrations interrompidas e recuperação de journal quente. pnpm desktop:vault:check executa os 11 gates nativos e oito testes Rust novos. Aceite Windows atendido; backup/restore, outbox e distribuição seguem nos seus gates. Próxima história: US-033, PIN/biometria opcionais. Registros abaixo preservam os incrementos anteriores.

A [US-031](docs/development/local-workspaces.md) permite criar/reabrir espaços locais no Desktop sem conta cloud. Nome/finalidade ficam no SQLCipher de produto com chave Windows e staging; a prévia DOM não persiste dados. desktop:workspaces:check/native executam o protocolo atual. Próximo incremento: US-032, ampliando a homologação do cofre e G07-VAULT.

A [US-030](docs/development/desktop-entry.md) entrega a entrada Desktop React/Vite + Tauri até o modo local, sem identidade cloud. Use pnpm desktop:preview para visualizar; os protocolos desktop:entry:check e desktop:entry:native verificam Chromium e Windows/WebView2. Criar o primeiro espaço persistente é o próximo passo, US-031; cofre/login cloud e release assinado continuam nos seus gates.

Comece pelo [índice](docs/00-index.md). Os principais documentos são o [PRD](docs/product/01-prd.md), a [arquitetura](docs/architecture/04-technical-architecture.md), o [modelo de dados](docs/architecture/03-data-model.md) e o [plano de implementação](docs/delivery/06-implementation-plan.md).

As [decisões pendentes](docs/architecture/decisions-pending.md) registram divergências entre documentos. As regras para agentes estão em [AGENTS.md](AGENTS.md), e o processo de contribuição está em [CONTRIBUTING.md](CONTRIBUTING.md).

## Estrutura

```text
apps/
  web/            Next.js: interface Web em nuvem
  desktop/        React + Vite + Tauri 2: autoridade local e acesso à nuvem
  mobile/         Expo + React Native: acesso e réplica offline autorizada
  api/            NestJS + Fastify: monólito modular
  worker/         Processamento assíncrono
packages/
  domain/         Regras de negócio puras
  contracts/      Contratos compartilhados
  observability/  Correlação e telemetria operacional com scrub no servidor
  runtime-config/ Configuração funcional pública e feature gates por ambiente
  storage-schema/ Schema SQLite portátil, migração inicial e corpus sintético
  finance-ports/  Ports puros de leitura e orquestração entre módulos
  persistence-postgres/ Repositories Node com Kysely e contexto autorizado
  sync-core/      Protocolo e regras de sincronização
  importers/      Parsers e normalização
  search/         Contratos e lógica de busca
  design-tokens/  Tokens visuais compartilhados
  ui-dom/         Componentes para Web e Desktop
  test-fixtures/  Dados sintéticos de teste
  config/         Configurações e limites de dependência
infra/
  scripts/        Verificações do repositório
  docker/         Futuro ambiente local
  aws/            Futura infraestrutura de referência
docs/             Especificações, decisões e referências visuais
```

O pacote domain implementa o [núcleo puro da US-013](docs/development/domain-core.md): MoneyMinor exato, saldos, transferências, cartões e separação entre consumo e caixa. test-fixtures compartilha cenários financeiros sintéticos. contracts fornece a [fundação OpenAPI da US-012](docs/development/api-contracts.md), com tipos, validação e SDK gerados consumidos por Web/Desktop/Mobile. Os demais módulos TypeScript ainda validam estrutura e compilação independente. O experimento Desktop fica em apps/desktop/spikes/us-001. O Mobile possui instrumento Expo em apps/mobile/spikes/us-002, com [protocolo próprio](docs/development/spikes/us-002-mobile-vault.md) e homologação nativa em andamento. As integrações da aplicação de produto seguem as histórias previstas, após as decisões W0.

O instrumento [US-003](docs/development/spikes/us-003-oidc.md) acrescenta provider OIDC local no Docker e BFF Node HTTPS para testar autenticação com dados sintéticos. Ele não integra Next.js nem conclui a homologação Google/Apple ou dos runtimes nativos.

A [US-015](docs/development/observability.md) acrescenta OpenTelemetry manual, logs JSON com campos restritos e correlação para API/worker. A emissão é silenciosa por padrão, sem destino externo configurado. O teste usa HTTP loopback e processo Node independente; integração dos frameworks e coleta remota permanecem pendentes.

A [US-016](docs/development/design-system.md) acrescenta tokens versionados, shell React Web/Desktop e shell React Native próprio. pnpm ui:serve abre a demonstração sintética em http://127.0.0.1:44360; pnpm ui:check executa o protocolo Chromium de acessibilidade/layout após instalar o navegador Playwright. Native está tipado, com homologação em dispositivo/leitor de tela pendente. Não há integração das telas financeiras ou dos frameworks de produto neste exemplo.

O instrumento [US-004](docs/development/spikes/us-004-postgresql-rls.md) valida RLS e contexto por transação/pool contra PostgreSQL real, com dados sintéticos e ambiente efêmero. A integração NestJS/API e as permissões de produto seguem pendentes.

A [US-017](docs/development/runtime-configuration.md) acrescenta configuração pública por ambiente e flags com defaults desativados, revisão e bloqueio de operações independente da autorização. O seletor de disponibilidade no exemplo altera navegação/busca/cartões em execução, usando o mesmo bundle; o servidor sintético também bloqueia o recurso desativado. pnpm config:check valida os cinco templates, e pnpm ui:check inclui o protocolo real de flags. Integração dos handlers e frameworks de produto permanece pendente.

O instrumento [US-005](docs/development/spikes/us-005-sync.md) valida sincronização entre duas réplicas persistentes independentes: push/pull, idempotência, tombstones, conflitos e recuperação após falhas. Execute pnpm spike:sync:test com Docker Linux; o runner usa somente fixtures e limpa seus serviços, bancos e credenciais próprios. Os adaptadores nativos e a interface de sincronização de produto seguem pendentes.

O instrumento [US-006](docs/development/spikes/us-006-parsers.md) valida OFX/CSV com mapping, normalização exata e staging sem alterar saldo. Execute pnpm spike:importers:test para o benchmark de 10 mil linhas, cancelamento e corpus hostil; não exige Docker nem extrato real. Interface e confirmação financeira de produto seguem pendentes.

A [US-007](docs/development/spikes/us-007-physical-decisions.md) consolida representações e candidatos físicos, com gates antes de adoção. Execute pnpm spike:physical:test para validar UUID TEXT, UTC/DATE e decimal exato em SQLite sintético. A consolidação mantém explícitas as homologações nativas, typed-query, fila e PDF pendentes; não encerra toda a W0.

## Ambiente e comandos

A [US-027](docs/development/cross-engine-invariants.md) consolida as seis famílias de invariantes financeiras em PostgreSQL/SQLite: 43 cenários compartilhados, oráculo BigInt independente, comparação de estado/auditoria e 33 casos de schema por engine. pnpm invariants:test executa o protocolo de 50 gates; invariants:clean remove o ambiente próprio. Próxima história: US-030, entrada Desktop com Continuar sem conta.

A [US-026](docs/development/financial-revisions.md) entrega revisão transacional de movimentações: base i64 explícita, snapshot antes/depois, histórico imutável, grupos atômicos e reversão sem apagar edições posteriores. pnpm revisions:test verifica 28 gates PostgreSQL/SQLite; revisions:clean remove o ambiente próprio. Handlers, sincronização, undo de importação e adoção Native seguem nas histórias consumidoras.

A [US-025](docs/development/canonical-fixtures.md) fornece FIN-002 v1: dataset sintético portátil, totais esperados independentes e carga atômica PostgreSQL/SQLite. pnpm fixtures:check detecta divergências de geração; fixtures:test verifica 12 gates reais e limpa seus recursos. O vetor de documentos prepara testes futuros; não representa busca implementada ou homologação Native.

A [US-024](docs/development/data-access.md) entrega ports de leitura/backend e repositories PostgreSQL de Accounts/Transactions, com workspace/conta autorizados e verificação de fronteiras. Kysely 0.29.6 foi adotado após G07-QUERY real. pnpm repositories:test repete 22 gates e pnpm check:data-access detecta atalhos entre módulos. Escritas, policy engine/rotas e adapters nativos continuam nas histórias próprias.

A [US-023](docs/development/identity-and-time.md) acrescenta UUIDv7 por host e codecs UTC/ms/data financeira, preservando IDs antigos. identity:test verifica Node/Chromium/PostgreSQL/SQLite; identity:native:windows e os comandos Android validam CSPRNG e persistência SQLCipher nos runtimes reais. Instantes e IDs não arbitram conflitos ou datas financeiras. Integração dos fluxos de produto e iOS permanecem pendentes.

A [US-022](docs/development/schema-migrations.md) entrega o framework PostgreSQL/SQLite: catálogo/checksums, plano integral, serialização e up/down explícitos. pnpm schema:migrations:test verifica instalação vazia, concorrência e seis interrupções forçadas por engine com preservação de dados; schema:migrations:clean remove somente recursos próprios. O catálogo inclui um índice reversível; integração aos cofres/hosts nativos e mudanças destrutivas com backup seguem nas histórias próprias.

A [US-021](docs/development/sqlite-schema.md) acrescenta schema SQLite equivalente, rateios diferíveis sem float e migração inicial compartilhada. Os mesmos 33 casos persistidos passaram em PostgreSQL, SQLite e SQLCipher real no Windows/Android. Use pnpm schema:dual:test e os comandos schema:native do guia. iOS e adoção no cofre de produto continuam pendentes; o framework de migrations avançou na US-022.

A [US-020](docs/development/postgresql-schema.md) entrega a migração SQL inicial do núcleo financeiro PostgreSQL: 12 tabelas com FKs por workspace, BIGINT exato, rateios diferíveis e revisões imutáveis. pnpm schema:test executa 20 gates em banco real descartável; schema:clean limpa somente essa instância sintética. A migração mantém RLS restritiva e não concede acesso de runtime antes da policy engine. Não é aplicada automaticamente aos perfis US-014.

A [fundação US-014](docs/development/environments.md) configura local/CI/integration/staging em Docker local isolado, com PostgreSQL, Keycloak, Mailpit e HTTPS por perfil. Use pnpm env:stack:up --profile local e down para o mesmo perfil; env:stack:test verifica os quatro ambientes e limpa seus recursos. São dependências sintéticas descartáveis; Web/BFF/API/worker/objetos de produto e staging remoto continuam pendentes.

Use Node.js 24.19.0, indicado em .node-version e .nvmrc, e pnpm 11.25.0, fixado em package.json. Instale essa versão do pnpm seguindo a [documentação oficial](https://pnpm.io/installation).

```sh
pnpm install --frozen-lockfile
pnpm env:check
pnpm check
```

| Comando                               | Finalidade                                                             |
| ------------------------------------- | ---------------------------------------------------------------------- |
| pnpm check                            | Formatação, lint, estrutura, tipos, testes e build                     |
| pnpm check:repo                       | Links locais e limites entre workspaces                                |
| pnpm format                           | Formatar arquivos mantidos neste bootstrap                             |
| pnpm lint                             | ESLint e verificação estrutural                                        |
| pnpm typecheck                        | Verificar os módulos TypeScript                                        |
| pnpm test                             | Compilar módulos e testar domínio, contratos, repositório e spikes     |
| pnpm build                            | Compilar os módulos TypeScript                                         |
| pnpm contracts:generate               | Gerar tipos, SDK e validadores da fonte OpenAPI                        |
| pnpm contracts:check                  | Detectar divergência entre OpenAPI e código gerado                     |
| pnpm env:check --full                 | Conferir também ferramentas das futuras plataformas                    |
| pnpm env:stack:check                  | Validar manifesto/modelo dos quatro perfis sem Docker                  |
| pnpm env:stack:up --profile local     | Subir e verificar a fundação sintética do perfil escolhido             |
| pnpm env:stack:verify --profile local | Conferir serviços, roles, isolamento e TLS reais                       |
| pnpm env:stack:down --profile local   | Remover somente recursos e segredos pertencentes ao perfil             |
| pnpm env:stack:test                   | Executar protocolo real dos quatro perfis Docker e teardown            |
| pnpm env:check --desktop              | Verificar pré-requisitos Windows x64 e compilar/executar um probe Rust |
| pnpm spike:desktop:check              | Testes Rust, Clippy, build Tauri e smoke real da WebView no Windows    |
| pnpm spike:desktop:ui                 | Abrir a demonstração com dados sintéticos                              |
| pnpm spike:desktop:package            | Preparar kit local de homologação, ignorado pelo Git                   |

A formatação automática não reescreve os sete documentos originais. O experimento Desktop é local; os serviços e fluxos financeiros de produto permanecem pendentes.

O [protocolo da US-001](docs/development/spikes/us-001-desktop-vault.md) separa o preflight, os testes nativos e a homologação em outro perfil/máquina. pnpm check valida o monorepo TypeScript; pnpm spike:desktop:check valida a integração nativa. As escolhas experimentais estão no [ADR-0017](docs/architecture/adr/0017-spike-cofre-desktop.md).

## Publicar o repositório

Recomenda-se criar um repositório privado e vazio no provedor escolhido. O Git local usa a branch main. Antes do primeiro commit, revise os arquivos e configure seu nome e e-mail de autor no Git, caso necessário.

```sh
git status
git add .
git diff --cached --stat
git commit -m "chore: bootstrap repository and development standards"
git remote add origin <URL_DO_REPOSITORIO_PRIVADO>
git push -u origin main
```

O .gitignore protege segredos, bases locais, backups e arquivos bancários conhecidos. Documentos financeiros reais e credenciais devem ficar fora do repositório; consulte a [política de fixtures](docs/quality/fixtures.md). Não foi atribuída uma licença de distribuição: os manifests usam UNLICENSED até decisão do titular.
