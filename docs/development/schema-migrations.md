# US-022 — Framework de migrations dual-engine

O framework executa upgrades/downgrades transacionais sobre o núcleo US-020/021. [ADR-0033](../architecture/adr/0033-migrations-dual-engine.md), [aceite US-022](../delivery/05-backlog.md) e modelo de dados §17 delimitam o escopo. Não aplica alterações automaticamente aos cofres, perfis US-014 ou serviços de produto.

## Uso e contrato

```ts
import { migrateSqliteTo } from '@financial-manager/storage-schema/migrations';

// Conexão exclusiva do adaptador confiável; SHA-256 oferecido pelo host.
await migrateSqliteTo(connection, { sha256, target: 2 });
```

O operador PostgreSQL é migratePostgresTo(pool, { target: 2 }) em infra/schema/postgres-migrations.mjs, com a credencial dedicada de migrator. Sem target, ambos usam a última versão distribuída. Retornam from, to e applied; repetição retorna applied=0. O planejador e assertSchemaCompatibility são exportados pelo mesmo subpath. Catálogo opcional é uma extensão interna confiável para ferramentas/testes, nunca entrada de usuário.

O catálogo contém baseline 1 irreversível e versão 2 reversível: amplia o histórico técnico e acrescenta um índice de balance_reference. target=1 remove o índice e registro aplicado 2, preservando dados financeiros e a tabela técnica ampliada. Alvo 0, versão desconhecida, lacuna/checksum divergente, inversa ausente e mudança destrutiva são recusados. Checksum 2 cobre up, down, nome, número e destrutividade. Não edite uma migration instalada.

SQLite exige foreign_keys e BEGIN IMMEDIATE; o host configura busy timeout, SQLCipher, chave e durabilidade. PostgreSQL usa fm_schema_owner, advisory lock compartilhado com o runner inicial e uma transação. Falhas usam códigos fixos sem SQL, parâmetros ou causas do driver. Descarte a conexão após falha e reabra; não repita um commit incerto na mesma conexão. Não invoque dentro da transação do chamador. Migrations devem conter somente SQL transacional, sem controle de transação próprio ou efeitos externos.

Mudanças destrutivas ficam bloqueadas até existir backup protegido/validado no host. Exportação, manifestos de backup e janela de payloads da API não são derivados da versão física. Adoção Rust/Expo, restore e policy engine seguem nas histórias próprias.

## Protocolo reproduzível

Com Node/pnpm fixados pelo repositório e Docker Linux local:

```text
pnpm schema:migrations:generate
pnpm schema:migrations:check
pnpm schema:migrations:test
pnpm check
```

O runner cria somente financial-manager-us022, em .tools/us022-migrations, PostgreSQL pinado por digest, tmpfs e porta 43221 em 127.0.0.1. Reutiliza corpus/roles sintéticos US-021; não execute os dois protocolos simultaneamente nessa porta. Senhas aleatórias são transmitidas aos filhos por IPC, nunca por argumentos ou relatório. Leituras financeiras usam logins autorizados por workspace, sem owner/BYPASSRLS. Não acessa dados reais ou a VM Windows US-001.

Dez gates são verificados:

1. Instalação vazia 0→2 e downgrade suportado nos dois engines.
2. Encerramento forçado de processo SQLite nos três checkpoints de up/down.
3. Encerramento forçado de processo PostgreSQL nos mesmos seis cenários.
4. Dois migradores concorrentes: um aplica; o segundo observa o histórico atualizado.
5. Checksum de inversa, histórico futuro/adulterado, alvo inválido e plano irreversível/destrutivo recusados.
6. Snapshot financeiro preservado em interrupções e up/down; 33 casos compartilhados por engine.
7. Runners antigos recusam schema mais novo.
8. RLS/FORCE RLS, isolamento por workspace e privilégios do histórico preservados.
9. Logs sem canários financeiros ou credenciais.
10. Remoção de banco/journal, segredo, contêiner e rede próprios.

O relatório .tools/us022-migrations/latest.json contém gates, contagens, versões, hashes e escopo. A [evidência arquivada](../quality/evidence/us-022-migrations-2026-10-16.json) passou em PostgreSQL 18.6/SQLite 3.53.3. Hashes de linhas são comparados em memória, nunca publicados. Adulterações deliberadas do teste afetam somente histórico técnico/objetos sintéticos por operador; nenhum teste desativa RLS ou contorna autorização financeira.

pnpm schema:migrations:clean limpa somente recursos próprios. Recusa Docker remoto, diretório vinculado, lock ativo e contêiner com proprietário/imagem divergentes. Se um encerramento externo deixar .lock, confirme primeiro que nenhum runner/filho próprio está ativo antes de remover o diretório vazio. Preserve recursos de outros projetos.

## Verificação e adoção

Testes Node cobrem catálogo/plano, janela explícita, adoção v1, reversibilidade, recusa destrutiva, rollback de vários passos, erros sanitizados e integridade da evidência real. O job dual-migrations repete o protocolo na CI. Execução remota e integração dos hosts nativos permanecem pendentes. A homologação SQLCipher da US-021 não constitui execução deste runner no Rust/Expo.

Próxima história: US-023, UUIDv7 e política temporal por plataforma, com G07-IDS/TIME. DP-01 a DP-04 e demais gates permanecem em [decisões pendentes](../architecture/decisions-pending.md).
