# web

Interface Web em nuvem. Stack prevista: Next.js. Sem cofre financeiro persistente no navegador.

Estado: módulo TypeScript do bootstrap e instrumento Node HTTPS isolado em spikes/us-003. A US-003 experimenta o BFF OIDC com provider separado e tokens apenas no servidor. Next.js e a aplicação Web de produto permanecem pendentes.

Consulte o [protocolo US-003](../../docs/development/spikes/us-003-oidc.md) e o [ADR-0020](../../docs/architecture/adr/0020-spike-identidade-oidc-local.md). pnpm spike:oidc:test executa o provider sintético no Docker e os testes reais de navegador. build/typecheck continuam validando o módulo TypeScript, não uma integração Next.js.

Referência: [arquitetura](../../docs/architecture/04-technical-architecture.md). Execute pnpm --filter @financial-manager/web typecheck ou build para verificar o módulo isoladamente.
