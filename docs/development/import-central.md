# US-050 — Núcleo compartilhado da central de importações

O serviço compartilhado prepara cabeçalhos e consulta histórico por workspace, conta e estado. Os adapters PostgreSQL/SQLite retornam origem, conta, autor, contagens e links de efeitos/revisões por lote, em snapshot consistente. Decisão: [ADR-0068](../architecture/adr/0068-central-compartilhada-de-importacoes.md).

## Contrato e persistência

`createImportCentralService` está em `@financial-manager/finance-ports/imports`; as composições são `createPostgresImportCentralService` em `@financial-manager/persistence-postgres/imports` e `createSqliteImportCentralService` em `@financial-manager/storage-schema/imports`. O host fornece autorização e relógio confiáveis; o PostgreSQL também exige pool/role explícitos. SQLite exige conexão exclusiva, já aberta pelo host. Fechar o serviço não fecha a conexão emprestada.

`prepare(request,{id,target_account_id})` captura a intenção antes de autorizar e cria somente um lote PREPARING. O ID deve ser UUIDv7. Uma tentativa igual retorna o lote existente mesmo que ele já tenha avançado; mudar conta ou autor com o mesmo ID retorna conflito. Conta arquivada impede nova preparação; não impede a consulta histórica ou a repetição da intenção original autorizada. LOCAL anônimo exige ausência de principal e autor nulo.

`list(request,{statuses,account_id,cursor,limit})` aceita estados vazios para todos, conta nula para todas autorizadas e cursor nulo para a primeira página. A ordenação é `created_at DESC,id DESC`. O cursor é o último cabeçalho examinado; páginas vazias podem ter continuação quando efeitos tornam lotes invisíveis ao escopo de contas.

`detail(request,{id,effect_after,effect_limit})` retorna cabeçalho, fontes, contagens por disposição/ação e efeitos paginados, com IDs de item, movimentação e revisões. Não retorna descrições ou valores das linhas. Contagens são strings decimais, incluindo zero. O leitor recusa limites excedidos e metadados inconsistentes; não declara cobertura parcial como completa. Lotes que atinjam contas não autorizadas ficam integralmente ocultos.

A migration v3 é deliberadamente opt-in. Use `sqliteImportCatalog` de `@financial-manager/storage-schema/import-migrations` no migrador SQLite e `postgresImportCatalog()` de `infra/import-central/migrations.mjs` na ferramenta administrativa PostgreSQL. O catálogo padrão continua v2. A ferramenta não concede acesso cloud de runtime; RLS restritiva e configuração explícita continuam obrigatórias. Downgrade exige ledger vazio e não remove dados existentes.

## Validação reproduzível

Execute `pnpm build`, `node infra/import-central/generate.mjs --check`, `node infra/import-central/run.mjs` e `pnpm check`. O protocolo exige Docker local; usa PostgreSQL 18.6 fixado por digest, porta 43221, dados FIN-002 e fixtures adicionais explicitamente sintéticas. Não execute junto de outro produtor que use essa porta ou recompile os mesmos arquivos `dist`. Para limpeza manual do ambiente próprio, use `node infra/import-central/clean.mjs`.

Os cenários verificam preparação/replay/conflito, concorrência, paginação com timestamps iguais, cada estado/disposição/ação, fontes e revisões sem misturar lotes, contas restritas, captura antes de await, fechamento, rollback, constraints, RLS, anonimato local, efeito append-only e ausência de mudança financeira. A comparação entre engines usa versões persistidas para revisões cujos UUIDs são gerados independentemente, e cada ID exato é verificado no próprio banco. Leituras com writer concorrente verificam snapshot nos dois bancos; SQLite usa WAL somente no teste. A migração faz roundtrip vazio e recusa downgrade com dados, preservando FORCE RLS. Reabertura e remoção dos recursos são verificadas antes de publicar a cápsula.

O resultado próprio fica em `.tools/us050-import-central/imports.json`, com SHA-256 das fontes e códigos de checks. A [evidência PostgreSQL/SQLite](../quality/evidence/us-050-import-central-2026-10-20.json) registra os gates aprovados e o encerramento dos recursos. O protocolo inclui a preservação de períodos ao mudar o fuso horário do processo Node; datas financeiras são projetadas como texto ISO no SQL. Apenas relatório aprovado, atual e com recursos encerrados pode ser arquivado em `docs/quality/evidence`. A validação final também renova os protocolos anteriores afetados pelos exports e pelas fronteiras compartilhadas. CI remota e homologação humana não são presumidas por execução local.

Resultado local final: `pnpm check` aprovado com 503 testes Node, sem falhas ou skips; 60 gates no protocolo próprio e 12 testes próprios aprovados. As 13 suítes de dados, dez Chromium e dez Windows afetadas passaram novamente. Foram arquivadas 33 evidências renovadas e uma nova; 51 relatórios atuais conferem com 561 hashes únicos de fontes, incluindo os 17 relatórios não afetados. Os sete documentos originais permanecem byte a byte idênticos. Recursos sintéticos próprios encerrados; sem execução de CI remota ou homologação humana.

## Continuidade

A [integração Desktop](desktop-imports.md) e o [ADR-0069](../architecture/adr/0069-central-de-importacoes-no-desktop.md) adotam a v3 no cofre, backup e restauração, com interface, paridade Rust e 35 comandos específicos. Os catálogos padrão compartilhados continuam v2; a composição de importações mantém adoção explícita. Parsers, validação defensiva, staging editável, confirmação atômica e processamento local pertencem às US-051–057. A reversão de lote não é habilitada por um simples link de histórico. Web/Mobile e sincronização mantêm seus gates. Homologações humanas permanecem após integração completa.
