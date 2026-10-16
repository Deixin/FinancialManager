# worker

Processamento assíncrono. Adaptadores, filas e execução serão definidos e validados nas histórias correspondentes.

createWorkerFeatures da [US-017](../../docs/development/runtime-configuration.md) fornece configuração explícita e gate worker/cloud. Consulte execute no início de cada job com autorização própria; desligar uma flag impede entrada, sem remover jobs/outbox ou interromper trabalho iniciado. Não instala consumidor de fila persistente.

Estado: módulo TypeScript com createWorkerObservability da [US-015](../../docs/development/observability.md). A factory fornece tracing manual e logs com allowlist, silenciosos por padrão. Filas persistentes, jobs de produto e integração de framework permanecem pendentes. O processo sintético dos testes não constitui um worker de produto.

Referência: [arquitetura](../../docs/architecture/04-technical-architecture.md). Execute pnpm --filter @financial-manager/worker typecheck ou build para verificar o módulo isoladamente.
