# ADR-0018 — Homologação US-001 em VM Windows hospedada pelo Docker

- Data: 2026-10-13.
- Status: adotado para homologação US-001; experimento executado e aprovado.
- Histórias: US-001. Não amplia a stack de execução do produto.
- Substitui: nenhum. Complementa ADR-0017 e o protocolo US-001.

## Contexto e decisão

O usuário autorizou preparar uma VM Windows no Docker e executar a homologação que faltava. Um contêiner Windows convencional não fornece o desktop interativo exigido pelo smoke Tauri/WebView; será usada uma instalação Windows 11 x64 completa, virtualizada por QEMU/KVM dentro do contêiner. Essa instalação possui perfil e Credential Manager próprios. O teste transfere apenas executáveis e backup sintético, sem o cofre, identidade da instalação ou chave de origem.

Selecionado dockur/windows 6.06, imagem docker.io/dockurr/windows fixada por digest sha256:16fd7c39a3e48bb946d29c59dc6015942e5b900a1fa5d7e5552053bfc48ee2ea; revisão declarada na imagem: 013ea27498e0e820a46b3861a0fa047d5b19d846. Docker Desktop usa Linux/WSL2. O kernel Microsoft já fornece kvm_intel e expõe VMX; o setup carrega o módulo existente, sem instalar kernel, modificar .wslconfig ou reiniciar distribuições alheias.

A VM recebe 4 vCPUs, 4 GiB de RAM e disco qcow2 esparso de 64 GiB em .tools/us001-docker-vm/storage. A imagem do Windows vem da Microsoft, com verificação do instalador habilitada. O runtime Visual C++ vem da Microsoft e sua assinatura Authenticode é validada antes da instalação silenciosa. A imagem Docker, o Windows e o runtime são dependências da homologação, sem dependências novas de produção.

## Execução e evidências

O setup e os harnesses ficam em infra/homologation. O host prepara a fixture e seu backup com segredo aleatório, remove o cofre e a chave originais e confirma a instalação vazia. A VM publica uma chave RSA efêmera de 3072 bits; o host usa RSA-OAEP-SHA256 para enviar somente o segredo de teste criptografado pelo compartilhamento. A chave privada existe apenas na memória do processo guest. Esse transporte é exclusivo da homologação, não altera o envelope de backup do ADR-0017 e usa primitivas das bibliotecas padrão.

O guest verifica hashes dos executáveis/pacote e compara identificadores de máquina por hashes, sem registrar identificadores, usuário ou SID. Testa senha incorreta, adulteração, interrupção em ambos os checkpoints, limpeza de staging, prévia sem publicação, restauração com novo ID, fixture exata e preservação byte a byte do cofre existente. Em seguida, reinicia-se o Windows completo. Após novo logon, o guest reabre os cofres pelo Credential Manager, executa o smoke real da WebView e remove as fixtures/credenciais sintéticas. O host salva somente metadados e resultados sanitizados, e para o contêiner.

## Fronteiras e ameaças

| Fronteira        | Controles                                                                                                                                 | Limites                                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Host/contêiner   | Digest fixo; sem Docker socket, disco físico ou diretório de usuário montados; compartilhamentos exclusivos em .tools                     | O provedor da imagem e administradores do Docker continuam confiáveis para este ambiente sintético.                                            |
| Host/guest       | Apenas executáveis, backup criptografado e metadados; senha encapsulada para chave efêmera; hashes conferidos                             | O compartilhamento local não é uma fronteira contra malware com acesso ao mesmo usuário/daemon. Não utilizar dados ou chaves reais.            |
| Rede             | Somente viewer publicado em 127.0.0.1:18006; sem porta RDP publicada; contêiner parado ao encerrar                                        | A preparação precisa baixar Windows/runtime. O viewer local é um instrumento administrativo de teste.                                          |
| Conta guest      | Conta local exclusiva; senha aleatória em env privado ignorado pelo Git, ACL restrita no host; sem login cloud ou credenciais de produção | Autologon permite automação e não representa a política de bloqueio do produto. O disco da VM deve ser tratado como material privado de teste. |
| Relatório        | Códigos fixos, versões, hashes de artefatos, contagens/booleans; nenhum payload financeiro ou segredo                                     | Resultado positivo só encerra US-001 se todos os testes e o reboot forem observados.                                                           |
| Recursos/limpeza | RAM/CPU/disco definidos; timeouts; apenas fixtures próprias removidas; VM parada ao concluir                                              | Não remover volumes de outros projetos. Homologação em hardware físico e queda de energia continuam fora deste experimento.                    |

## Resultado observado

Homologação aprovada em 2026-10-13: guest Windows 11 x64 build 10.0.26200.0 e SQLCipher 4.14.0 community. Todos os casos do harness passaram, inclusive restauração sem o cofre/chave de origem, falhas negativas, preservação byte a byte, recuperação da chave após reiniciar o Windows e smoke real Tauri/WebView. O relatório foi produzido depois da nova inicialização, com timestamps conferidos independentemente; relatórios prematuros são rejeitados pelo validador de evidência.

Fixtures/credenciais próprias removidas e contêiner encerrado. A [evidência sanitizada](../../quality/evidence/us-001-windows-vm-2026-10-13.json) inclui hashes dos executáveis e da imagem. Os [comandos reproduzíveis](../../../infra/homologation/README.md) permanecem disponíveis. O ambiente privado em .tools é material de teste e não deve ser versionado.

## Fontes primárias

- [dockur/windows: VM, requisitos e hook OEM](https://github.com/dockur/windows).
- [Configuração e opções do contêiner](https://github.com/dockur/windows/blob/013ea27498e0e820a46b3861a0fa047d5b19d846/docs/environment.md).
- [Limites de desktop em contêineres Windows](https://learn.microsoft.com/en-us/virtualization/windowscontainers/quick-start/lift-shift-to-containers).
- [Configuração WSL e virtualização aninhada](https://learn.microsoft.com/en-us/windows/wsl/wsl-config).
- [Runtime Visual C++ oficial](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist).
