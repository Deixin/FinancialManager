# ADR-0016 — Bootstrap do repositório

- Data: 2026-10-12
- Status: Adotado para o bootstrap solicitado pelo titular
- Histórias: US-010 e preparação da US-011
- Substitui: nenhum

## Contexto

A entrega v1.0 contém especificações e conceitos visuais. A arquitetura já prevê um monorepo TypeScript com pnpm/Turborepo, cinco aplicações e pacotes compartilhados. O guia recomenda preparar a documentação, regras e CI antes de implementar o produto.

## Decisão

Organizar os sete documentos canônicos em docs, preservar Word e templates e recuperar os diagramas incorporados. Manter um manifesto com os nomes e hashes originais.

Criar apps/web, desktop, mobile, api e worker. Usar os pacotes domain, contracts, sync-core, importers, search, design-tokens, ui-dom, test-fixtures e config. A divisão visual segue a arquitetura e permite compartilhar tokens com Mobile sem importar UI DOM.

Os módulos iniciais exportam apenas um módulo vazio, com compilação e verificação de tipos independentes. Frameworks e dependências de produção serão acrescentados nas histórias apropriadas. Nenhuma escolha de criptografia, banco físico, OIDC ou infraestrutura foi antecipada.

Fixar Node.js 24.19.0 e pnpm 11.25.0, versões disponíveis no ambiente e usadas na validação do bootstrap. Atualizações de major do gerenciador exigem regenerar e validar o lockfile. Usar TypeScript 5.9.3, compatível com a faixa de peers do typescript-eslint 8.71.2, em vez de adotar uma major do compilador fora dessa faixa. Fixar também Turbo 2.11.7, ESLint 10.12.0 e Prettier 3.9.10.

Adicionar CI em Linux e Windows para formatação, lint, limites entre workspaces, links locais, tipos, testes da verificação estrutural e compilação. As actions são fixadas por SHA. O lockfile é versionado e a instalação da CI usa frozen-lockfile.

## Alternativas

Um repositório apenas documental não atenderia ao início de US-010/US-011 previsto no guia. Instalar todos os frameworks neste momento criaria integrações sem as decisões e evidências W0. O bootstrap mantém a estrutura validável sem declarar essas integrações concluídas.

## Consequências e limites

Os testes atuais validam regras do repositório. O build atual valida módulos TypeScript, não aplicações Next.js, Tauri, Expo, NestJS ou infraestrutura. Testes financeiros, de integração e nativos continuam pendentes.

As regras de importação analisam referências estáticas e chamadas literais de import/require. Importações construídas dinamicamente exigem revisão; o verificador não substitui testes de arquitetura nem revisão de código.

## Referências

- [Instalação do pnpm](https://pnpm.io/installation).
- [pnpm em integração contínua](https://pnpm.io/continuous-integration).
- [Configuração do Turborepo](https://turborepo.dev/docs/reference/configuration).
- [Configuração do typescript-eslint](https://typescript-eslint.io/getting-started/).
- [Arquitetura do projeto](../04-technical-architecture.md).
