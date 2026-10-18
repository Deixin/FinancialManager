# US-045 — Catálogos de subcategorias e tags

Primeiro incremento compartilhado da US-045: gestão de subcategorias e tags por workspace em PostgreSQL/SQLite, sem modificar valores, associações ou revisões de movimentações. [ADR-0058](../architecture/adr/0058-catalogos-compartilhados-de-subcategorias-e-tags.md). A [associação versionada e os filtros puros](classification.md) foram implementados posteriormente; integração Desktop e leitura autorizada/cobertura continuam pendentes.

## Contratos

O subpath taxonomy está disponível em domain, finance-ports, storage-schema e persistence-postgres. Use createTaxonomyService ou seus adapters createSqliteTaxonomyService/createPostgresTaxonomyService. A autorização confiável usa can_read/can_manage e modo LOCAL/CLOUD, como categorias. Cada chamada recebe workspace_id; principal_id é obrigatório em CLOUD e ausente em LOCAL.

Um Tag contém kind=TAG, id, workspace_id, name e status. Uma Subcategory contém kind=SUBCATEGORY e também category_id/sort_order. Nenhum desses contratos transporta dinheiro. A categoria da subcategoria é imutável; referências já existentes exigiriam remapeamento para permitir movê-la.

- CREATE: item completo, UUIDv7 e estado ACTIVE. Não existem seeds ou estruturas criadas por sugestões. Repetição exata é no-op; divergência do mesmo ID é conflito.
- UPDATE: base e item completos. Permite nome, estado e ordem de subcategoria; preserva identidade e categoria. Divergência da base produz TAXONOMY_BASE_CONFLICT.
- REORDER_SUBCATEGORIES: category_id, bases de todos os filhos ativos e permutação integral dos IDs. Atribui ordem de zero a n−1 atomicamente. Itens arquivados e outras categorias ficam intactos.

apply retorna changed, item_ids com tipo/ID, categorias e catálogo completo de itens. list aceita consulta com kind=ALL/TAG/SUBCATEGORY, status=ALL/ACTIVE/ARCHIVED, category_id nulo ou ID e search. Os filtros se combinam; busca ignora caixa, espaços repetidos e variantes NFKC. TAG com category_id é inválido. Subcategorias são ordenadas por categoria, ordem, nome e ID; tags por nome/ID.

Nomes ativos equivalentes conflitam por workspace para tags e por categoria para subcategorias. Arquivar preserva referências e permite reutilizar o nome; reativar exige nome disponível. Categoria arquivada impede novos filhos e reativação, sem ocultar os filhos existentes. Nomes legados inalterados são preservados, inclusive ao arquivar. Duplicatas legadas podem ser corrigidas gradualmente.

Capture e conserve a intenção e suas bases após resposta perdida. CREATE exato pode ser repetido; UPDATE/reordenação devem ser revistos diante de conflito. Bases completas não detectam ABA; não há recibo durável ou versão de metadados neste schema.

O serviço SQLite exige conexão dedicada; não compartilhe uma conexão entre instâncias concorrentes. Feche o serviço antes da conexão. Falha de rollback exige nova instância/conexão. PostgreSQL usa pool emprestado por padrão, expected_role explícito, RLS e advisory lock 6026; recusa owner/bypass e unidades aninhadas. close espera operações aceitas.

## Reprodução e evidências

```powershell
pnpm build
node infra/taxonomy/run.mjs
node --test infra/scripts/taxonomy.test.mjs
pnpm check
```

O runner usa somente fixtures sintéticas FIN-002 e workspaces de teste em Docker local, PostgreSQL 18 com imagem fixada e SQLite real. A porta 127.0.0.1:43221 é compartilhada pelos protocolos de dados: execute-os sequencialmente. O ambiente próprio é temporário e isolado; o runner remove containers, rede, credenciais e bancos, gerando .tools/us045-taxonomy/taxonomy.json. Para recuperação após interrupção, node infra/taxonomy/clean.mjs remove somente recursos próprios inativos.

O protocolo inclui regressões de revisões/categorias e doze cenários de taxonomia por engine, comparação dos catálogos, LOCAL anônimo e recusa de owner/RLS/unidade aninhada. A reabertura compara o catálogo persistido; arquivamento de itens usados conserva vínculos, saldos e histórico. A [evidência](../quality/evidence/us-045-taxonomy-core-2026-10-18.json) exige todos os gates, limpeza e hashes atuais. Relatórios anteriores são preservados como históricos.

Validação local concluída em 2026-10-18: pnpm check passou com 409 testes Node, zero falhas/skips, formatação, lint/fronteiras/geração, tipos e build. O protocolo próprio aprovou 82 gates em PostgreSQL/SQLite; regressões de repositories, revisões, invariantes, contas, movimentações, transferências e cartões, além dos cinco fluxos Desktop afetados em Chromium/Windows, passaram. Foram arquivadas 19 cápsulas novas ou renovadas, preservando as anteriores. As 36 evidências atuais conferem com 405 hashes de fontes no Git staging; recursos sintéticos próprios foram encerrados. Isso não representa execução de CI remota ou homologação humana.

## Limites e próximo incremento

Nenhuma migration, dependência de produção, tela ou permissão IPC nova. O catálogo é limitado a 10 mil itens de taxonomia, além das categorias, e 4 Mi unidades UTF-16 de JSON; excesso é recusado. Normalização usa o corpus português/NFKC existente; Unicode/locale adicional permanece no gate da US-021.

O [incremento de associação](classification.md) acrescenta categoria/subcategoria/tags às transações usando revisão-base e histórico, com filtros puros deduplicados. Próximo incremento integra Desktop e leitura autorizada/cobertura. US-046 mantém o editor de rateio. A futura apresentação deve explicar que tags sobrepostas não são partes aditivas do orçamento. Escrita cloud de produto, auditoria/versão dos metadados, outbox/feed e recibos duráveis seguem pendentes. Homologações humanas ficam após integração completa; DP-01 a DP-04 e os sete originais permanecem intactos.
