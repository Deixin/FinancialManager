# Backup local criptografado — US-034

No Desktop Windows, abra um espaço local e escolha Backup local na visão inicial ou nas configurações. Informe senha de 12–128 caracteres, confirme e reconheça que PIN/Windows Hello não a recuperam. O Windows pede destino .fmbackup; use um novo nome. O aplicativo não guarda a senha. A confirmação só aparece após verificar o pacote gravado e mostra a data dessa criação. Criações anteriores desconhecidas não são apresentadas como histórico existente.

O pacote inclui todos os registros estruturados presentes no schema corrente, com histórico de revisões. Não inclui originais de documentos, chave do dispositivo ou identidade cloud. Entidades ainda não implementadas não são declaradas cobertas. Senha/chave de recuperação são independentes de PIN, Hello e credencial Windows; perder esse segredo pode tornar o backup irrecuperável. Guarde-o separado do arquivo. Pastas sincronizadas são escolha externa e recebem somente o pacote criptografado.

## Proteção e privacidade

O snapshot consistente já é SQLCipher com chave aleatória própria. Staging fica na instalação protegida e é removido antes da escolha de destino; se o processo terminar durante snapshot, a recuperação da instalação descarta apenas esse staging. Todas as tabelas atuais são incluídas: 12 financeiras e três internas. Validam-se schema/histórico v2, identidade LOCAL, integridade completa, FK/cipher e contagens. Não há nova migration financeira nem rekey da origem.

Envelope de produto v1 FMBK0034 usa AES-256-GCM com cabeçalho AAD e Argon2id v19 (64 MiB/3/p1), salt/nonce novos e snapshot key independente. Manifesto autenticado/criptografado contém versão, identidade, instante UTC, versão do app, contagens, SHA-256 do snapshot e descritor. Detalhes e dependências justificadas no [ADR-0045](../architecture/adr/0045-backup-criptografado-de-produto.md). Não há ZIP, compactação ou extração de caminhos. Limites: snapshot 64 MiB, manifesto 64 KiB; versões/custos desconhecidos são recusados antes do KDF. FMUS001 do spike não é compatível.

O Rust verifica sessão antes/depois de preparar o pacote. Senha, device key e snapshot key são descartadas antes do diálogo; a UI já ocultou dados e campos. Com PIN ativo, o seletor de destino fecha explicitamente a sessão; terminar/cancelar não a desbloqueia. Somente o pacote criptografado pode ser publicado durante essa espera, sem novas leituras de chave. Lease de instalação/geração impede reaproveitar resposta após bloqueio explícito ou alteração da proteção. Criações são serializadas e nunca há caminho recebido do renderer.

O comando específico create_local_backup amplia o conjunto para 11 permissões estreitas, sem filesystem/SQL/shell/dialog genérico. IFileSaveDialog roda na thread UI e não adiciona o destino aos recentes do Windows. Destinos internos, com extensão inválida ou já existentes são recusados. Persistência usa temporário irmão criptografado, sync, verificação, publicação sem sobrescrita e nova leitura. Erros não expõem caminho, senha, registros ou causa SQL. Cancelar tarde não apaga um pacote que já foi publicado; o usuário deve verificar qualquer arquivo cuja criação não foi confirmada.

## Reprodução automatizada

```sh
pnpm install --frozen-lockfile
pnpm desktop:backup:check
pnpm desktop:backup:native
pnpm desktop:workspaces:check
pnpm desktop:workspaces:native
pnpm desktop:vault:check
pnpm desktop:lock:check
pnpm desktop:lock:native
pnpm check
```

Pré-requisitos nativos seguem o [cofre Desktop](desktop-vault.md): Windows x64, Rust 1.99.0, MSVC/SDK, Perl Windows e WebView2. Em navegador sem Tauri, a prévia não cria backups ou um cofre persistente. Features backup-smoke/vault-smoke habilitam os instrumentos opcionais; o default exclui hooks, destinos forçados e fixtures. Nenhum teste solicita autenticação do usuário ou altera opções de entrada do Windows.

Os [sete gates Chromium](../quality/evidence/us-034-backup-browser-2026-10-17.json) cobrem entrada nativa, política, validação/confirmação, reconhecimento, ausência de dados durante o diálogo, limpeza de campos, sucesso/cancelamento com PIN bloqueado, erro sanitizado, resposta atrasada, axe, reflow 320px/texto 200%, cores forçadas e ausência de storage/egress/erros. Bridge é exclusiva de testes e não prova filesystem nativo.

Os [16 gates Windows](../quality/evidence/us-034-backup-windows-2026-10-17.json) incluem nove testes Rust reais de criptografia/IO/schema, build/Clippy, manifesto/estado financeiro, verificação em outro processo sem device key, senha errada/adulteração e três encerramentos de processo (snapshot, antes/depois da publicação). Seis checkpoints WebView2 usam comando de produto com seletor Rust sintético exclusivo do binário de teste; o pacote gerado pelo IPC é reaberto/validado e comparado ao FIN-002. Não se declara operação humana do IFileSaveDialog homologada por esse double.

Root/perfis/credenciais ficam em raízes novas marcadas em .tools/us034-backup. Limpeza remove/verifica credenciais de política e chaves próprias antes de apagar arquivos/perfis. Logs e relatórios fechados contêm gates, versões, pendências, hashes e data, sem registros, IDs de credencial, caminhos privados, snapshots ou segredos. Interrupção externa pode deixar temporário criptografado na pasta escolhida; o teste verifica ausência de pacote final parcial e a limpeza dos seus próprios recursos. Não se promete power loss ou atomicidade em todo filesystem.

## Sequência de integração

Conforme instrução do usuário e [ADR-0044](../architecture/adr/0044-homologacao-humana-apos-integracao.md), homologações humanas serão feitas após integrar todo o sistema. Continuar sem pedir confirmações por história. Manter seletor nativo, Windows Hello e demais cenários humanos registrados como diferidos, sem marcar aprovação inexistente ou usá-los para bloquear as histórias seguintes.

Próximo incremento: US-035, restaurar em staging e publicar como novo workspace após validar segredo, autenticidade, schema, invariantes e prévia. Esta história verifica portabilidade do pacote tecnicamente; não disponibiliza restauração de produto, reconexão cloud ou substituição de workspace. Assinatura, outras plataformas, outbox/G07-VAULT ampliado, DP-01 a DP-04 e os sete originais permanecem preservados.
