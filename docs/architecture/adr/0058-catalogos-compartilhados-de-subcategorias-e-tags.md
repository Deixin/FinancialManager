# ADR-0058 — Catálogos compartilhados de subcategorias e tags

Data: 2026-10-18. Estado: adotado como primeiro incremento da US-045; associação às movimentações e integração Desktop pendentes.

## Contexto

RF-15, CF-01/02 e US-045 exigem subcategorias e tags criadas pelo usuário, preservação do histórico e filtros sem alterar saldo. O schema v2 já contém subcategory, tag e suas referências. Este incremento entrega a gestão dos catálogos no núcleo compartilhado. A edição das associações utilizará as revisões financeiras existentes em incremento próprio; US-046 continua responsável pelo editor de rateio.

## Decisão

Os quatro pacotes expõem o subpath taxonomy: política pura em domain, autorização e coordenação em finance-ports e adapters de PostgreSQL/SQLite. A gestão pertence ao módulo categories; nenhuma operação consulta ou escreve tabelas financeiras. O serviço exige autorização confiável separando can_read/can_manage, confirma o modo de armazenamento e restringe cada consulta ao workspace. LOCAL dispensa principal; CLOUD exige principal e RLS. Não se habilita rota cloud de produto neste incremento.

Não há sugestões automáticas de subcategorias ou tags. CREATE exige UUIDv7 e estado ACTIVE; replay do mesmo ID e conteúdo é no-op. UPDATE exige base completa e conserva tipo, identidade, workspace e categoria de origem. Não há exclusão física ou mudança de categoria de uma subcategoria: essas operações exigiriam remapeamento explícito de referências. Arquivar conserva IDs, vínculos e revisões financeiras. Reativação exige nome disponível e, para subcategoria, categoria ativa. Categoria arquivada impede criar novos filhos; filhos existentes continuam legíveis e seus metadados podem ser mantidos.

Nomes novos usam trim, até 120 unidades UTF-16 e rejeitam controles. A chave de comparação usa NFKC, espaços colapsados e minúsculas, como categorias. Tags têm unicidade ativa por workspace; subcategorias por categoria. Nomes de tipos diferentes não conflitam. Duplicatas legadas de subcategorias permanecem legíveis e podem ser arquivadas gradualmente; criação, reativação ou mudança de chave não introduzem novas duplicatas. Não se acrescenta uma constraint retroativa ao schema. A coluna gerada PostgreSQL permanece como está; SQLite deriva normalized_name para tags. O corpus português/NFKC não resolve equivalência de todo Unicode/locale da US-021.

REORDER_SUBCATEGORIES exige bases completas e permutação de todos os filhos ativos da categoria indicada; atribui ordens de zero a n−1, preservando outras categorias e itens arquivados. sort_order é i32. Tags não têm ordem persistida. Pesquisa aplica a mesma normalização ao nome e ao termo; filtros de tipo, estado e categoria são combinados. A leitura devolve categorias para contextualizar a hierarquia e itens filtrados, em ordem estável.

SQLite usa conexão dedicada, fila e BEGIN IMMEDIATE. Falha de rollback inutiliza a instância. PostgreSQL valida papel sem owner/superuser/bypass, configura contexto de workspace e usa advisory lock 6026, compartilhado com categorias e operações financeiras. Todos os planos são validados antes da primeira escrita; falha de lote desfaz tudo. close espera chamadas aceitas e recusa chamadas novas. Catálogo limita categorias conforme US-044, itens de taxonomia a 10 mil e snapshot/intenções a 4 Mi unidades UTF-16 de JSON; recusa excesso sem truncar.

Bases completas detectam divergência atual, sem sobrescrita automática; não detectam ABA. Versão monotônica, auditoria de metadados, outbox/feed e recibos duráveis permanecem necessários antes de expor escrita cloud de produto.

## Consequências e verificação

Não há migration, dependência de produção, mudança de backup, comando Tauri ou tela nova. Este catálogo não altera associações financeiras existentes. A US-045 continua em andamento: faltam associação versionada às transações, filtros de movimentações com deduplicação de tags e integração Desktop. Tags sobrepostas não representam parcelas aditivas do orçamento.

O protocolo real exercita os dois bancos, concorrência, falhas, autorização, RLS, categorias arquivadas, busca, persistência após reabertura e preservação de vínculos, saldos e histórico de itens usados. Relatórios incluem apenas flags, versões, pendências e hashes; recursos e credenciais sintéticos são removidos. Consulte o [guia](../../development/taxonomy.md).

DP-01 a DP-04 e os sete originais permanecem preservados. Homologações humanas seguem após integração completa, conforme ADR-0044 e instrução do usuário.
