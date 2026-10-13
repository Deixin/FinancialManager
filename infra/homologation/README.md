# Homologação Desktop US-001 em VM Docker

Ambiente exclusivo para dados sintéticos, autorizado para concluir o gate de outra instalação Windows. O [ADR-0018](../../docs/architecture/adr/0018-homologacao-desktop-vm-docker.md) registra imagem, recursos e ameaças. A aplicação financeira não depende desse contêiner.

## Pré-requisitos e execução

Windows 11 x64, Docker Desktop com engine Linux/WSL2, virtualização aninhada e módulo KVM Intel disponível. Este setup corresponde ao host Intel observado; não instala kernel nem altera .wslconfig. Reserve espaço para Windows, mídia de instalação e disco esparso de 64 GiB; a VM usa 4 GiB de RAM e 4 vCPUs. A primeira preparação baixa vários GiB e precisa de rede.

Na raiz do repositório, depois dos gates nativos e da compilação dos executáveis:

```sh
pnpm spike:desktop:check
pnpm spike:desktop:vm:setup
pnpm spike:desktop:vm:test
```

setup cria o ambiente privado em .tools/us001-docker-vm e inicia fm-us001-windows. O viewer fica em http://127.0.0.1:18006, acessível somente nesta máquina. test copia os executáveis, espera o logon interativo na VM, exporta a fixture do host, remove cofre/chave de origem e executa a homologação no guest. A senha aleatória do backup é encapsulada por RSA-OAEP-SHA256 para uma chave privada efêmera do guest; não é gravada em claro em arquivos, argumentos ou variáveis de ambiente.

O harness espera a instalação por até 90 minutos e cada fase de teste por até 15 minutos. Reinicia o Windows completo entre restore e verificação de persistência da chave. Ao terminar, grava .tools/us001-docker-vm/homologation-result.json e para o contêiner. Falha e timeout encerram com código diferente de zero. O smoke interno do Tauri permanece com another_windows_profile_verified false porque sua demonstração roda dentro de um só perfil; a evidência host → guest fica no relatório de homologação separado.

## Isolamento e limpeza

Somente storage, oem e shared dessa pasta são montados. Nenhum cofre, .installation-id, diretório pessoal, socket Docker, chave de produto ou credencial de produção é compartilhado. A senha da conta Windows de teste fica no env privado com ACL restrita; a VM usa autologon para o experimento. Não use esse ambiente com dados reais.

O guest remove as fixtures e entradas do Credential Manager próprias após passar os testes. O contêiner permanece parado e o disco privado é preservado para diagnóstico. Para interromper a execução, pare fm-us001-windows. Para descartar o ambiente, confirme primeiro o caminho absoluto .tools/us001-docker-vm dentro deste repositório e guarde o relatório sanitizado; não remova volumes de outros projetos.

Um resultado já existente impede repetir o harness sobre evidência antiga. Uma nova homologação exige um ambiente novo, preservando o relatório anterior. Não interprete apenas o boot Windows ou a criação do contêiner como aprovação da US-001.
