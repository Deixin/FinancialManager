# US-044 — Núcleo de categorias por workspace

O núcleo compartilhado permite carregar sugestões, criar, renomear, reordenar, arquivar e reativar categorias sem alterar saldo ou histórico financeiro. A [integração Desktop](desktop-categories.md) foi implementada posteriormente. Este guia registra os contratos e limites da fundação compartilhada. [ADR-0056](../architecture/adr/0056-categorias-compartilhadas-por-workspace.md).

## Contratos

Os quatro pacotes expõem o subpath categories: domain contém CategoryCommand/planCategories; finance-ports contém createCategoryService; storage-schema e persistence-postgres fornecem createSqliteCategoryService/createPostgresCategoryService. O consumidor fornece autorização confiável com can_read/can_manage. Cada chamada informa workspace_id; principal_id é obrigatório em CLOUD e ausente em LOCAL.

- SEED: profile_version=1, finalidade e IDs UUIDv7 previamente gerados. São nove sugestões PERSONAL, nove BUSINESS e duas OTHER. Só catálogo vazio recebe a carga; repetição exata é no-op e não restaura padrões depois de alterações.
- CREATE: UUIDv7, nome, escopo EXPENSE/INCOME/BOTH e sort_order inteiro i32. O serviço fixa ACTIVE e is_seeded=false. Repetição exata do mesmo ID é no-op; divergência é conflito.
- UPDATE: base completa atual, nome, ordem e estado ACTIVE/ARCHIVED. Escopo e is_seeded não podem mudar. Não existe DELETE.
- REORDER: bases completas das categorias ativas e permutação integral dos IDs. O serviço atribui ordens de zero a n−1 sem modificar arquivadas.

list/apply retornam categorias em ordem canônica de ID; apresentação deve ordenar por sort_order e desempatar por ID. changed/category_ids descrevem apenas os registros efetivamente alterados. Intenções devem conservar IDs e bases após resposta perdida; não se deve refazer seed sobre catálogo editado nem rebasear conflitos automaticamente.

Conflitos possuem códigos estáveis CATEGORY_BASE_CONFLICT, CATEGORY_NAME_CONFLICT ou CATEGORY_SEED_CONFLICT. Não carregam dados financeiros nem detalhes SQL. Qualquer falha de lote desfaz todas as linhas. Arquivar conserva referências existentes e permite reutilizar o nome entre ativos; reativar exige que o nome esteja disponível.

Use uma conexão SQLite dedicada por instância do serviço e feche o serviço antes da conexão. O pool PostgreSQL é emprestado por padrão, exige expected_role explícito e conserva RLS. close espera operações já aceitas e recusa chamadas novas. Não componha unidades PostgreSQL aninhadas.

## Reprodução automatizada

```powershell
pnpm build
node --test infra/scripts/categories.test.mjs
node infra/categories/run.mjs
pnpm check
```

O protocolo usa Docker local, PostgreSQL 18 com imagem fixada, porta 127.0.0.1:43221 e armazenamento temporário. Execute sequencialmente aos demais protocolos que usam essa porta. Apenas fixtures sintéticas FIN-002 e workspaces de teste entram nos bancos; não use dados pessoais. O runner remove seus containers, rede, credenciais e bancos e gera .tools/us044-categories/categories.json. Se necessário, node infra/categories/clean.mjs remove somente o ambiente próprio inativo.

A evidência versionada é [us-044-categories-core-2026-10-18.json](../quality/evidence/us-044-categories-core-2026-10-18.json). Os testes verificam também que retirar gates, alterar fontes, incluir payload privado ou alegar Desktop/homologação prematuramente invalida o relatório.

Resultado local em 2026-10-18: pnpm check passou com 390 testes Node, zero falhas/skips, formatação, lint, tipos e build. O protocolo aprovou 55 gates com recursos próprios encerrados. As regressões afetadas de dados e Desktop Chromium/Windows passaram; 16 cápsulas novas ou renovadas compõem 33 relatórios atuais. Esses resultados não representam execução de CI remota ou homologação humana.

## Limites atuais

O incremento compartilhado não acrescentou migration, dependência de produção, tela ou comando Tauri; a integração nativa posterior está documentada no guia Desktop. Categoria não recebe versão/auditoria neste schema: bases completas detectam divergências atuais, mas não ABA. Escrita cloud de produto, outbox/feed e recibos duráveis continuam pendentes. O [primeiro incremento US-045](taxonomy.md) acrescenta os catálogos de subcategorias e tags; edição das associações permanece no incremento seguinte. Normalização foi verificada no corpus português/NFKC existente; Unicode/locale adicional permanece no gate da US-021. Limites de 10 mil linhas e 4 MiB de texto JSON recusam catálogos maiores sem truncamento.

Homologação humana fica para depois da integração completa. DP-01 a DP-04 e os sete documentos originais permanecem preservados.
