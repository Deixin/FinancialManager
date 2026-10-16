# mobile

Aplicativo Mobile. Stack prevista: Expo e React Native, com réplica offline autorizada e revogável.

A [US-021](../../docs/development/sqlite-schema.md) adiciona storage-schema e um perfil nativo independente em spikes/us-021. A propriedade Gradle fmSchemaProbe=us021 seleciona entrypoint/app ID próprios; o main padrão continua US-002. O corpus comum passou no Android SQLCipher/SecureStore com reboot offline e limpeza. iOS e integração da réplica de produto permanecem pendentes.

createMobileShellModel da [US-017](../../docs/development/runtime-configuration.md) filtra seções conforme configuração pública. NativeShellExample demonstra alternância em memória com defaults desligados; tipagem não homologa runtime Android/iOS. Flags não concedem lease offline nem alteram autorização do workspace.

NativeShell/NativeShellExample em src fazem parte da [US-016](../../docs/development/design-system.md): tokens compartilhados, componentes Native próprios, seletor cloud, estados e navegação adaptada. São tipados/compilados, sem importação de ui-dom. A entrada US-002 permanece intacta e homologação do novo shell em Android/iOS/TalkBack/VoiceOver está pendente.

Estado: módulo TypeScript do bootstrap e instrumento Expo isolado em spikes/us-002. A US-002 implementa a prova de SQLCipher, SecureStore e INT64; compilação e homologação nativas são registradas separadamente no protocolo. A aplicação Mobile cloud de produto permanece pendente.

A [US-012](../../docs/development/api-contracts.md) acrescenta createMobileApiClient em src, com SDK gerado, transporte e credencial de sessão injetados. O teste HTTP em Node não homologa Fetch, TLS ou sessão no React Native. O cliente não persiste tokens nem concede acesso offline.

Referência: [arquitetura](../../docs/architecture/04-technical-architecture.md). Execute pnpm --filter @financial-manager/mobile typecheck ou build para verificar o módulo isoladamente.

O typecheck também verifica o código do instrumento Expo. pnpm spike:mobile:prebuild gera os projetos nativos; pnpm spike:mobile:build:android compila o APK de teste e pnpm spike:mobile:test:android executa o protocolo no emulador dedicado. Consulte [US-002](../../docs/development/spikes/us-002-mobile-vault.md) e [ADR-0019](../../docs/architecture/adr/0019-spike-cofre-mobile.md). Não use Expo Go como evidência de SQLCipher.

Android homologado em emulador Android 16/API 36, incluindo operação offline, reinício completo e limpeza. [Evidência](../../docs/quality/evidence/us-002-android-2026-10-15.json). iOS permanece pendente de execução em Mac/Xcode.
