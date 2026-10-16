# Financial Manager

Gestão financeira pessoal, com evolução prevista para MEI e pequenas empresas. O produto combina Desktop local gratuito, Web em nuvem e Mobile com réplica offline autorizada, mantendo o workspace como fronteira de dados, acesso e cobrança.

Este repositório contém a documentação v1.0, a estrutura inicial de desenvolvimento e um experimento nativo executável da US-001: Tauri, SQLCipher, chave protegida pelo Windows e backup autenticado. O experimento usa apenas dados sintéticos; a aplicação financeira de produto ainda será implementada. O bootstrap cobre a preparação da US-010 e parte da US-011. A US-001 foi homologada entre o host e uma VM Windows 11 independente, conforme a [evidência registrada](docs/quality/evidence/us-001-windows-vm-2026-10-13.json).

## Documentação

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

Os módulos TypeScript ainda validam a estrutura e a compilação independente. O experimento Desktop fica em apps/desktop/spikes/us-001. O Mobile possui um instrumento Expo em apps/mobile/spikes/us-002, com [protocolo próprio](docs/development/spikes/us-002-mobile-vault.md) e homologação nativa em andamento. As integrações da aplicação de produto seguem as histórias previstas, após as decisões W0.

## Ambiente e comandos

Use Node.js 24.19.0, indicado em .node-version e .nvmrc, e pnpm 11.25.0, fixado em package.json. Instale essa versão do pnpm seguindo a [documentação oficial](https://pnpm.io/installation).

```sh
pnpm install --frozen-lockfile
pnpm env:check
pnpm check
```

| Comando                    | Finalidade                                                             |
| -------------------------- | ---------------------------------------------------------------------- |
| pnpm check                 | Formatação, lint, estrutura, tipos, testes e build                     |
| pnpm check:repo            | Links locais e limites entre workspaces                                |
| pnpm format                | Formatar arquivos mantidos neste bootstrap                             |
| pnpm lint                  | ESLint e verificação estrutural                                        |
| pnpm typecheck             | Verificar os módulos TypeScript                                        |
| pnpm test                  | Testar regras do repositório e o diagnóstico Desktop                   |
| pnpm build                 | Compilar os módulos TypeScript                                         |
| pnpm env:check --full      | Conferir também ferramentas das futuras plataformas                    |
| pnpm env:check --desktop   | Verificar pré-requisitos Windows x64 e compilar/executar um probe Rust |
| pnpm spike:desktop:check   | Testes Rust, Clippy, build Tauri e smoke real da WebView no Windows    |
| pnpm spike:desktop:ui      | Abrir a demonstração com dados sintéticos                              |
| pnpm spike:desktop:package | Preparar kit local de homologação, ignorado pelo Git                   |

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
