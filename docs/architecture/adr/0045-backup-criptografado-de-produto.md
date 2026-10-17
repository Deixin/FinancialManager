# ADR-0045 — Backup criptografado e versionado de produto

Status: implementação US-034 para Windows x64, com validação automatizada e homologação humana diferida conforme [ADR-0044](0044-homologacao-humana-apos-integracao.md).

Data: 2026-10-17. Referências: RF-32, BK-01/FL-14, arquitetura §05.3, backup_manifest e [protocolo](../../development/local-backup.md). Não substitui o formato experimental FMUS001 nem implementa a publicação de restauração da US-035.

## Snapshot e conteúdo

Criar snapshot consistente de todo o workspace local com sqlcipher_export em transação, usando outra chave CSPRNG de 256 bits. O arquivo temporário já é SQLCipher e permanece em staging da instalação. Validar schema/histórico corrente, integrity_check, FK/cipher integrity e identidade LOCAL única. Não persistir SQLite aberto, JSON financeiro em claro ou originais de documentos. Snapshot inclui as 12 tabelas financeiras presentes e as três internas de migração/validação; futuras entidades exigirão as respectivas migrations e revalidação.

O schema financeiro permanece v2. Schema version é obtida do catálogo de migrations, não de um número escolhido pelo renderer. O [sqlcipher_export](https://www.zetetic.net/sqlcipher/sqlcipher-api/#sqlcipher_export) não transfere user_version automaticamente; o snapshot recebe explicitamente a versão corrente. Exportar não altera a chave nem o estado financeiro do cofre de origem. Staging interrompido segue a recuperação já existente e sua chave temporária nunca é gravada no secret store.

## Formato de produto v1

Envelope FMBK0034, versão u16=1, com cabeçalho de 58 bytes: magic, versão, custos Argon2id, salt de 16 bytes, nonce de 12 bytes e comprimento u64 do ciphertext. AES-256-GCM com tag de 16 bytes autentica todo o cabeçalho como AAD e todo o payload. Novo salt, nonce e chave de snapshot por pacote. Argon2id v19: 64 MiB, três passes, paralelismo 1, saída de 32 bytes; custos recebidos do arquivo devem ser exatamente os da versão antes de executar KDF.

O payload autenticado contém comprimento u32 do manifesto JSON, manifesto, chave aleatória do snapshot e payload.enc SQLCipher. manifest.json e payload.enc são entradas lógicas em framing fixo; não há ZIP, extração de caminhos ou compressão. O manifesto inclui format_version, workspace_id, schema_version, created_at UTC canônico, app_version, record_counts de todas as tabelas, integrity_hashes e encryption_descriptor. SHA-256 de payload.enc fica dentro do envelope autenticado. Chave do dispositivo não entra no pacote; a chave de snapshot só existe em claro em buffers nativos protegidos por descarte e dentro do envelope descriptografado.

Limites v1: snapshot de 64 MiB e manifesto de 64 KiB. Validar tamanho/versão/comprimento/custos antes do KDF, sem alocação guiada por custos do arquivo. Senha de 12–128 caracteres Unicode, até 1024 bytes UTF-8, sem controles e sem ser somente espaços; confirmação exata, sem trim/normalização. Não guardar a senha, nem derivar o backup do PIN ou da credencial Windows. O pacote de spike é explicitamente incompatível.

aes-gcm 0.11.1 com zeroize passa a dependência de produto para a primitiva AEAD; argon2 0.6.0 já estava adotado. A [documentação RustCrypto](https://docs.rs/aes-gcm/0.11.1/aes_gcm/#security-notes) registra auditoria da biblioteca e condições de tempo constante, sem representar nova auditoria independente desta integração. tempfile 3.27.0, antes de teste, passa a produção para temporário irmão e persist_noclobber; [garantias documentadas](https://docs.rs/tempfile/3.27.0/tempfile/struct.NamedTempFile.html#method.persist_noclobber) são avaliadas no alvo Windows, sem prometer atomicidade/durabilidade em todo filesystem ou power loss.

## Escolha de destino e publicação

Adicionar somente create_local_backup ao conjunto estreito de IPC (11 comandos). Input fechado recebe workspace e senha/confirmação, sem caminho, SQL, chave ou resultado de validação. IFileSaveDialog executa na thread UI, com HWND nativo, filtro fmbackup e opção de não adicionar aos arquivos recentes. Não conceder plugin genérico de filesystem/diálogo à WebView. Caminho só existe no Rust, e pasta interna da instalação é recusada.

LocalState exige sessão aberta antes/depois da preparação, serializa snapshot/KDF e permite uma criação pendente. Senha e chaves são descartadas antes do diálogo; somente pacote já criptografado e lease nativo de instalação/geração atravessam a espera. Antes de abrir o diálogo, fechar explicitamente a sessão com PIN. A UI já removeu a árvore financeira e os campos; blur do diálogo não invalida seu próprio pedido. Não reabrir o cofre para gravar o arquivo. Concluir/cancelar não desbloqueia os espaços. Bloqueio explícito, saída ou nova autenticação/política invalidam leases antigos.

Gravar temporário criptografado irmão, sync_all, verificar tamanho/SHA-256 do conteúdo AEAD previamente validado, conferir lease, publicar sem sobrescrita e reler o destino para verificar tamanho/hash antes de confirmar. Recusar destino existente, inclusive link. Não apagar um arquivo publicado diante de erro posterior ou bloqueio tardio; uma publicação já concluída pode existir, mas não há confirmação atrasada na UI. A mensagem de falha orienta não considerar um arquivo não confirmado como backup válido.

Em encerramento abrupto antes da publicação pode restar temporário criptografado na pasta escolhida; nenhum pacote final parcial ou original financeiro é publicado. Não varrer pastas do usuário na próxima abertura para excluir arquivos por prefixo. Staging interno é recuperado pela instalação. Sem nova tabela de histórico de backup; informar data da criação confirmada e indicar ausência de informação sobre criações anteriores quando desconhecida.

## Ameaças, verificação e limites

Cobrir senha errada, adulteração de cabeçalho/manifesto/ciphertext/tag, parâmetros KDF hostis, manifestos autenticados incompatíveis, contagens inconsistentes, arquivo grande/truncado, colisão de destino, cancelamento, resposta atrasada e leitura de chaves bloqueada. Comparar ciphertext de origem e digest de todas as colunas do FIN-002; verificar o pacote em outro processo usando somente o segredo de recuperação. Instrumentos testam três pontos de interrupção, WebView2 com destino Rust sintético e ausência de armazenamento/tráfego WebView. Hooks e fixture/segredos sintéticos só entram nas features/binários de teste.

Política clara informa independência/irreversibilidade da senha, limite, não sobrescrita e escolha externa de pasta sincronizada. UI, logs e relatórios não recebem caminho, manifesto, chave ou payload financeiro. O perfil Windows/OS e a pasta escolhida permanecem fronteiras confiáveis; não prometer proteção contra administrador/código arbitrário no perfil comprometido ou contra remoção externa do arquivo após a verificação.

Homologações humanas do seletor nativo e do fluxo integrado ficam diferidas. US-035 publicará restauração em staging como novo workspace após validação; leitor/verificação técnica de pacote nesta história não constitui restauração de produto. Backup de entidades ainda não implementadas, outbox, assinatura, outras plataformas, G07-VAULT global e DP-01 a DP-04 mantêm seus gates. Sete originais preservados.
