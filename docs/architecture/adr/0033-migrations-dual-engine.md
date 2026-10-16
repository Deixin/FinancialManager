# ADR-0033 — Migrations transacionais dual-engine

Status: framework validado em PostgreSQL/SQLite; integração aos hosts de produto pendente.

Data: 2026-10-16. História: US-022. Referências: modelo de dados §17, US-020/021 e ADR-0031/0032. Não altera os sete documentos originais ou DP-01 a DP-04.

## Contexto

Os runners iniciais aceitam somente a versão 1. Precisamos evoluir bancos existentes com histórico verificável, serialização e recuperação após interrupção, sem assumir que qualquer downgrade é seguro.

## Decisão

O subpath migrations de storage-schema fornece catálogo SQLite imutável, SHA-256, planejamento e runner transacional. O operador PostgreSQL em infra/schema/postgres-migrations.mjs usa o mesmo planejador e lê os SQL versionados da API. O pacote permanece puro e permitido somente em Desktop/Mobile; a ferramenta Node não amplia a fronteira de imports da API. Nenhuma dependência externa de produção foi adicionada. SHA-256 é fornecido pelo host confiável; Node usa node:crypto, sem criptografia própria.

O histórico aplicado deve ser um prefixo contíguo do catálogo. Checksum divergente, versão futura, lacuna, alvo inválido ou ausência de inversa impedem o plano completo. A versão 1 conserva o checksum de bytes anterior; versões posteriores cobrem versão, nome, SQL up/down e destrutividade. Não se edita uma migration instalada: alterações exigem nova versão. Catálogos/SQL são código confiável distribuído com a aplicação, nunca conteúdo recebido de UI, HTTP ou arquivos de usuários.

Uma chamada aplica todo o plano em uma transação, confirmando histórico e DDL juntos. PostgreSQL mantém SET LOCAL ROLE fm_schema_owner, search_path pg_catalog, limites de espera/statement e o advisory lock (6020,1) do runner anterior; aceita somente a família 18. SQLite verifica foreign_keys, ativa recursive_triggers/trusted_schema=OFF, usa BEGIN IMMEDIATE e verifica foreign_key_check antes/depois. O adaptador deve fornecer conexão exclusiva, desbloqueada e configurada para durabilidade pelo host. Após falha, o host fecha/descarta a conexão; PostgreSQL descarta também conexão com rollback falho. Não há retry automático de commit incerto: reabrir e conferir o histórico através de nova execução idempotente.

A migration 0002 cria balance_reference_lookup por workspace/conta/data/ID. O up amplia a tabela técnica de version=1 para version>0: SQLite reconstrói somente essa tabela técnica, PostgreSQL troca o CHECK. Esses comandos também estão cobertos pelo checksum. O down remove o índice e o registro aplicado 2; a tabela técnica conserva capacidade de versões posteriores. Dados/constraints financeiros permanecem; não se promete equivalência byte a byte do arquivo após downgrade. O baseline 1 não possui down; alvo 0 é recusado. Runners antigos falham quando encontram histórico com versão 2.

Migrations destrutivas são recusadas antes de tocar o banco, sem flag de exceção. A habilitação futura exige snapshot protegido, validação e recuperação integrados ao cofre, conforme §17 e G07-VAULT. O histórico guarda versões atualmente aplicadas, não uma trilha de todas as operações de deploy.

assertSchemaCompatibility exige uma janela explícita. Não negocia protocolo, transforma payload ou define a janela de produção da API. schema_version de banco/cofre, backup_manifest, export_schema_version e versões de parsers são conceitos separados. Adoção nos manifestos e hosts Rust/Expo e adaptadores de clientes antigos seguem nas histórias correspondentes.

O catálogo admite somente SQL transacional revisado, sem COMMIT/ROLLBACK próprios, efeitos externos ou DDL que exija sair da transação. CREATE INDEX convencional preserva atomicidade e pode bloquear escritores, conforme a [documentação PostgreSQL](https://www.postgresql.org/docs/18/sql-createindex.html). BEGIN IMMEDIATE e SQLITE_BUSY seguem a [documentação SQLite](https://www.sqlite.org/lang_transaction.html). Não há promessa de upgrade online sem bloqueios ou recuperação após perda de energia em qualquer hardware.

## Alternativas

Repetir runners de versão única duplicaria regras de histórico. ORM/biblioteca adicional não é necessário para esse catálogo pequeno e anteciparia G07-QUERY. Downgrade genérico por remoção de tabelas arriscaria perda de dados. Testar somente rollback por exceção seria insuficiente para demonstrar recuperação após término de processo.

## Evidência e limites

O [protocolo](../../development/schema-migrations.md) passou em PostgreSQL 18.6 real no Docker local e SQLite 3.53.3 em arquivo: instalação vazia 0→2, adoção 1→2, down 2→1, repetição, concorrência, planos inválidos e seis encerramentos forçados por engine. Os checkpoints são após DDL, após histórico e antes do commit, em ambos os sentidos. Cada recuperação preservou histórico, índice e snapshot financeiro anteriores. Os 33 casos FIN-SCHEMA-001 passaram por engine; RLS/FORCE RLS e negação de escrita de runtime no histórico foram mantidas. O [relatório sanitizado](../../quality/evidence/us-022-migrations-2026-10-16.json) registra gates, versões e hashes, sem conteúdo financeiro.

Os testes SQLCipher Windows/Android da US-021 continuam evidência do schema inicial. O novo runner JavaScript exige integração/homologação nos hosts nativos e no validador de backup do produto. G07-VAULT, iOS e os demais gates permanecem separados. Esta decisão aprova o framework no alcance testado, sem aprovar release Desktop/Mobile/API ou resolver offline, retenção e papéis.
