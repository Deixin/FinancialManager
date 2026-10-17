# storage-schema

O subpath revisions acrescenta o adapter SQLite US-026 para uma conexão exclusiva já desbloqueada/migrada pelo host. Ele usa domain/finance-ports internos, BEGIN IMMEDIATE, fila por handle e descarte após rollback falho. [Guia e limites](../../docs/development/financial-revisions.md). A interface é interna ao host; adoção Rust/Expo/cofre e homologação Native permanecem pendentes.

Schema SQLite portátil da US-021, versão 0.1.0, com migração/checksum e normalização de nomes. Sem bibliotecas externas de produção. É permitido em Desktop/Mobile, com Domain independente.

Use migrateSqlite apenas no adaptador interno, após configurar e abrir a conexão SQLCipher apropriada. O host controla chave, autoridade, autorização e lifecycle do handle. A função não constitui endpoint SQL ou validador de backup. O subpath synthetic-probe é exclusivo das fixtures de homologação.

Fonte SQL: infra/schema/sqlite-model.mjs. Gere com pnpm schema:sqlite:generate; confira com schema:sqlite:check. O corpus é explicitamente sintético. [Guia e protocolo](../../docs/development/sqlite-schema.md), [ADR-0032](../../docs/architecture/adr/0032-schema-sqlite-e-equivalencia.md).

A US-022 acrescenta o subpath migrations: migrateSqliteTo, catálogo/plano e janela explícita de compatibilidade. Suporta 1→2→1 sem reescrever dados financeiros; mudanças destrutivas são recusadas. O host fornece SHA-256 confiável e conexão exclusiva. migrateSqlite preserva o runner inicial e recusa base na versão 2. [Guia](../../docs/development/schema-migrations.md), [ADR-0033](../../docs/architecture/adr/0033-migrations-dual-engine.md). Gere/confira o catálogo adicional com pnpm schema:migrations:generate/check.
