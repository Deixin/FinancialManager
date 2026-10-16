# US-002 — Expo, SQLCipher, SecureStore e INT64

- Início: 2026-10-15.
- Estado: Android homologado no emulador; iOS preparado para execução, ainda pendente.
- Critério original: [backlog EP-00](../../delivery/05-backlog.md), prova de escrita/leitura offline e serialização INT64 sem float em Android/iOS de teste.
- Decisões e ameaças: [ADR-0019](../../architecture/adr/0019-spike-cofre-mobile.md).

## Escopo

O código em apps/mobile/spikes/us-002 usa dois workspaces sintéticos, chaves aleatórias independentes e uma terceira fixture para migração interrompida. Não é a aplicação Mobile de produto e não concede autorização para trabalhar offline com dados cloud. Não há login, rede de negócio, dados reais ou política de expiração implementados.

O relatório nunca inclui chave, valor monetário, descrição, identificador de pessoa ou linha de banco. As chaves existem exclusivamente na memória do processo e no SecureStore. Bases e arquivos de ambiente ficam ignorados pelo Git. O relatório local é us002-report.json no diretório privado do app e é emitido pelo canal explícito US002_REPORT; somente a evidência sanitizada pode ser copiada para docs/quality/evidence.

## Pré-requisitos

Use Node 24.19.x e pnpm 11.25.0, conforme o repositório. Android requer JDK e SDK compatíveis com o Gradle/Expo gerados, emulator/platform-tools, uma imagem x86_64 e virtualização. Reserve um emulador exclusivamente para fixtures desta história, porta 5562. O script recusa dispositivos físicos e usa apenas o package com.miudos.financialmanager.us002. Nenhum serviço EAS ou credencial de produção é necessário.

iOS requer Mac, Xcode, CocoaPods e simulador compatíveis. Não utilizar Expo Go para validar SQLCipher. O protocolo iOS abaixo é uma preparação; sua existência não é evidência de execução.

## Comandos comuns

Na raiz:

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm spike:mobile:setup:android
pnpm spike:mobile:prebuild
pnpm spike:mobile:build:android
pnpm spike:mobile:test:android
```

No Windows, setup:android prepara um AVD AOSP API 36 x86_64 próprio, sem janela, com discos em .tools/us002-android e porta 5562; pode baixar a imagem oficial e reaproveita somente licenças já aceitas pelo dono do SDK. Não apaga AVDs existentes. O prebuild gera android no Windows/Linux e android/ios no Mac. O build Android gera APK de teste x86_64 com bundle Hermes embarcado, configuração release e chave de debug gerada pelo template; não constitui artefato de produção. O cache Gradle fica em .tools/us002-android/gradle. O runner não toca em outros emuladores nem faz wipe de dados. O script do aplicativo se chama native:prebuild para evitar execução automática pelo lifecycle prebuild do pnpm durante pnpm check.

O setup Windows também prepara CMake 3.22.1 e Ninja 1.13.2 privados para suportar os caminhos dos bindings nativos. O hash do download é fixado no script. O [ADR-0019](../../architecture/adr/0019-spike-cofre-mobile.md) registra o diagnóstico, o ajuste de layout do pnpm e a divergência entre o verificador remoto Expo e seus catálogos; não se deve tratar o alerta de compatibilidade da CLI como aprovado.

O script de teste instala o package sintético, desliga conectividade do emulador, confirma modo avião, executa a primeira fase, reinicia completamente o Android, verifica incremento de boot_count e executa a segunda fase. A terceira abertura limpa as bases/chaves próprias e confirma sua remoção. O processo é parado ao final; o emulador dedicado pode ser encerrado por seu operador. O relatório combinado e a captura da UI ficam em .tools/us002-android, ignorados pelo Git.

Uma execução anterior com relatório cleaned não inicia automaticamente outro teste. Para uma nova rodada, remova apenas o package sintético no emulador e reinstale. Se uma execução falhar, preserve a evidência para diagnóstico antes de removê-lo. No iOS, a desinstalação pode preservar itens de Keychain; execute a limpeza no mesmo simulador ou apague somente o simulador dedicado à história antes de repetir.

## Protocolo iOS preparado

No Mac, use um checkout com estas mudanças e instale o lockfile. Gere o projeto e abra o simulador dedicado:

```sh
pnpm install --frozen-lockfile
pnpm --filter @financial-manager/mobile exec expo prebuild --platform ios --no-install
cd apps/mobile/ios
pod install
cd ../../..
pnpm --filter @financial-manager/mobile exec expo run:ios --configuration Release
```

Selecione o simulador de teste quando solicitado. O build precisa carregar o bundle embarcado com o Metro desligado. Desative a conectividade do ambiente de teste e registre como isso foi comprovado; a opção de simular rede lenta não comprova ausência de rede.

1. Na primeira abertura, exigir phase=prepared, passed=true, versão SQLCipher e todos os checks da primeira fase. Registrar o relatório sanitizado exibido/emitido pelo app.
2. Encerrar o app, desligar e iniciar novamente o simulador dedicado, desbloqueá-lo e abrir o mesmo app. Exigir phase=reopened e recuperação das chaves, mantendo os mesmos dados exatos e verificações de integridade.
3. Encerrar e abrir uma terceira vez, ou usar Limpar fixtures sintéticas na segunda abertura. Exigir phase=cleaned e synthetic_artifacts_removed=true no relatório. A terceira abertura emite o relatório completo pelo canal de evidência.
4. Registrar versões de macOS/Xcode/iOS, modelo do simulador, hashes do código/artefato, prova da interrupção/offline e resultado de cada fase. Não copiar logs completos ou dados de Keychain.

O resultado de um simulador não substitui testes biométricos e de hardware em aparelho físico. Não foi solicitado criar conta Apple, usar EAS, publicar ou conceder credenciais de assinatura.

## Matriz de verificação

| Camada              | Evidência necessária                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Unitários           | Formato canônico, extremos INT64, rejeição de Number/overflow e validação de relatórios incompletos                      |
| Typecheck           | Código Expo/React Native e adaptadores sem erros; não comprova SQLCipher                                                 |
| Android/iOS nativos | Engine SQLCipher real, arquivo sem header SQLite em claro, sem chave/chave errada, chave de outro workspace, adulteração |
| Persistência        | INSERT/SELECT exatos como INTEGER/texto, JSON com strings, migração e update revertidos, FK e isolamento de workspace    |
| Falhas              | Remover chave e recusar abertura sem alterar bytes; não regenerar segredo; preservar o original ao adulterar cópia       |
| Reinício/offline    | Reabrir após reinício completo do SO de teste sem conectividade e recuperar as duas chaves                               |
| Limpeza             | Remover somente dados/chaves sintéticos próprios e confirmar ausência                                                    |

## Evidência atual

- pnpm test: 25 testes aprovados em 2026-10-15, incluindo seis testes novos de contrato monetário, validação dos relatórios e empacotamento do runtime SQLCipher/OpenSSL.
- Typecheck específico Expo: aprovado em 2026-10-15.
- Prebuild Android com expo.sqlite.useSQLCipher=true: gerado com sucesso.
- Build Android release de teste, com Hermes e SQLCipher: aprovado. OpenSSL empacotado para x86_64 e conferido no APK antes da instalação.
- [Evidência Android](../../quality/evidence/us-002-android-2026-10-15.json): Android 16/API 36, SQLCipher 4.17.0 community, três fases aprovadas, boot_count 2 → 3, modo avião ativo e Wi-Fi/dados móveis desativados antes/depois do reboot. As bases/chaves sintéticas foram removidas; o emulador foi encerrado.
- Resultado final produzido em 2026-10-15T22:36:18.431Z. O hash do APK testado e as versões diretas estão na evidência sanitizada. Captura da UI em .tools/us002-android/native-screen.png, ignorada pelo Git.
- iOS: sem execução nativa neste host Windows. A US-002 permanece em andamento até a homologação em Mac/Xcode; o roteiro preparado não constitui evidência de aprovação.
