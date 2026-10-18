# ADR-0063 — Rateios versionados compartilhados

Data: 2026-10-18. Estado: adotado na base compartilhada da US-046; editor Desktop pendente.

## Contexto

US-046, MV-04 e I-04/I-05 exigem múltiplas parcelas cuja soma seja o módulo exato da movimentação, com subcategorias do pai correto. A US-045 permite preservar rateios e editar tags, mas recusa substituir suas parcelas. A operação precisa reutilizar autorização, controle de versão, grupos e auditoria existentes.

## Decisão

Domain recebe uma política pura de alocações, exposta pelo subpath público classification junto às políticas de classificação. Finance-ports/classification expõe createAllocationService sobre applyGuarded do coordenador de revisões. Os módulos novos são independentes da UI e não criam outro gravador ou SQL de movimentações. Os exports existentes de classificação permanecem compatíveis.

A intenção contém base completa e allocation: KEEP conserva parcelas; CLEAR remove explicitamente a classificação monetária; REPLACE fornece o conjunto final de uma a mil parcelas. REPLACE vazio é recusado. Remover uma linha requer que as restantes fechem o total; CLEAR conserva tags e os demais campos. Não há preenchimento de diferença, arredondamento ou distribuição automática. Reconciliação de itens de documentos, ajustes explícitos e descontos proporcionais permanecem nas histórias documentais.

Cada parcela tem ID, categoria, subcategoria ou null, valor positivo i64 em string decimal canônica e nota ou null. IDs existentes podem permanecer; novos exigem UUIDv7 no serviço. Arrays são copiados, ordenados e congelados antes da primeira espera. O lote admite até 256 transações únicas e 4 Mi unidades UTF-16 de JSON. A soma usa BigInt com intermediários maiores que i64. O mínimo i64 admite duas ou mais parcelas positivas, cada qual dentro de i64; zero admite KEEP/CLEAR, sem parcela positiva fictícia.

Somente allocations muda. Tags, valor, conta, data, contraparte, grupo, descrições, origem e natureza econômica permanecem iguais. A base inteira precisa coincidir com o estado autorizado atual. Excluídas são recusadas. IDs de alocações não podem ser apropriados de outra transação; a colisão desfaz o lote inteiro pelas constraints existentes.

Novas associações exigem referências ativas, do mesmo workspace, subcategoria sob o pai escolhido e escopo econômico compatível. Entrada aceita INCOME/BOTH; gasto/estorno aceita EXPENSE/BOTH; demais naturezas aceitam BOTH. Uma associação arquivada já presente pode permanecer no mesmo ID, inclusive ao revisar valor/nota, ou ser removida. Troca de referência ou ID constitui nova associação e exige referência ativa. Catálogo é obtido uma vez, de forma preguiçosa, pelo módulo proprietário na mesma transação, após autorização. Lock PostgreSQL e transação imediata SQLite seguem ADR-0059.

Transferências e pagamentos exigem ambos os membros e autorização sobre ambas as contas; o parceiro pode usar KEEP. Apenas registros alterados recebem revisão MANUAL. Um no-op não altera versão ou histórico. Repetir após ACK perdido usa a mesma intenção/base; commit anterior produz conflito. Consumidores devem recarregar e revisar explicitamente. A reversão usa o histórico existente, registra REVERSAL e respeita revisões posteriores.

## Consequências e verificação

Sem migration, dependência de produção, alteração de backup, endpoint ou novo comando Tauri. A US-046 continua em andamento até a integração do editor Desktop, paridade Rust e interface de revisão. Web/Mobile, outbox/feed e recibos duráveis mantêm seus gates. Tags continuam organização da movimentação inteira, sem distribuição proporcional entre parcelas.

O [protocolo](../../development/allocations.md) executa os mesmos cenários em PostgreSQL e SQLite: soma exata e extremos, múltiplas categorias, IDs/notas, referências arquivadas e de outro workspace, bases forjadas, origem importada, grupos completos, concorrência, rollback, reversão e LOCAL sem identidade cloud. Compara grafos com representação temporal canônica. Relatórios contêm apenas flags, versões, hashes e pendências. Homologações humanas após integração completa; DP-01 a DP-04 e os sete originais permanecem preservados.
