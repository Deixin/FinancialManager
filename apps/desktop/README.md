# desktop

Aplicativo Desktop. Stack prevista: React, Vite e Tauri 2, com autoridade local e acesso a workspaces cloud.

Estado: módulo TypeScript vazio do bootstrap e experimento nativo isolado em spikes/us-001. O experimento integra Tauri, SQLCipher, Windows Credential Manager e backup autenticado; a aplicação React/Vite de produto permanece pendente.

Referência: [arquitetura](../../docs/architecture/04-technical-architecture.md). Execute pnpm --filter @financial-manager/desktop typecheck ou build para verificar o módulo isoladamente.

A US-001 possui [protocolo, comandos e critérios de saída](../../docs/development/spikes/us-001-desktop-vault.md). Na raiz, execute pnpm env:check --desktop para verificar os pré-requisitos Windows x64 e pnpm spike:desktop:check para os testes Rust, build Tauri e smoke real da WebView. pnpm spike:desktop:ui abre o instrumento visual. A [homologação em outra instalação](../../docs/development/spikes/us-001-homologation.md) passou em uma VM Windows 11 independente, com reinicialização completa e [evidência sanitizada](../../docs/quality/evidence/us-001-windows-vm-2026-10-13.json).
