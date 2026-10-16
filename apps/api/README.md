# api

API cloud. Stack prevista: NestJS e Fastify, como monólito modular, com autorização e isolamento por workspace.

Estado: módulo TypeScript do bootstrap e instrumento Node/PostgreSQL isolado em spikes/us-004. O spike prova RLS com contexto por transação e pool real; NestJS/Fastify e a API de produto permanecem pendentes.

Referência: [arquitetura](../../docs/architecture/04-technical-architecture.md). Execute pnpm --filter @financial-manager/api typecheck ou build para verificar o módulo isoladamente.

spikes/us-005 contém o protocolo experimental de sincronização com revisões, recibos, feed imutável, tombstones e conflitos. Execute pnpm spike:sync:test para duas réplicas sintéticas persistentes e PostgreSQL real no Docker. [Protocolo US-005](../../docs/development/spikes/us-005-sync.md) e [ADR-0022](../../docs/architecture/adr/0022-spike-sincronizacao-dois-clientes.md) delimitam o contrato, as ameaças e as integrações pendentes.

Execute pnpm spike:rls:test para a homologação com PostgreSQL efêmero no Docker. [Protocolo US-004](../../docs/development/spikes/us-004-postgresql-rls.md) e [ADR-0021](../../docs/architecture/adr/0021-spike-isolamento-postgresql-rls.md) documentam permissões, ameaças e limites. O typecheck/build TypeScript não substitui essa execução real de banco.
