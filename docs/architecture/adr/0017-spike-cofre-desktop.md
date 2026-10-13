# ADR-0017 — Cofre e recuperação experimental Desktop

- Data: 2026-10-13.
- Status: adotado e validado no experimento US-001, incluindo outra instalação Windows; escolha final de produção pendente.
- Histórias: US-001; subsídio para US-007, US-032, US-034 e US-035.
- Substitui: nenhum. Preserva ADR-005/006 e RF-32.

## Contexto

O primeiro spike W0 deve provar um cofre local sem identidade cloud, chave protegida pelo Windows, backup autenticado e restauração independente do dispositivo original. O experimento fica em apps/desktop/spikes/us-001, separado do schema e da UI de produto. Usa apenas fixtures explicitamente sintéticas.

## Alternativas

- rusqlite com SQLCipher/OpenSSL compilados e vinculados estaticamente: permite verificar o engine real e testar sem um SQLCipher instalado globalmente. Selecionado para o spike; implica custo de build e inventário de licenças de dependências nativas.
- SQLCipher dinâmico instalado no sistema: facilita alguns builds, mas exige distribuir e validar bibliotecas externas compatíveis. Não utilizado neste experimento.
- Windows Credential Manager: selecionado com persistência LocalMachine, por usuário Windows, sem roaming Enterprise. A biblioteca específica evita incluir outros backends e uma API genérica de plugins na WebView.
- Arquivo de chave protegido por DPAPI: alternativa possível, mas adicionaria um protocolo próprio de armazenamento/recuperação de blobs. Não selecionado neste experimento.
- Backup com dependência da chave do dispositivo: descartado porque não demonstra recuperação em outra instalação.

## Decisão experimental

Um SQLCipher por workspace, com chave de 256 bits gerada pelo CSPRNG do SO. As entradas do Credential Manager incluem UUIDv7 da instalação e do workspace em um namespace exclusivo do spike. Abertura de cofre existente nunca cria ou substitui a chave ausente. Erros do store são explícitos e não viram fallback em claro.

Usar rusqlite 0.40.2 com bundled-sqlcipher-vendored-openssl, keyring-core 1.0.1 e windows-native-keyring-store 1.1.0. Cargo.lock fixa dependências transitivas. O build local usa Perl Windows nativo; o Perl do Git não possui os módulos e a semântica de caminhos exigidos por esse build. Foi preparado Strawberry Perl portátil 5.42.3.1, em .tools, sem alterar PATH global. SHA256 do arquivo oficial: 6a081a811781c30aca51dbc036afd93092af91e3297901f02c17043795a10690.

O banco usa journal DELETE, synchronous FULL, temp_store MEMORY, cipher_memory_security e secure_delete. O schema sintético possui migration transacional 0001 e user_version 1, valores INTEGER lidos como i64, e representações JSON monetárias em strings decimais. Essas tabelas não substituem o modelo físico de US-020/021. Restore verifica a versão, as definições exatas das tabelas, ausência de triggers/views adicionais, integridade SQLite/SQLCipher e a autoridade LOCAL.

O snapshot é produzido com sqlcipher_export para outro banco criptografado, dentro de uma transação. Sua chave independente e os bytes criptografados formam o payload do pacote experimental. O envelope usa Argon2id v19 (64 MiB, 3 iterações, paralelismo 1, saída 32 bytes), salt aleatório de 16 bytes e AES-256-GCM, nonce aleatório de 12 bytes e tag de 16 bytes. O cabeçalho inteiro é autenticado como AAD. Cada pacote recebe salt, nonce e chave de snapshot novos.

O formato binário FMUS001 versão 1 é exclusivo do spike. Limite de snapshot: 16 MiB; senha: 12–1024 bytes UTF-8. Tamanho, versão, comprimento e parâmetros fixos são verificados antes do KDF. Não há compressão, valores de custo fornecidos pelo arquivo ou plugins de extração. Não prometer compatibilidade com o futuro formato de produção .fmbackup.

Na restauração, autenticar o envelope em memória; gravar apenas o SQLCipher em staging; validar schema, integridade e prévia; gerar chave nova; executar rekey; gerar novo UUIDv7 e autoridade LOCAL; validar novamente e reabrir; persistir a chave no Windows; publicar por rename de diretório no mesmo volume. O destino é sempre novo e a instalação tem lock exclusivo. Backups existentes não são sobrescritos.

Ao reiniciar, staging interrompido é descartado com a chave órfã correspondente. Se o secret store estiver indisponível, manter staging criptografado e falhar, para permitir nova tentativa de limpeza. O ponto de publicação ocorre depois do armazenamento da chave. O spike permite fault injection explícito antes da publicação; esses comandos não são expostos à WebView.

Tauri 2.12.3 possui apenas uma WebView local, CSP restrita e duas permissões de aplicação para comandos sintéticos sem parâmetros de SQL, arquivos ou chaves. A interface estática é apenas um instrumento do spike; React/Vite da aplicação continuam previstos. O smoke inicia uma WebView real, faz ida e volta pelo IPC, executa a demonstração e grava somente resultado/versões/booleans. Não adiciona plugins de SQL, filesystem, shell, HTTP ou telemetria.

## Dependências e consequências

- aes-gcm 0.11.1 e argon2 0.6.0 implementam AEAD e KDF; não implementar primitivas criptográficas próprias.
- getrandom 0.4.3 fornece entropia do SO; zeroize 1.9.1 reduz a permanência de chaves, payload e senhas em buffers controlados pela aplicação.
- uuid 1.28.0 fornece UUIDv7; serde/serde_json serializam apenas respostas e snapshots tipados. Os logs usam códigos de erro fixos.
- tempfile 3.27.0 suporta temporários e publicação sem sobrescrita; rpassword 7.5.4 evita eco de senha no CLI interativo.
- tauri/tauri-build exercitam a fronteira nativa/WebView. São opcionais para os testes do núcleo, incluídos no gate nativo completo.
- Nenhuma dependência de produção foi adicionada aos packages puros ou ao manifesto JavaScript do produto. Os componentes acima são dependências de execução do spike e precisam de nova avaliação antes da adoção em produção.

## Ameaças e limites

| Fronteira        | Controle e teste esperado                                                       | Limite                                                                                         |
| ---------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Disco e chave    | SQLCipher, Credential Manager, falta/chave incorreta rejeitadas                 | Malware no mesmo usuário ou processo desbloqueado não é mitigado por criptografia em repouso.  |
| Pacote hostil    | AEAD, cabeçalho autenticado, limites antes do KDF, schema fechado               | O limite de 16 MiB é experimental, não dimensionamento do produto.                             |
| Falha/queda      | Staging criptografado, lock, key-before-rename, recuperação no próximo processo | Validação de queda de energia/filesystem e hardware diferente permanece homologação adicional. |
| WebView          | CSP, permissões locais, comandos sem SQL/FS genérico                            | O spike não entrega a autorização e o modelo de capabilities de todas as telas futuras.        |
| Logs/memória     | Códigos allowlisted, nenhuma impressão de payload, buffers zeroizados           | Bibliotecas, SO e paginação têm cópias fora dos buffers controlados pela aplicação.            |
| Outra instalação | Backup independe da chave original, novo namespace, nova chave e novo workspace | Dois processos/raízes no mesmo perfil não provam recuperação em outro usuário ou máquina.      |

## Validação e aprovação

Comandos: pnpm env:check --desktop, pnpm spike:desktop:test, pnpm spike:desktop:check e pnpm check. Resultados e pendências devem constar no [estado do projeto](../../delivery/status.md) e no [protocolo](../../development/spikes/us-001-desktop-vault.md).

Em 2026-10-13, os 13 testes Rust e o smoke nativo real Tauri/WebView passaram no Windows 11 x64 local, incluindo remoção da origem e interrupções entre processos. O runtime reportou SQLCipher 4.14.0 community. A homologação host → VM Windows 11 independente também passou, incluindo recuperação das chaves após reiniciar o Windows, fixture exata, preservação do cofre existente e smoke da WebView. O [ADR-0018](0018-homologacao-desktop-vm-docker.md) e a [evidência sanitizada](../../quality/evidence/us-001-windows-vm-2026-10-13.json) registram o ambiente e os resultados. A CI inclui um job Windows separado, configurado a partir do [inventário oficial do runner](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md); não há resultado remoto ainda.

US-001 concluída no escopo experimental do protocolo. Este resultado subsidia US-007 e não aprova formato/schema finais, distribuição assinada ou todas as plataformas do produto. DP-01, DP-02 e DP-03 continuam pendentes e não são afetadas.

## Fontes primárias

- [API SQLCipher: key, export, rekey e integrity check](https://www.zetetic.net/sqlcipher/sqlcipher-api/).
- [rusqlite e features de build](https://docs.rs/rusqlite/0.40.2/rusqlite/).
- [Windows native keyring store](https://docs.rs/windows-native-keyring-store/1.1.0/windows_native_keyring_store/).
- [Argon2: derivação de chave](https://docs.rs/argon2/0.6.0/argon2/).
- [AES-GCM](https://docs.rs/aes-gcm/0.11.1/aes_gcm/).
- [Tauri: permissões](https://v2.tauri.app/security/permissions/).
- [Strawberry Perl 5.42.3.1 portátil](https://github.com/StrawberryPerl/Perl-Dist-Strawberry/releases/tag/SP_54231_64bit).
