# persistence-postgres

O subpath revisions fornece createPostgresRevisionService para mutações versionadas internas: role/contexto autorizado, locks, CAS e append de snapshot na mesma transação. O host controla pool, provider e efeitos futuros de sync. [US-026](../../docs/development/financial-revisions.md). O guard de contexto é compartilhado com leituras para recusar unidades aninhadas.

Adapter Node/Kysely 0.29.6 para os ports de leitura US-024. Exige pool pg e provider de autorização confiáveis; cada callback usa uma transação READ ONLY com contexto local de workspace e escopo de contas. Apenas a entrada pública pode ser instalada nos composition roots API/worker. Veja o [guia](../../docs/development/data-access.md) e o [ADR-0035](../../docs/architecture/adr/0035-ports-e-repositories-por-modulo.md) para ownership, ciclo de vida, reprodução e limites.
