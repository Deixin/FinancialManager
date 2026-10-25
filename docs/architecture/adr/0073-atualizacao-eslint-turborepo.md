# ADR-0073 — Atualização de ESLint e Turborepo

Estado: aceito; validação concluída em 2026-10-25. Data da decisão: 2026-10-21. Escopo: manutenção das US-010/011 sobre `dev`, commit-base `0bed20d2a986b19a284892c065957e955a43735c`.

## Decisão e motivação

Incorporar ESLint 10.13.0 e Turborepo 2.11.9 como dependências de desenvolvimento com versões exatas. A atualização aproveita correções do analisador e otimizações da execução/cache, incluindo Windows. Não se presume ganho de desempenho medido neste projeto.

A origem é o [PR #1](https://github.com/Deixin/FinancialManager/pull/1), commit `1b2f051e54e1e086522a0a670e10adca7998aa2f`, criado pelo Dependabot com assinatura verificada pelo GitHub. Os hashes dos oito pacotes alterados, incluindo os binários opcionais do Turbo, foram confrontados com o registro oficial npm. O PR usa o bootstrap em `main`; seu CI de Linux/Windows não comprova compatibilidade com o produto atual em `dev`.

Aplicar apenas as duas atualizações ao manifesto vigente e regenerar o lockfile com pnpm 11.25.0, preservando os demais pacotes, scripts e configurações. Node permanece em 24.19.0. Não importar os manifests antigos de `main`, alterar o destino do PR ou publicar mudanças no GitHub neste incremento.

## Critérios de término e verificação

- Diff funcional restrito a `package.json` e `pnpm-lock.yaml`, com as duas versões e suas resoluções correspondentes.
- Instalação com lockfile congelado e confirmação das versões executáveis.
- Planejamento pelo catálogo sem entradas descobertas sem cobertura.
- Execução de `node infra/validation/cli.mjs run`, com todos os protocolos selecionados e `pnpm check` final aprovados.
- Novas evidências arquivadas pelo runner; relatórios históricos preservados byte a byte e estado de entrega atualizado.

O planejamento após a atualização seleciona os 54 protocolos existentes por alteração das dependências comuns, sem entradas sem cobertura e sem relatórios reutilizáveis. A seleção conservadora do [ADR-0070](0070-validacao-incremental-e-evidencias-imutaveis.md) permanece integral. A conclusão será registrada somente após execução real.

## Limites

Conclusão em 2026-10-25: a continuidade incorporou a manutenção pendente à entrega do núcleo US-052 ([ADR-0074](0074-parser-ofx-normalizado-compartilhado.md)). Instalação `pnpm install --frozen-lockfile --offline` aprovada e versões executáveis confirmadas. O catálogo contém 54 protocolos atuais; foram retomados os pendentes, com novas evidências reais e sem renovar as datas dos resultados reutilizados. O gate final aprovou 533 testes, sem falhas ou skips. Publicação deste novo incremento segue a autorização vigente do usuário, não esta decisão técnica.

Sem novas dependências de produção, mudança de schema, regras financeiras, permissões, criptografia ou formato de backup. O próximo incremento de produto continua sendo US-052. DP-01 a DP-04, plataformas não homologadas e homologação humana posterior permanecem pendentes. Esta decisão não autoriza commit, push, merge remoto ou deploy.
