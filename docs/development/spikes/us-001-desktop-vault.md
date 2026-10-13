# US-001 — Spike do cofre Desktop

- Onda: W0 / EP-00.
- Estado: concluído como spike; validação nativa local e homologação host → VM Windows independente aprovadas.
- Referências: [backlog](../../delivery/05-backlog.md), [PRD RF-32](../../product/01-prd.md#rf-32--backup-local-criptografado--p0) e [arquitetura](../../architecture/04-technical-architecture.md).
- Alvo do experimento: Windows 11 x64. Homologação de distribuição/assinatura do produto permanece fora deste spike.

## Objetivo e limites

Demonstrar Tauri + SQLCipher + armazenamento de chave no sistema operacional, com backup autenticado restaurável em outra instalação. Desktop local deve funcionar sem usuário, login ou serviço em nuvem.

Este spike usa apenas dados sintéticos e temporários. Não entrega telas financeiras, schema definitivo, sincronização, instalador assinado ou formato de backup de produção. O [ADR-0017](../../architecture/adr/0017-spike-cofre-desktop.md) registra o binding, a recuperação, as dependências e os parâmetros experimentais; a adoção em produção continua pendente.

## Preparação reproduzível

Na raiz do repositório, com as versões de Node e pnpm fixadas no package.json:

```sh
pnpm env:check --desktop
pnpm check
```

O primeiro comando verifica Rust MSVC x64, Cargo, o componente C++ do Visual Studio e o registro do WebView2 Runtime por máquina ou usuário. Também compila, vincula e executa um programa Rust temporário, removido ao terminar. Cada subprocesso tem timeout de 30 segundos; nenhum software é instalado. Falta de pré-requisito torna o comando malsucedido.

O preflight verifica apenas Windows x64. Ele não inicia uma WebView nem valida Tauri, SQLCipher, secret store ou backup. O pnpm check executa os testes do diagnóstico com respostas sintéticas, sem exigir SDKs nativos nos runners Linux. A integração nativa possui um gate separado.

Detecção baseada nas instruções oficiais de [pré-requisitos do Tauri](https://v2.tauri.app/start/prerequisites/) e de [registro do WebView2 Runtime](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution#detect-if-a-webview2-runtime-is-already-installed). O preflight não exige credenciais, acesso cloud ou chaves de assinatura.

## Executar a implementação

O código Rust está em apps/desktop/spikes/us-001. Use Rust MSVC x64 1.99.0, rustfmt, Clippy, Visual Studio C++ e Perl Windows nativo com IPC::Cmd. SQLCipher e OpenSSL são compilados estaticamente, sem banco global instalado. O primeiro build pode levar vários minutos.

O runner usa o Perl do PATH ou Strawberry Perl portátil 5.42.3.1 em .tools/strawberry-perl-5.42.3.1/perl/bin. Não altera o PATH global nem instala ferramentas. O arquivo portátil oficial e seu hash estão no ADR; extraia o ZIP nessa pasta se o Perl nativo não estiver disponível. O Perl do Git não atende esse build. Downloads de crates e ferramentas são necessários na preparação; o experimento executa inteiramente local depois do build.

```sh
pnpm spike:desktop:test
pnpm spike:desktop:check
pnpm spike:desktop:ui
pnpm spike:desktop:package
```

test executa os testes Rust. check exige fmt e Clippy sem avisos, executa os testes, compila Tauri e inicia uma WebView real que invoca a demonstração via IPC. O relatório local sanitizado fica em .tools/us-001-evidence/tauri-smoke.json; falha ou timeout torna o gate malsucedido. ui abre a mesma demonstração com um botão. package prepara executáveis debug e roteiro numa pasta nova .tools/us-001-handoff-*, sem incluir dados ou segredos.

O CLI aceita --root seguido de uma pasta exclusiva do spike e create, list, inspect, verify, backup, preview e restore --confirm. Senhas são solicitadas sem eco, nunca por argumento ou variável de ambiente. remove-synthetic só remove workspaces cuja fixture foi validada. restore-crash é um instrumento de teste de interrupção e não é exposto à WebView. O [roteiro de homologação](us-001-homologation.md) contém os comandos completos.

## Evidência local — 2026-10-13

Windows 11 x64 build 26200; Node 24.19.0; pnpm 11.25.0; Rust/Cargo 1.99.0 MSVC; WebView2 154.0.4258.62; SQLCipher 4.14.0 community. Os 13 testes Rust exercitam SQLCipher real e Windows Credential Manager, incluindo processos independentes. O smoke real do Tauri confirmou ida e volta IPC, cofre criptografado, exclusão da chave original, restauração com nova chave/workspace e equivalência exata da fixture.

Os casos automatizados cobrem: ausência/chave incorreta, chave indisponível/negada, namespace de instalação, precisão i64, migration com rollback, journal criptografado, schema hostil, senha errada, adulteração do cabeçalho/ciphertext/tag, truncamento, limites, versão/custos inválidos, publicação sem sobrescrita, lock, interrupção real antes/depois de persistir a chave e limpeza no reinício. O cofre existente é comparado byte a byte nos testes de falha/restauração. A origem é removida antes da restauração entre processos.

A CI inclui um job Windows nativo separado, além do gate TypeScript Windows/Linux. A configuração foi preparada; execução remota ainda não foi realizada. O smoke interno mantém another_windows_profile_verified false porque sua demonstração roda em um só perfil. A homologação entre host e VM é um experimento separado, descrito a seguir.

## Homologação em outra instalação — 2026-10-13

O [ADR-0018](../../architecture/adr/0018-homologacao-desktop-vm-docker.md) registra o ambiente QEMU/KVM hospedado no Docker. Windows 11 x64 novo, build 10.0.26200.0, conta local e Credential Manager próprios. O host exportou a fixture e removeu seu cofre e chave antes da transferência. O guest verificou os hashes, rejeitou senha incorreta e adulteração, recuperou interrupções em staging e após persistir a chave, validou a prévia e restaurou para novo workspace LOCAL. A fixture exata e o hash do cofre existente foram preservados.

Após reiniciar o Windows completo, o guest reabriu os dois cofres pelo Credential Manager e executou o smoke real Tauri/WebView. O relatório foi escrito às 12:00:52 UTC, depois da inicialização do contêiner às 11:57:47 UTC; resultados do primeiro logon não servem como evidência de reboot. O harness removeu as fixtures/credenciais próprias e parou o contêiner. O [relatório sanitizado](../../quality/evidence/us-001-windows-vm-2026-10-13.json) contém versões, hashes, booleans e timestamps, sem payload financeiro ou segredo.

Comandos reproduzíveis e limites estão no [roteiro de infraestrutura](../../../infra/homologation/README.md). O tempo do relatório inclui espera por parte da preparação/instalação e não representa benchmark de backup. Todos os casos do critério de saída têm evidência; US-001 concluída no escopo de spike. Hardware físico diferente, queda de energia, assinatura e decisões finais de produção continuam nas histórias correspondentes.

## Experimentos e evidências obrigatórias

| Caso             | Experimento                                                                                                                                                  | Evidência para aprovação                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Cofre            | Criar workspace sintético em SQLCipher, fechar e reabrir. Verificar cipher_version e leitura com a chave correta. Tentar SQLite sem chave e chave incorreta. | Teste nativo reproduzível; abertura indevida falha. Arquivos auxiliares também respeitam a proteção prevista. |
| Chave no SO      | Criar chave aleatória por workspace no secret store; reiniciar o processo e recuperar. Simular chave ausente e acesso negado.                                | Chave fora do banco, da WebView e dos logs; erro explícito, sem recriar chave sobre cofre existente.          |
| Fronteira Tauri  | Abrir a WebView e invocar comandos tipados para operações do experimento.                                                                                    | Smoke nativo; capabilities mínimas, sem SQL ou filesystem genérico disponível à UI.                           |
| Backup           | Exportar snapshot consistente, versionado e autenticado, protegido pelo segredo de recuperação.                                                              | Pacote independente da chave de dispositivo; nenhuma chave ou cópia em claro fica no repositório.             |
| Outra instalação | Restaurar em perfil/instalação de teste sem a chave original do secret store.                                                                                | Dados sintéticos equivalentes, novo workspace e nova chave local; sem reconectar cópia à nuvem.               |
| Falhas           | Senha errada, adulteração, truncamento, versão incompatível e interrupção antes da promoção.                                                                 | Falha explícita; staging descartado; workspace existente preservado.                                          |
| Limites          | Tentar tamanho excessivo e parâmetros criptográficos inválidos do pacote.                                                                                    | Rejeição controlada, sem consumo de recursos ilimitado.                                                       |

As fixtures devem cobrir saldos, itens e regras, conforme RF-32, e usar inteiros de 64 bits sem float. Comparações podem ser feitas nos testes; o relatório e os logs registram somente caso, resultado, versão e duração. Não registrar valores, descrições, dados fiscais, senhas ou chaves.

O backup deve permanecer criptografado durante o staging quando houver persistência temporária. A restauração só publica o novo workspace depois de autenticar, validar a versão e verificar integridade. Os testes de falha devem comprovar a preservação do workspace anterior, inclusive após reiniciar o processo.

## Critério de saída

- Todos os casos acima têm resultado e comando reproduzível, incluindo restauração em outra instalação.
- Dependências candidatas têm justificativa, versões fixadas e avaliação das ameaças da fronteira local.
- Um novo [ADR](../../architecture/adr/README.md) registra binding, secret store, formato experimental, alternativas, limites e evidências; propostas não contam como aprovação.
- O [estado do projeto](../../delivery/status.md) distingue testes executados, testes pendentes e homologação de outra máquina. Um segundo processo no mesmo perfil não substitui essa evidência.

DP-01, DP-02 e DP-03 continuam em [decisões pendentes](../../architecture/decisions-pending.md). Os conflitos de prazo cloud e papel de leitura não impedem esta preparação local e não são resolvidos por ela.
