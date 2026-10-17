# desktop

A [US-031](../../docs/development/local-workspaces.md) cria e reabre espaços de produto sem identidade cloud. O core Rust agora mantém SQLCipher/schema v2 e chave Windows no mínimo necessário à persistência, com três comandos estreitos. desktop:workspaces:check/native verificam DOM e persistência real; os aliases entry apontam para esses protocolos atuais. Preview continua sem gravar dados. US-032/G07-VAULT ampliado, backup/restore e release permanecem pendentes; os registros anteriores abaixo são históricos.

A [US-030](../../docs/development/desktop-entry.md) integra a primeira entrada de produto React/Vite + Tauri, com Continuar sem conta até início de WS-01 local. Os parágrafos abaixo registram a fundação anterior e seus limites; o cofre experimental continua isolado. Criação persistente do workspace (US-031), cofre (US-032), autenticação cloud e release assinado permanecem pendentes.

Na raiz, pnpm desktop:preview abre o servidor visual em loopback 44361; desktop:entry:check testa o build real em Chromium e desktop:entry:native testa Clippy/build locked/WebView2 em Windows x64. O binário padrão é financial-manager; entry-smoke requer feature explícita e não registra seus comandos no produto. Consulte o guia para paths, evidências e pré-requisitos.

Aplicativo Desktop. Stack prevista: React, Vite e Tauri 2, com autoridade local e acesso a workspaces cloud.

A [US-021](../../docs/development/sqlite-schema.md) adiciona dependência interna storage-schema. O teste Rust tests/us021_schema.rs reutiliza o binding SQLCipher em arquivo sintético e passa no corpus comum. A integração no cofre/backup de produto exige seu validador/migrations próprios; o instrumento US-001 mantém seu schema experimental.

createDesktopShellModel da [US-017](../../docs/development/runtime-configuration.md) filtra seções opcionais sem exigir login/nuvem para o local. O exemplo permite desligá-las em execução. Handlers/IPC Tauri de produto ainda precisam do gate e autorização correspondentes.

DesktopShell da [US-016](../../docs/development/design-system.md) compartilha AppShell React/tokens, preservando local sem login e distinção cloud. A demonstração usa dados sintéticos em Chromium; não modifica o instrumento US-001 nem integra Vite/Tauri de produto.

Estado: módulo TypeScript com createDesktopCloudClient da [US-012](../../docs/development/api-contracts.md) e experimento nativo isolado em spikes/us-001. O cliente usa SDK gerado e credencial fornecida pela sessão; modo local não depende dele. O experimento integra Tauri, SQLCipher, Windows Credential Manager e backup autenticado; aplicação React/Vite de produto e homologação do cliente HTTP no Tauri permanecem pendentes.

Referência: [arquitetura](../../docs/architecture/04-technical-architecture.md). Execute pnpm --filter @financial-manager/desktop typecheck ou build para verificar o módulo isoladamente.

A US-001 possui [protocolo, comandos e critérios de saída](../../docs/development/spikes/us-001-desktop-vault.md). Na raiz, execute pnpm env:check --desktop para verificar os pré-requisitos Windows x64 e pnpm spike:desktop:check para os testes Rust, build Tauri e smoke real da WebView. pnpm spike:desktop:ui abre o instrumento visual. A [homologação em outra instalação](../../docs/development/spikes/us-001-homologation.md) passou em uma VM Windows 11 independente, com reinicialização completa e [evidência sanitizada](../../docs/quality/evidence/us-001-windows-vm-2026-10-13.json).
