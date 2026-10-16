# ui-dom

Componentes DOM para Web e Desktop. Não deve ser importado pelo aplicativo React Native.

Versão interna 0.1.0: AppShell e ContentNotice React, com tokens compartilhados, foco/teclado, landmarks e estados distintos. O host importa também @financial-manager/ui-dom/styles.css e controla modelo/callbacks/dados. [Guia e demonstração US-016](../../docs/development/design-system.md). Testes em Chromium não homologam Next.js, Vite ou Tauri.

Referência: [arquitetura](../../docs/architecture/04-technical-architecture.md). Execute pnpm --filter @financial-manager/ui-dom typecheck ou build para verificar o módulo isoladamente.
