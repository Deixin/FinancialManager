# Contribuindo

Comece pelo [índice da documentação](docs/00-index.md) e pelo [estado do projeto](docs/delivery/status.md). Vincule cada implementação à história e aos critérios de aceite do backlog.

## Fluxo

1. Parta de main e crie uma branch curta, por exemplo feat/us-001-desktop-storage.
2. Leia a documentação da história e registre decisões técnicas relevantes em um ADR.
3. Implemente apenas o escopo acordado, incluindo testes de comportamento quando aplicável.
4. Siga o [processo incremental](docs/development/validation-workflow.md): planeje as regressões, execute o runner e seu `pnpm check` final; revise a alteração, incluindo dados e arquivos adicionados.
5. Abra um pull request com problema, resultado, histórias e evidência de validação.

Os comandos e o ambiente estão no [README](README.md). O lockfile deve acompanhar mudanças de dependências. Os limites de importação e dependência são verificados por pnpm check:repo.

## Dados e documentação

Use apenas fixtures sintéticas, conforme [docs/quality/fixtures.md](docs/quality/fixtures.md). Remova informações pessoais de exemplos de erro e capturas. Não inclua extratos reais, notas fiscais reais, tokens ou backups.

Markdown em docs é a fonte textual de trabalho; Word em docs/_exports preserva a entrega v1.0. Não atualize um arquivo Word antigo como substituto de atualizar a especificação canônica. Os conceitos visuais devem ser interpretados à luz do PRD.

## Configuração recomendada no provedor

Após o primeiro push, proteja main com pull requests, revisão e a CI obrigatória para Linux e Windows. Bloqueie force push e exclusão da branch. Essas regras dependem da configuração do provedor e não são aplicadas por arquivos locais.

A CI inicial verifica o bootstrap. Builds nativos, testes de integração, isolamento entre tenants e fluxos financeiros devem ser acrescentados nas respectivas histórias.
