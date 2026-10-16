# web

Interface Web em nuvem. Stack prevista: Next.js. Sem cofre financeiro persistente no navegador.

WebShell da [US-016](../../docs/development/design-system.md) compartilha AppShell React e tokens, com seletor cloud, estados e foco/teclado. O exemplo loopback passou no protocolo Chromium; integração Next.js/roteamento e dados financeiros permanecem pendentes.

Estado: módulo TypeScript do bootstrap e instrumento Node HTTPS isolado em spikes/us-003. A US-003 experimenta o BFF OIDC com provider separado e tokens apenas no servidor. Next.js e a aplicação Web de produto permanecem pendentes.

A [US-012](../../docs/development/api-contracts.md) acrescenta createWebApiClient em src: SDK gerado, transporte injetado, cookie same-origin e CSRF. O teste HTTP executa o módulo compilado em Node; não entrega BFF, sessão ou integração Next.js.

Consulte o [protocolo US-003](../../docs/development/spikes/us-003-oidc.md) e o [ADR-0020](../../docs/architecture/adr/0020-spike-identidade-oidc-local.md). pnpm spike:oidc:test executa o provider sintético no Docker e os testes reais de navegador. build/typecheck continuam validando o módulo TypeScript, não uma integração Next.js.

Referência: [arquitetura](../../docs/architecture/04-technical-architecture.md). Execute pnpm --filter @financial-manager/web typecheck ou build para verificar o módulo isoladamente.
