# Plano de testes

## Cobertura inicial

O bootstrap verifica sintaxe e tipos, formatação, links Markdown locais, compilação independente dos módulos e limites de dependência/importação. Os testes automatizados exercitam casos permitidos e proibidos do verificador estrutural.

Essa cobertura não valida comportamento financeiro, interfaces, banco de dados, criptografia, autenticação ou integração dos frameworks.

## Preparação da US-001

O pnpm test também verifica o diagnóstico Desktop: detecção de WebView2 por usuário, rejeição de registros inválidos, target Rust incorreto, inventário indisponível, falha/timeout de compilação, falha de execução e limpeza dos temporários. Esses testes usam respostas sintéticas de ferramentas, sem exigir SDKs nativos, e fazem parte do comando executado pela CI Windows/Linux.

O comando pnpm env:check --desktop faz a verificação real de ferramentas no Windows x64 e compila, vincula e executa um probe Rust temporário. Esse diagnóstico sozinho não comprova integração dos frameworks ou criptografia.

## Integração nativa da US-001

pnpm spike:desktop:check executa fmt, Clippy, testes Rust, build Tauri e smoke real de WebView/IPC. O job desktop-vault da CI Windows possui esse gate separado do pnpm check TypeScript; execução remota ainda pendente. O [protocolo](../development/spikes/us-001-desktop-vault.md) e o [estado](../delivery/status.md) registram evidência local e ambiente.

Os testes usam SQLCipher real, fixtures sintéticas com extremos i64 e Windows Credential Manager. Cobrem cofre sem/chave incorreta, falta/negação de chave, isolamento por instalação, journal, migration atômica, envelope autenticado, limites e schema hostil. Testes entre processos removem a origem, simulam término abrupto antes/depois da persistência da chave e reabrem a instalação para limpar staging/credenciais órfãs. Preservação do cofre existente é verificada byte a byte.

O smoke Tauri chama apenas comandos sintéticos sem parâmetros de SQL, arquivos ou chaves. A [homologação em outra instalação](../development/spikes/us-001-homologation.md) passou entre o host e uma VM Windows 11 independente, incluindo recuperação da chave após reiniciar o Windows e smoke real da WebView. A [evidência](evidence/us-001-windows-vm-2026-10-13.json) registra hashes, versões e timestamps; dois testes de metadados rejeitam relatório anterior ao reboot ou sem confirmação de persistência. Essa cobertura não entrega os fluxos BK-01/02 nem o schema definitivo do produto.

## Cobertura a implementar

A US-002 possui [protocolo próprio](../development/spikes/us-002-mobile-vault.md), unitários de INT64/relatórios e typecheck Expo. A homologação de SQLCipher/SecureStore depende de build nativo e execução em cada plataforma. Prebuild ou typecheck aprovados não encerram o teste de segurança. O instrumento prepara dados sintéticos, reabre após reinício e limpa seus próprios artefatos.

Android passou no emulador AOSP Android 16/API 36 x86_64: [evidência sanitizada](evidence/us-002-android-2026-10-15.json), com SQLCipher 4.17.0 community, bibliotecas de runtime conferidas no APK, três fases nativas e reinício completo sem rede. iOS segue pendente; nenhum resultado Android é usado para encerrar essa homologação. pnpm test contém 25 testes, incluindo regressão para OpenSSL ausente ou empacotado no ABI errado.

Os critérios de aceite do [PRD](../product/01-prd.md), do [backlog](../delivery/05-backlog.md) e os gates do [plano](../delivery/06-implementation-plan.md) orientam os testes:

- Precisão monetária e decimal, saldo de contas e cartões, transferências e relatórios.
- Importação, deduplicação, atomicidade, idempotência, reversão e descarte de originais.
- Extração fiscal, busca por itens e conciliação N:N.
- Autorização, RLS e vazamento entre workspaces e escopos de conta.
- Sync entre clientes, conflitos, revogação e expiração do offline.
- Backup criptografado, corrupção, restauração, migração e retenção.
- Fluxos Desktop, Web e Mobile, acessibilidade e builds nativos.

Cada história deve registrar quais testes foram executados e limitações. Os spikes W0 devem produzir evidências reproduzíveis, especialmente para INT64, criptografia, RLS, OIDC, sync e volume de importação.
