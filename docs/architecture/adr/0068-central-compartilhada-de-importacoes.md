# ADR-0068 — Central compartilhada de importações

Estado: aceito para o núcleo compartilhado. Data: 2026-10-20. História: US-050, IM-01/09.

## Contexto

A central precisa consultar origem, conta, autor, estado, contagens e consequências de cada lote. Preparação e revisão não podem alterar saldo. O schema financeiro v2 e o backup Desktop atual ainda não conhecem importações. Ativar tabelas no cofre antes de adaptar backup, restauração e validação nativa permitiria uma exportação incompleta.

## Decisão

Acrescentar políticas puras, um port de central e adapters PostgreSQL/SQLite. O serviço oferece `prepare`, `list` e `detail`. Preparar cria somente um cabeçalho IMPORT/PREPARING, com UUIDv7 fornecido pelo chamador, conta ativa, versão 1, relógio confiável e autor da autorização. Repetir ID, conta e autor retorna o lote atual, sem reiniciar processamento; divergência gera conflito. Nenhuma dessas operações grava movimentações ou revisões financeiras.

Listagem usa filtros de conta/estado e cursor `(created_at,id)` descendente. Detalhe pagina efeitos por ID e conserva links às revisões. Contagens são derivadas das linhas, em strings decimais exatas. A consulta inteira usa um snapshot: PostgreSQL em repeatable read/read only e SQLite em BEGIN; preparação usa transação de escrita, lock por workspace no PostgreSQL e BEGIN IMMEDIATE no SQLite. Cada composição SQLite exige conexão exclusiva; o serviço serializa seus próprios trabalhos e aguarda operações aceitas ao fechar. Falha de rollback inutiliza a instância.

Workspace e modo LOCAL/CLOUD são conferidos em cada operação. A autorização é capturada antes do acesso ao banco e os inputs antes do primeiro await. Uma conta não autorizada não aparece em listagem, detalhe ou replay. Se qualquer efeito alcançar outra conta fora do escopo, o lote inteiro fica oculto. O cursor avança pelo último cabeçalho examinado, inclusive quando a página visível fica vazia. Projeções mínimas de conta e movimentação permanecem nos respectivos módulos; imports não lê tabelas financeiras diretamente. PostgreSQL conserva RLS e rejeita roles privilegiadas, role inesperada e unidades aninhadas.

## Schema e implantação

A migration v3 cria `import_batch`, `import_source`, `import_item` e `import_effect`, com chaves compostas por workspace/lote, efeito append-only e FKs que vinculam revisão à movimentação correta. Fontes guardam metadados, hash e versão do leitor; não guardam o arquivo. Até a atribuição do leitor, nome/versão do parser são nulos em conjunto. `version` e `failure_code` explícitos permitem evoluir o ciclo sem inferir sucesso de uma falha.

O modelo original marca data/valor normalizados como obrigatórios, enquanto o fluxo exige conservar linhas inválidas na revisão. Esta decisão esclarece somente esse ponto: `INVALID` e `SKIPPED` podem ter data/valor ausentes; outras disposições exigem ambos. Ausência não é convertida para zero nem para uma data inventada. Não altera a representação de dinheiro: INTEGER/bigint de 64 bits no banco e string decimal nos contratos que o expõem. Os sete documentos originais são preservados.

O catálogo v3 é opt-in (`sqliteImportCatalog`/`postgresImportCatalog`); os catálogos padrão e o Desktop continuam na v2. A integração Desktop deve ativar o catálogo junto com IPC/Rust, backup, restauração e seus testes, em incremento próprio da US-050. Não há endpoint cloud, grant de runtime automático ou dependência de produção nova. O autor é validado como ID; sua FK para membership depende da implantação futura desse módulo, mantendo cloud fechado por configuração.

Downgrade só é aceito com as quatro tabelas vazias. SQLite verifica sob lock de escrita. PostgreSQL adquire lock exclusivo e permite a leitura administrativa pelo proprietário durante a verificação; se houver dados, a transação falha e restaura também FORCE RLS. Não há autorização de runtime ampliada por esse procedimento. O downgrade não apaga lotes existentes.

## Segurança, verificação e limites

Payloads e resultados têm formato exato, limites e captura imutável. A central limita página a 100, fontes a 16, itens a 200 mil e efeitos a 400 mil por lote. Escopos restritos recusam cobertura acima de 10 mil movimentações afetadas. Nomes não aceitam caminhos; erros operacionais expõem códigos seguros. Metadados e originais sintéticos não entram em logs. Não existe interpretação de arquivo, execução de conteúdo, parser, confirmação financeira, reversão ou deduplicação automática neste incremento.

O protocolo usa PostgreSQL 18 em Docker local e SQLite reais, revisões financeiras existentes, testes negativos de constraints/RLS, falhas após INSERT, downgrade vazio/não vazio, leituras concorrentes, reabertura e limpeza. Consulte [implementação e validação](../../development/import-central.md). UI/Rust/portabilidade Desktop, parsers, staging editável, commit financeiro e processamento local permanecem nos incrementos correspondentes. Cloud/Mobile, outbox/feed e homologações humanas conservam seus gates. DP-01 a DP-04 não são resolvidas por esta decisão.
