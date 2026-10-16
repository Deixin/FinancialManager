# mobile

Aplicativo Mobile. Stack prevista: Expo e React Native, com réplica offline autorizada e revogável.

Estado: módulo TypeScript do bootstrap e instrumento Expo isolado em spikes/us-002. A US-002 implementa a prova de SQLCipher, SecureStore e INT64; compilação e homologação nativas são registradas separadamente no protocolo. A aplicação Mobile cloud de produto permanece pendente.

A [US-012](../../docs/development/api-contracts.md) acrescenta createMobileApiClient em src, com SDK gerado, transporte e credencial de sessão injetados. O teste HTTP em Node não homologa Fetch, TLS ou sessão no React Native. O cliente não persiste tokens nem concede acesso offline.

Referência: [arquitetura](../../docs/architecture/04-technical-architecture.md). Execute pnpm --filter @financial-manager/mobile typecheck ou build para verificar o módulo isoladamente.

O typecheck também verifica o código do instrumento Expo. pnpm spike:mobile:prebuild gera os projetos nativos; pnpm spike:mobile:build:android compila o APK de teste e pnpm spike:mobile:test:android executa o protocolo no emulador dedicado. Consulte [US-002](../../docs/development/spikes/us-002-mobile-vault.md) e [ADR-0019](../../docs/architecture/adr/0019-spike-cofre-mobile.md). Não use Expo Go como evidência de SQLCipher.

Android homologado em emulador Android 16/API 36, incluindo operação offline, reinício completo e limpeza. [Evidência](../../docs/quality/evidence/us-002-android-2026-10-15.json). iOS permanece pendente de execução em Mac/Xcode.
