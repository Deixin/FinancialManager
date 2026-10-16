# storage-schema

Schema SQLite portátil da US-021, versão 0.1.0, com migração/checksum e normalização de nomes. Sem bibliotecas externas de produção. É permitido em Desktop/Mobile, com Domain independente.

Use migrateSqlite apenas no adaptador interno, após configurar e abrir a conexão SQLCipher apropriada. O host controla chave, autoridade, autorização e lifecycle do handle. A função não constitui endpoint SQL ou validador de backup. O subpath synthetic-probe é exclusivo das fixtures de homologação.

Fonte SQL: infra/schema/sqlite-model.mjs. Gere com pnpm schema:sqlite:generate; confira com schema:sqlite:check. O corpus é explicitamente sintético. [Guia e protocolo](../../docs/development/sqlite-schema.md), [ADR-0032](../../docs/architecture/adr/0032-schema-sqlite-e-equivalencia.md).
