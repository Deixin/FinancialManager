# Financial Manager — Guia de início do desenvolvimento com Codex

**Versão:** 1.0  
**Data de referência:** 05/10/2026  
**Objetivo:** preparar o repositório, a documentação e o ambiente local para iniciar o MVP com Codex sem perder as decisões já tomadas de produto, dados, arquitetura e segurança.

---

## 1. Resultado esperado

Ao concluir este guia, o projeto deve ter:

- um repositório Git privado com estrutura de monorepo;
- documentação oficial em Markdown organizada e indexada;
- `AGENTS.md` na raiz orientando o Codex;
- ambiente capaz de executar Web, API, banco local/cloud e Desktop;
- Android preparado para a fase Mobile;
- CI inicial com lint, testes e build;
- segredos fora do Git;
- contas externas criadas somente quando realmente necessárias;
- W0 do Plano de Implementação pronta para começar.

A recomendação é **não começar implementando telas**. O primeiro ciclo deve executar os spikes W0 já definidos: Tauri/SQLCipher, Mobile/armazenamento, OIDC, RLS, sincronização e importadores.

---

## 2. Fonte de verdade para o Codex

Os arquivos em Markdown devem ser a fonte canônica dentro do repositório. DOCX e PDFs são exportações para apresentação e revisão humana.

### 2.1 Documentos oficiais existentes

| Ordem | Documento | Função para o agente | Destino sugerido |
|---|---|---|---|
| 1 | PRD Mestre | Define problema, escopo, requisitos e regras de negócio | `docs/product/01-prd.md` |
| 2 | Mapa de Telas e Fluxos | Define navegação, estados e fluxos ponta a ponta | `docs/product/02-screens-flows.md` |
| 3 | Modelo de Dados / ERD | Define entidades, invariantes e relações | `docs/architecture/03-data-model.md` |
| 4 | Arquitetura Técnica | Define stack, fronteiras, segurança e implantação | `docs/architecture/04-technical-architecture.md` |
| 5 | Backlog Técnico | Define épicos e histórias identificáveis | `docs/delivery/05-backlog.md` |
| 6 | Plano de Implementação | Define ondas, milestones, caminho crítico e gates | `docs/delivery/06-implementation-plan.md` |

Também devem ser versionados os conceitos visuais em `docs/ux/concepts/`, preferencialmente com nomes estáveis como `desktop-dashboard.png`, `desktop-import-review.png`, `mobile-transactions.png`.

### 2.2 Hierarquia quando houver conflito

1. ADR aprovado mais recente para uma decisão técnica específica.
2. PRD para regra de produto/negócio.
3. Mapa de Telas e Fluxos para comportamento de UI/fluxo.
4. Modelo de Dados para invariantes de persistência.
5. Arquitetura Técnica para implementação e infraestrutura.
6. Backlog/Plano para ordem de execução.

Se duas fontes oficiais se contradisserem, o Codex **não deve escolher silenciosamente**. Deve registrar a inconsistência e parar a parte afetada até existir decisão/ADR.

---

## 3. Estrutura recomendada do repositório

```text
financial-manager/
├─ AGENTS.md
├─ README.md
├─ package.json
├─ pnpm-workspace.yaml
├─ turbo.json
├─ .editorconfig
├─ .gitignore
├─ .env.example
│
├─ docs/
│  ├─ 00-index.md
│  ├─ product/
│  │  ├─ 01-prd.md
│  │  └─ 02-screens-flows.md
│  ├─ architecture/
│  │  ├─ 03-data-model.md
│  │  ├─ 04-technical-architecture.md
│  │  └─ adr/
│  │     ├─ 0000-template.md
│  │     └─ README.md
│  ├─ delivery/
│  │  ├─ 05-backlog.md
│  │  └─ 06-implementation-plan.md
│  ├─ ux/
│  │  └─ concepts/
│  ├─ quality/
│  │  ├─ fixtures.md
│  │  ├─ test-plan.md
│  │  └─ threat-model.md
│  └─ _exports/
│     └─ *.docx
│
├─ apps/
│  ├─ web/          # Next.js
│  ├─ desktop/      # Tauri + React
│  ├─ mobile/       # Expo / React Native
│  ├─ api/          # NestJS + Fastify
│  └─ worker/       # jobs/importações/processamento
│
├─ packages/
│  ├─ domain/       # MoneyMinor, regras e invariantes puras
│  ├─ contracts/    # tipos/API/OpenAPI/schemas compartilhados
│  ├─ ui/           # componentes compartilháveis quando fizer sentido
│  ├─ config/       # tsconfig/lint/test configs
│  └─ test-fixtures/
│
├─ infra/
│  ├─ docker/
│  ├─ aws/
│  └─ scripts/
│
└─ .github/
   └─ workflows/
```

**Regra:** o Codex deve receber contexto por links/arquivos do repositório, e não por cópias soltas de documentos no prompt.

---

## 4. `AGENTS.md`: contrato operacional do Codex

O Codex lê `AGENTS.md` antes de trabalhar. A raiz deve conter regras curtas e verificáveis; módulos especializados podem ter `AGENTS.md` ou `AGENTS.override.md` próprios.

Conteúdo mínimo recomendado:

```md
# Financial Manager — Regras para agentes

## Antes de alterar código
- Leia `docs/00-index.md`.
- Identifique a história `US-xxx` ou spike que está sendo executado.
- Não invente requisitos. Se houver conflito entre documentos oficiais, reporte-o.

## Invariantes do produto
- Dinheiro nunca usa float; use MoneyMinor/integer.
- Workspace é a fronteira de isolamento dos dados.
- Dados financeiros, descrições, CPF/CNPJ e documentos não entram em logs.
- Desktop local pode existir sem usuário cloud.
- Web não possui cofre financeiro local.
- Importação usa staging antes de afetar saldo.
- Conflitos de sync não podem ser resolvidos silenciosamente com last-write-wins.

## Engenharia
- Use pnpm e os scripts do workspace.
- Não adicione dependência de produção sem justificar no diff/PR.
- Toda mudança de schema exige migration e teste.
- Atualize ADR/documentação quando uma decisão arquitetural mudar.
- Rode lint, typecheck e testes relevantes antes de declarar conclusão.

## Segurança
- Nunca grave secrets em Git, fixtures ou logs.
- Não faça bypass de autorização/RLS para “facilitar” testes.
- Ações destrutivas e mudanças de infraestrutura exigem revisão explícita.
```

Mantenha esse arquivo pequeno. Ele deve apontar para a documentação, não reproduzi-la integralmente.

---

## 5. IDE e forma recomendada de usar Codex

### Recomendação principal

**Visual Studio Code + extensão Codex + Codex CLI.**

Motivos:
- funciona bem com TypeScript, Rust, Docker, SQL e React Native no mesmo workspace;
- a extensão Codex usa o contexto do editor;
- a CLI trabalha diretamente contra o repositório e executa as ferramentas instaladas;
- reduz a quantidade de IDEs necessárias no início.

A extensão Codex também é suportada em editores compatíveis como Cursor e Windsurf; Xcode e IDEs JetBrains possuem integrações próprias. Para este projeto, usar **um editor principal** evita configurações divergentes.

### Fluxo diário recomendado

1. Criar/selecionar uma história pequena (`US-xxx`).
2. Criar branch curta.
3. Fazer um checkpoint Git antes da tarefa.
4. Abrir Codex no diretório do repositório.
5. Pedir primeiro **plano e leitura**, sem editar.
6. Autorizar implementação focada.
7. Revisar diff e comandos executados.
8. Executar testes.
9. Rodar `/review` ou revisão separada antes do commit/PR.
10. Commit pequeno e rastreável.

Evite prompts como “faça todo o app”. Use entregas pequenas e verificáveis.

---

## 6. Ambiente recomendado — baseline Windows

Como o Desktop faz parte do MVP e Tauri no Windows depende do toolchain nativo, a configuração mais simples para um desenvolvedor Windows é **Windows 11 + PowerShell/Windows Terminal como shell principal**, usando Docker Desktop/WSL2 apenas para containers e serviços Linux.

### Hardware recomendado

| Recurso | Mínimo prático | Recomendado |
|---|---:|---:|
| RAM | 16 GB | 32 GB |
| CPU | 4–6 cores | 8+ cores |
| SSD livre | 60 GB | 120+ GB |
| Virtualização | habilitada | habilitada |
| Android físico | opcional | recomendado para testes |

### Software obrigatório para começar

| Software | Recomendação em 05/10/2026 | Uso |
|---|---|---|
| Git | versão estável atual | versionamento |
| GitHub | repositório privado | remote, PRs e Actions |
| VS Code | estável atual | IDE principal |
| Codex CLI | estável atual | agente no terminal |
| Extensão Codex | oficial | agente no editor |
| Node.js | **24 LTS** | toolchain TS/JS |
| pnpm | **12.x** | package manager/monorepo |
| Rust | stable via `rustup` | core Tauri/Desktop |
| Visual Studio Build Tools | workload **Desktop development with C++** | compilação Tauri no Windows |
| WebView2 | runtime atual | runtime do Tauri no Windows |
| Docker Desktop | atual, backend WSL2 | PostgreSQL e serviços locais |
| Android Studio | estável atual | SDK/emulador Android |
| JDK | 17 | build Android/Expo toolchain |

Tauri recomenda C++ Build Tools e WebView2 no Windows, além de Rust. Para Node, use uma linha LTS; em 05/10/2026 o Node 24 é a linha LTS mais recente. Para PostgreSQL, o baseline do projeto permanece 18.x; a versão 18.6 é a estável atual, enquanto 19 ainda está em beta.

### Ferramentas muito úteis

- **PowerShell 7** e Windows Terminal.
- **GitHub CLI (`gh`)** para PRs, Actions e autenticação.
- **DBeaver Community** para inspeção de PostgreSQL.
- **DB Browser for SQLite** para inspeção de bancos locais de teste.
- **Bruno** para coleções REST versionáveis no Git.
- **1Password ou Bitwarden** para credenciais de desenvolvimento.
- **AWS CLI** quando começar W4/cloud.

### Extensões VS Code sugeridas

- Codex
- ESLint
- Prettier
- rust-analyzer
- Even Better TOML
- Docker
- EditorConfig
- GitLens (opcional)

---

## 7. Stack recomendada para criação do monorepo

As versões abaixo são ponto de partida, não licença para atualizar automaticamente todos os majors. O repositório deve **fixar versões** no lockfile e atualizar de forma deliberada.

| Camada | Baseline recomendado | Observação |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | build/test/cache compartilhados |
| Web | React + **Next.js 16.x App Router** | Web é cloud-only |
| Desktop | React + **Tauri 2.x** + Rust | Local + Cloud |
| Mobile | React Native + **Expo SDK 57** | cloud/offline autorizado |
| Backend | **NestJS 12.x + Fastify** | monólito modular |
| Worker | NestJS/Node compartilhando domínio | jobs e importação |
| Cloud DB | **PostgreSQL 18.x** | RLS + UUIDv7 |
| Local DB | SQLite + SQLCipher | Desktop e réplica mobile |
| API | REST/JSON + OpenAPI | `/v1` |
| Testes TS | Vitest | domínio/packages/API |
| Web E2E | Playwright | fluxos críticos |
| Mobile E2E | Maestro | builds de preview/beta |
| Rust | `cargo test` | core nativo |
| Observabilidade | OpenTelemetry | sem conteúdo financeiro nos eventos |

**Não decidir ORM/query builder por conveniência do agente.** Essa escolha deve ser um ADR após os spikes de PostgreSQL/SQLite e migrations dual-engine.

---

## 8. Contas e serviços: o que contratar e quando

### Agora — desenvolvimento local / W0

| Serviço | Ação |
|---|---|
| ChatGPT/Codex | garantir acesso ao Codex e autenticar CLI/IDE |
| GitHub | criar organização ou repositório privado |
| Gerenciador de senhas | criar cofre compartilhável quando houver equipe |
| AWS | pode criar a conta, mas **não precisa provisionar produção ainda** |
| Expo | criar conta gratuita para preparar EAS posteriormente |

### Antes de W4 — Cloud/Web

| Serviço | Recomendação |
|---|---|
| AWS | ambiente de referência do SaaS |
| RDS PostgreSQL | PostgreSQL 18 quando disponível no serviço/região escolhida; senão versão suportada validada por ADR |
| S3 | armazenamento temporário/documentos e artefatos |
| KMS + Secrets Manager | chaves e secrets cloud |
| ECS/Fargate ou equivalente | API e worker containerizados |
| Route 53 + ACM | DNS e TLS |
| E-mail transacional | SES ou serviço equivalente |
| OIDC | escolher após US-003: Auth0/Cognito como candidatos; Keycloak é opção futura para self-host |

### Antes de Mobile beta

- Expo Application Services (EAS) para builds internos/preview e distribuição.
- Google Play Console para Android.
- Apple Developer Program para iOS.
- Um Mac/Xcode para desenvolvimento nativo iOS **ou** EAS para builds cloud; ainda será útil ter macOS antes da fase de suporte iOS avançado.

### Observabilidade e segurança

Começar simples:
- OpenTelemetry desde o código;
- CloudWatch no ambiente AWS de referência;
- Sentry pode ser adicionado para crash/error tracking se a política de scrubbing estiver validada;
- Dependabot/CodeQL e scans de dependências no GitHub;
- budgets/alerts de custo no AWS desde o primeiro ambiente pago.

---

## 9. Segredos e configuração

No Git devem existir apenas exemplos:

```text
.env.example
apps/api/.env.example
apps/web/.env.example
apps/mobile/.env.example
```

Nunca commitar:

```text
.env
*.pem
*.p12
*.key
credentials.json
service-account*.json
*.mobileprovision
production.db
*.fmbackup
```

Desenvolvimento local pode usar `.env` ignorado. CI usa GitHub Environments/Secrets. Cloud usa Secrets Manager/KMS. Chaves de assinatura de Desktop e credenciais de lojas não devem ficar disponíveis ao Codex por padrão.

---

## 10. Sequência de preparação do computador

### Etapa A — base

1. Atualizar Windows e habilitar virtualização.
2. Instalar Git, Windows Terminal/PowerShell 7 e VS Code.
3. Instalar Node 24 LTS.
4. Instalar pnpm 12 e confirmar versão.
5. Instalar Rust stable via `rustup`.
6. Instalar Visual Studio Build Tools com C++ Desktop.
7. Confirmar WebView2.
8. Instalar Docker Desktop com backend WSL2.

### Etapa B — Codex

1. Instalar Codex CLI usando o método oficial para o sistema.
2. Executar `codex` dentro de uma pasta de projeto e autenticar.
3. Instalar a extensão Codex no VS Code.
4. Criar `~/.codex/AGENTS.md` apenas com preferências pessoais reutilizáveis.
5. Manter regras do Financial Manager no `AGENTS.md` do repositório.

### Etapa C — Mobile

1. Instalar Android Studio.
2. Instalar SDK/emulador conforme a versão Expo homologada.
3. Instalar JDK 17.
4. Validar `adb` e um emulador/dispositivo físico.
5. Adiar configuração iOS local até existir macOS/Xcode ou necessidade concreta.

### Etapa D — validação

Executar e registrar:

```bash
git --version
node --version
pnpm --version
rustc --version
cargo --version
docker version
codex --version
```

O repositório deve ter posteriormente um script `pnpm doctor` que verifique as versões esperadas.

---

## 11. Bootstrap do repositório

Ordem recomendada:

1. Criar repositório privado `financial-manager`.
2. Copiar os seis Markdown oficiais para `docs/`.
3. Criar `docs/00-index.md`.
4. Criar `AGENTS.md`.
5. Criar template ADR.
6. Inicializar pnpm workspaces + Turborepo.
7. Criar apenas os diretórios/packages básicos — sem implementar feature ainda.
8. Configurar lint, format, typecheck, test e build.
9. Criar `docker-compose.yml` para PostgreSQL de desenvolvimento.
10. Criar CI mínimo no GitHub Actions.
11. Iniciar W0/US-001…US-007.

O primeiro PR ideal é **“chore: bootstrap repository and development standards”**, não uma tela de dashboard.

---

## 12. Primeiras instruções para o Codex

### Sessão 1 — entendimento, sem mudanças

```text
Leia AGENTS.md e docs/00-index.md. Depois leia a Arquitetura Técnica,
o Modelo de Dados, o Backlog e o Plano de Implementação.
Não altere arquivos.
Resuma: (1) invariantes que nunca podem ser quebradas,
(2) itens W0, (3) decisões ainda abertas e
(4) riscos técnicos do primeiro mês.
```

### Sessão 2 — bootstrap

```text
Execute somente a história US-010.
Antes de editar, apresente o plano de arquivos/comandos.
Crie o monorepo pnpm + Turborepo conforme a arquitetura.
Não crie features de produto, banco ou autenticação.
Ao terminar, rode lint/typecheck/test que existirem e mostre o diff resumido.
```

### Sessão 3 — spike

```text
Planeje US-001 como spike reproduzível.
Objetivo: provar Tauri 2 + SQLCipher + armazenamento de segredo + backup/restore.
Leia os critérios da história e não transforme o spike em código de produção.
Documente resultado, limitações e recomendação em docs/architecture/adr/.
```

### Revisão

```text
Revise as mudanças não commitadas contra AGENTS.md,
Arquitetura Técnica, ERD e a história ativa.
Priorize perda de dados, isolamento de workspace, dinheiro/float,
segredos, logging indevido, migrations e testes ausentes.
Não altere arquivos durante a revisão.
```

---

## 13. Regras práticas para trabalhar com agente

- Uma história por sessão/branch quando possível.
- Pedir plano antes de mudanças grandes.
- Não autorizar instalação irrestrita de dependências.
- Exigir que o Codex explique mudanças de schema e migrations.
- Nunca entregar credenciais reais no chat/prompt.
- Usar fixtures sintéticas; não importar seu extrato bancário pessoal para o repositório.
- Não aceitar “funcionou” sem comando de teste/evidência.
- Fazer commits antes e depois de refactors grandes para rollback simples.
- Quando um spike mudar arquitetura, atualizar ADR antes de seguir para implementação.
- Para UI, fornecer os conceitos visuais como referência, mas manter o Mapa de Telas/Fluxos como requisito de comportamento.

---

## 14. Critério de ambiente pronto

Antes de iniciar a primeira feature real, confirme:

- [ ] `AGENTS.md` e `docs/00-index.md` estão versionados.
- [ ] Os seis documentos oficiais em Markdown estão no repositório.
- [ ] Node/pnpm/Rust/Docker/Codex passam no `doctor`.
- [ ] Build mínimo Web/API/Desktop funciona.
- [ ] PostgreSQL de desenvolvimento sobe por container.
- [ ] Nenhum secret está no Git.
- [ ] CI executa lint/typecheck/test em PR.
- [ ] ADR template existe.
- [ ] W0 está rastreável por histórias.
- [ ] O agente consegue responder quais instruções/documentos carregou.

Quando esses itens estiverem verdes, iniciar **US-001 → US-007** e fechar M0 antes de puxar implementação de produto.

---

## 15. Referências oficiais verificadas

- OpenAI Codex CLI: https://learn.chatgpt.com/docs/codex/cli
- OpenAI Codex IDE: https://learn.chatgpt.com/docs/codex/ide
- OpenAI `AGENTS.md`: https://learn.chatgpt.com/docs/agent-configuration/agents-md
- Node.js releases/download: https://nodejs.org/en/about/previous-releases
- pnpm installation: https://pnpm.io/installation
- Tauri prerequisites: https://v2.tauri.app/start/prerequisites/
- Next.js docs: https://nextjs.org/docs
- Expo docs: https://docs.expo.dev/
- NestJS docs: https://docs.nestjs.com/
- PostgreSQL release notes: https://www.postgresql.org/docs/current/release.html

