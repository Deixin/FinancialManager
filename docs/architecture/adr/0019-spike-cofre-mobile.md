# ADR-0019 — Cofre Mobile experimental

- Data: 2026-10-15
- Status: Validado no Android como spike; homologação iOS pendente
- Histórias: US-002; subsidia US-007, sem encerrar DP-04
- Substitui: nenhum; não define schema, autenticação ou política offline de produção

## Contexto

A US-002 deve demonstrar escrita/leitura offline, proteção da chave e transporte exato de INT64 em Android e iOS. A arquitetura exige uma réplica de workspace cloud autorizado; o instrumento usa exclusivamente workspaces e vetores sintéticos, sem implementar concessão de acesso cloud nem resolver o prazo divergente DP-01. O bootstrap TypeScript não constituía integração Expo.

## Alternativas

- Expo Go: inadequado para testar o binding SQLCipher, que exige configuração e compilação nativa.
- SQLite sem criptografia ou SecureStore contendo linhas financeiras: não cumprem as fronteiras de persistência.
- Dinheiro como Number: perde precisão acima de 2^53−1. Valores na ponte e no JSON precisam permanecer strings.
- Reutilizar diretamente o spike Rust Desktop: não prova Expo, Hermes, Keychain ou Android Keystore.

## Decisão experimental

O entry point em apps/mobile/spikes/us-002 executa um instrumento isolado. apps/mobile continua com seu módulo TypeScript de bootstrap, e acrescenta um typecheck específico do Expo. Android/iOS são gerados por prebuild a partir de app.config.ts e permanecem ignorados pelo Git. Os validadores mantêm a análise do código e plugins escritos à mão e excluem apenas esses dois diretórios gerados.

Versões diretas fixadas, compatíveis com o catálogo do SDK 58: Expo 58.0.11, React 19.3.0, React Native 0.88.0, expo-sqlite 58.0.13, expo-secure-store 58.0.2, expo-crypto 58.0.6 e expo-file-system 58.0.9. React/React Native/Expo fornecem o runtime nativo; SQLite ativa SQLCipher; SecureStore protege pequenas chaves; Crypto gera 32 bytes aleatórios; FileSystem permite verificar o arquivo cifrado e remover fixtures próprias. @types/react é exclusivamente de desenvolvimento. As dependências transitivas ficam no pnpm-lock.yaml. O pnpm 11.25.0 acrescentou exceções de idade para versões exatas recentes do SDK ao resolver a instalação; não foi desativada a verificação do lockfile ou flexibilizada a política para versões futuras.

Cada workspace sintético tem arquivo e chave distintos. SecureStore usa serviço próprio e, no iOS, WHEN_UNLOCKED_THIS_DEVICE_ONLY. Biometria não faz parte desta prova: requireAuthentication permanece false. Android desativa backup do aplicativo; o plugin também exclui SecureStore do backup automático. Nenhuma chave é incluída em código, configuração, relatório ou argumento de processo.

O adapter valida o formato hexadecimal antes de interpolar PRAGMA key, pois PRAGMA não aceita o binding de parâmetros. Outras entradas usam parâmetros. Abrir um cofre existente nunca gera ou substitui uma chave. Cada conexão usa useNewConnection para evitar um falso positivo causado pelo cache de handles já autenticados.

Migration experimental v1 usa tabelas STRICT, identificação do workspace, chaves compostas e FK. Criação e versão do schema estão na mesma transação. O helper withExclusiveTransactionAsync do binding abre outra conexão sem aplicar PRAGMA key; por isso o instrumento utiliza BEGIN IMMEDIATE/COMMIT/ROLLBACK em conexão privada e operações sequenciais. Essa conexão nunca é compartilhada com UI ou tarefas concorrentes. Uma migração interrompida deixa arquivo/chave sintéticos para diagnóstico e exige limpeza explícita; não se apresenta como cofre válido nem é sobrescrita na próxima abertura.

MoneyMinor tem validação decimal canônica e limites de INT64 por comparação textual. INSERT vincula string validada e usa CAST(? AS INTEGER); SELECT faz CAST(amount_minor AS TEXT). Os testes verificam typeof(...)=integer, extremos positivos/negativos, valores vizinhos ao limite de precisão do JavaScript e ida/volta JSON. Não há Number, parseInt ou parseFloat no fluxo monetário. A implementação definitiva de domínio permanece na US-013.

## Ameaças e limites

O build Windows encontrou um caminho prefab existente com 251 caracteres que o Ninja antigo do CMake 3.22.1 tratava como ausente, causando regeneração contínua de build.ninja. Foi reduzido virtualStoreDirMaxLength do pnpm para 40, preservando o linker isolado, as versões e a política de dependências. A redução sozinha não bastou: o diretório de objetos também ultrapassava o limite da ferramenta antiga. O setup prepara então uma cópia privada do CMake 3.22.1 com Ninja 1.13.2 em .tools/us002-android; não substitui os binários existentes do SDK. O ZIP oficial do Ninja é conferido contra SHA-256 07fc8261b42b20e71d1720b39068c2e14ffcee6396b76fb7a795fb460b78dc65. O runner define cmake.dir somente no local.properties gerado e ignorado. Regenerar o projeto nativo após mudar o layout do pnpm e limpar apenas os caches .cxx próprios evita referências antigas. Fontes: [configuração do pnpm](https://pnpm.io/settings/node-modules-settings#virtualstoredirmaxlength), [suporte a caminhos longos desde Ninja 1.12](https://github.com/ninja-build/ninja/releases/tag/v1.12.0), [Ninja 1.13.2](https://github.com/ninja-build/ninja/releases/tag/v1.13.2).

Foi observada uma divergência adicional em expo install --check: a CLI indicava React Native 0.88.0-rc.4, enquanto o catálogo embarcado em expo 58.0.11, o catálogo SDK 58 publicado e a resposta direta do endpoint oficial sdks/58.0.0/native-modules indicavam 0.88.0. Decisão restrita ao instrumento: manter a versão estável 0.88.0 desses três registros, sem aplicar downgrade para RC ou excluir React Native da validação. @types/react foi alinhado a 19.3.0. A advertência da CLI fica registrada e não é declarada aprovada; compatibilidade nativa depende do build e teste reais. Essa decisão não altera a baseline do produto.

Após compilar os bindings, o template também invocava o compilador Hermes por cmd com um caminho absoluto que falhava no espaço de Miudos Games; acrescentar aspas não resolveu o tratamento do comando pelo Gradle/cmd. O plugin local with-android-build.cjs utiliza o caminho relativo do compilador a partir da raiz JS, somente no Windows. Os nomes das pastas npm nesse caminho não contêm espaços. Ele falha explicitamente se a âncora do template mudar e não modifica dependências de terceiros. O restante do build, Hermes e o bundle release permanecem habilitados.

O primeiro APK também revelou uma dependência de runtime ausente: libexpo-sqlite.so declarava NEEDED libcrypto.so (verificado com llvm-readelf), mas a biblioteca não constava no ZIP. A versão instalada de expo-sqlite usa compileOnly para io.github.ronickg:openssl:3.3.2-1, suficiente para vincular e insuficiente para empacotar a dependência. O mesmo plugin declara esse coordinate exato no app, preservando o ABI usado pelo binding. Como o AAR fornece a biblioteca em prefab, sem uma pasta jni pronta, implementation sozinho também não a empacotou. Uma tarefa Gradle Sync extrai exclusivamente libcrypto.so dos ABIs selecionados, por meio de uma configuração AAR sem transitivas, e fornece o diretório de saída à mesclagem de JNI. A tarefa sincroniza somente seu próprio diretório gerado de build, removendo ABIs residuais; não lê caminhos pessoais ou arquivos financeiros. Não é necessário alterar dependências ou manter um CMake customizado do aplicativo.

Essa dependência Android é necessária ao SQLCipher; não oferece uma integração de rede e não é uma aprovação da stack para produção. O runner inspeciona o APK antes da instalação e rejeita ausência de SQLCipher/OpenSSL no mesmo ABI; um teste de regressão cobre biblioteca ausente e ABI incompatível.

| Fronteira      | Ameaça                                                          | Controle / limite                                                                                   |
| -------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Arquivo local  | Leitura sem chave, chave errada ou de outro workspace           | Conexões novas e leitura real de schema; cabeçalho cifrado, adulteração e integridade testados      |
| Secret store   | Chave ausente/inacessível                                       | Erro explícito; nenhuma regeneração ao abrir arquivo existente; teste de perda preserva bytes       |
| Dados e schema | Arredondamento, overflow, gravação parcial e referência cruzada | Strings canônicas, faixa INT64, STRICT, FK e testes de rollback                                     |
| Relatórios     | Vazamento de chave, SQL, conteúdo financeiro ou paths nativos   | Canal explícito contém apenas flags, versões e códigos fixos; erros nativos não são copiados        |
| Test runner    | Reiniciar dispositivo pessoal ou remover outro aplicativo       | Runner aceita apenas emulador dedicado e opera no package próprio com fixtures sintéticas           |
| Ambiente       | Usar mocks como evidência de segurança                          | Unitários, compilação, bundling e homologação nativa são resultados separados                       |
| Produto futuro | Confundir fixture com autorização cloud                         | Entry point explicitamente experimental, sem login, backend ou alegação de autorização implementada |

O Keystore emulado não comprova hardware seguro, resistência a root/jailbreak ou comportamento biométrico. Strings de chave na ponte JavaScript não oferecem garantia de zeroização da memória. Não há distribuição de produção, assinatura comercial, sincronização, concessão/revogação offline, migração de dados reais ou publicação em lojas nesta história.

## Validação e aprovação

Protocolo e resultados em [US-002](../../development/spikes/us-002-mobile-vault.md). A conclusão exige evidência nativa própria de Android e iOS. Windows não dispõe de Xcode; o roteiro iOS fica preparado para execução em Mac. Nenhuma homologação iOS é inferida do resultado Android.

Android homologado em 2026-10-15: build nativo com Hermes, SQLCipher 4.17.0 community, SecureStore, INT64 exato, falhas negativas, rollback, reinício completo sem rede e limpeza aprovados no emulador AOSP Android 16/API 36 x86_64. [Evidência sanitizada](../../quality/evidence/us-002-android-2026-10-15.json). pnpm check aprovado com 25 testes. Essa validação é experimental, sem aprovação de distribuição ou adoção final de produção.

Fontes primárias consultadas em 2026-10-15: [SQLCipher no expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/#sqlcipher), [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), [catálogo SDK 58](https://github.com/expo/expo/blob/sdk-58/packages/expo/bundledNativeModules.json), [monorepos](https://docs.expo.dev/guides/monorepos/). A observação sobre transações foi verificada no arquivo src/SQLiteDatabase.ts da versão instalada, classe Transaction.createAsync.
