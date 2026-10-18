# ADR-0059 — Associação versionada de classificação

Data: 2026-10-18. Estado: adotado no núcleo compartilhado da US-045; integração Desktop pendente.

## Contexto

RF-15 e US-045 exigem associar categorias, subcategorias e tags às transações e filtrá-las sem alterar saldo. ADR-0058 entregou os catálogos; revisões financeiras já preservam origem, versão-base, snapshots e atomicidade de grupos. Não se deve criar um segundo caminho de escrita que ignore esses controles.

## Decisão

Política pura em domain/classification e createClassificationService em finance-ports/classification compõem applyGuarded do coordenador existente. Não há SQL novo de movimentações. A classificação compara a base completa com o estado efetivamente carregado e limita a alteração a allocations/tag_ids. Conta, grupo, data, valor, natureza econômica, contraparte, descrições e origem permanecem iguais. Transação excluída é recusada. UUIDv7 é exigido ao criar a primeira alocação.

RevisionTransaction ganha taxonomyCatalog opcional e o guard recebe readTaxonomy opcional, ambos exclusivamente confiáveis e fora de HTTP/IPC. Os adapters PostgreSQL/SQLite compõem o módulo proprietário de categorias na mesma transação. A leitura é preguiçosa e ocorre após autorização, escopo de contas e leitura da transação; é reutilizada no lote. Ausência dessa capacidade impede classificar, com CONFIGURATION_INVALID. Serviços antigos de revisão continuam disponíveis sem exigir o novo port em adapters de teste que não classificam.

O lock PostgreSQL 6026, compartilhado com gestão dos catálogos, e BEGIN IMMEDIATE no SQLite impedem que uma referência seja desativada entre validação e commit por esses serviços. RLS, validação de papel e restrições de workspace permanecem ativas. Não há consulta de tabelas de outro módulo dentro dos adapters financeiros. Somente a composição coordena os proprietários.

Cada intenção contém base completa, seleção KEEP/CLEAR/SET e conjunto final de tag_ids. KEEP conserva todas as alocações, inclusive rateios; permite editar tags sem tocar parcelas. SET/CLEAR só operam sobre zero ou uma alocação. SET conserva o ID e a nota existentes, usa o módulo exato do valor e exige categoria e subcategoria coerentes. Zero e mínimo i64 não admitem uma nova alocação positiva i64; tags com KEEP continuam possíveis. CLEAR é a remoção explícita da classificação única. O editor de rateio e revisão das parcelas ficam na US-046.

Novas tags, categorias e subcategorias precisam estar ativas no mesmo workspace. Subcategoria pertence à categoria indicada e exige pai ativo. Referências arquivadas já presentes podem permanecer ou ser removidas, preservando a história; não podem ser reintroduzidas como novas escolhas. Para mudança de classificação, INCOME aceita INCOME/BOTH; EXPENSE e EXPENSE_REVERSAL aceitam EXPENSE/BOTH; outras naturezas aceitam BOTH. Classificar uma transferência não a transforma em consumo, e liquidação de dívida permanece separada de despesa.

O lote admite até 256 transações e 4 Mi unidades UTF-16 de JSON. Composições exigem os dois membros e autorização sobre ambas as contas, mesmo para manter o parceiro inalterado. Todos os planos são validados antes das escritas; uma falha desfaz dados e auditoria. Somente membros alterados recebem nova revisão. No-op não cria revisão. Repetição de uma alteração confirmada com base antiga retorna conflito; o consumidor deve recarregar e revisar, sem rebase automático. Reversão utiliza o histórico e a versão corrente pelo mecanismo existente, registrando REVERSAL.

Filtros puros em filterClassifications operam exclusivamente sobre snapshot já autorizado, consistente e completo fornecido pelo host. Combinam categoria/subcategoria na mesma parcela, tags ANY/ALL e opção sem classificação monetária. Cada transação aparece uma vez, mesmo quando tem várias tags ou linhas repetidas idênticas. Estados divergentes do mesmo ID geram conflito explícito. Excluídas ficam de fora. O resultado conserva conteúdo financeiro e ordem por data/ID decrescente. Tags sobrepostas não são parcelas aditivas de orçamento.

O helper não autoriza leituras nem transforma uma página parcial em resultado global. O host deverá garantir autorização, cobertura completa e aviso de não aditividade antes de apresentar resultados ao usuário. Snapshot limita 10 mil entradas e 4 Mi unidades UTF-16 de JSON; excesso é recusado sem truncar. Paginação/consulta remota filtrada não é entregue neste incremento.

## Consequências e verificação

Sem migration, dependência de produção, mudança de backup, endpoint, permissão Tauri ou UI nova. A US-045 segue em andamento até integração Desktop, paridade nativa, leitura autorizada/cobertura e apresentação dos filtros. Escrita cloud de produto e outbox/feed mantêm seus gates; não se presume sincronização a partir da gravação PostgreSQL de teste. Metadados de catálogo continuam sem versão/auditoria monotônica conforme ADR-0058.

O protocolo real compara grafos nos dois bancos e cobre referências, escopo econômico, concorrência, capturas antes de await, grupos completos, rollback da segunda revisão, preservação de origem importada, reversão, modo LOCAL e filtros deduplicados. Consulte o [guia](../../development/classification.md). Homologações humanas seguem após integração completa; DP-01 a DP-04 e os sete originais são preservados.
