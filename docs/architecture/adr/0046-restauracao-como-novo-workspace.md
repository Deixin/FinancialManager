# ADR-0046 — Restauração como novo workspace local

Status: implementação US-035 em Windows x64; validação automatizada e homologações humanas diferidas conforme [ADR-0044](0044-homologacao-humana-apos-integracao.md).

Data: 2026-10-17. Referências: RF-32/CT-02, BK-02/FL-15, arquitetura §05.3, [backup v1](0045-backup-criptografado-de-produto.md) e [protocolo](../../development/local-restore.md).

## Seleção, segredo e prévia

Acrescentar select_local_backup, preview_local_restore, confirm_local_restore e cancel_local_restore, totalizando 15 comandos específicos. A WebView não recebe nem escolhe caminhos, chaves, SQL ou provas de validação. IFileOpenDialog roda na thread UI, com HWND do host, filtro fmbackup, arquivo existente e sem adicionar aos recentes. Somente o seletor nativo fornece o caminho; arquivos internos, links, extensão/tamanho inválidos são recusados. Adaptador sintético de destino pertence apenas aos testes.

Selecionar começa com sessão aberta e fecha explicitamente o acesso por PIN antes do seletor. Após selecionar, PIN/Hello deve liberar novamente a sessão antes de informar o segredo. Token opaco de seleção mantém somente um caminho no Rust até cancelar, selecionar outro arquivo ou encerrar o processo. Não contém prévia financeira ou segredo; pode atravessar essa reautenticação. Bloqueio explícito durante a escolha invalida seu lease e descarta a resposta. Falhas e cancelamento não desbloqueiam o aplicativo.

A senha original passa pelo codec da versão de backup e é descartada com zeroize no Rust. Autenticação AEAD, formato, limites, schema e checksum são verificados antes de escrever qualquer snapshot. Não há descoberta de segredo por PIN/Hello, armazenamento de senha ou reconexão cloud. Formato aceito é FMBK0034 v1 com snapshot/schema v2, o único formato de produto já emitido. FMUS001, versões futuras e históricos de revisão incompatíveis falham fechados; a história não inventa conversão desses formatos.

## Staging e nova autoridade

Depois de autenticar, escrever apenas o snapshot SQLCipher dentro de staging privado com UUID novo. Validar schema/histórico exatos, user_version, integridade completa, cipher/FKs, identidade LOCAL única e todas as contagens. Criar outro cofre já SQLCipher com chave CSPRNG independente e migrations correntes, mantendo FK, triggers e guardas diferidas habilitados. Copiar as 12 tabelas financeiras em transação com parâmetros e tipos SQLite INTEGER/TEXT/NULL; REAL/BLOB não são aceitos. Tabelas internas são geradas pelo migrador/triggers e suas contagens também precisam coincidir.

Workspace recebe UUIDv7, sync_generation, data de criação e nome com sufixo restaurado novos; os demais atributos estruturados são preservados. Todas as PKs de recursos e referências correspondentes recebem UUIDv7 novos, incluindo IDs que só existem no histórico. Isso evita colisões entre cópias independentes em uma futura migração cloud. Não há identidade, membro, fila ou vínculo remoto criado. Arquivos originais fiscais e entidades ainda não implementadas não são declarados cobertos.

Snapshots transaction_revision v1 são adaptados por campos conhecidos: workspace/transação, conta/grupo/contraparte, rateios/categorias/subcategorias e marcadores. Versão/base, identidade, timestamps, estrutura fechada e inteiros monetários canônicos são conferidos; valores, descrições, notas e demais conteúdo histórico não são recalculados ou substituídos por busca textual. Um texto que coincide com um UUID continua literal. O placeholder histórico vazio do schema/FIN-002 é preservado como tal; formatos desconhecidos são recusados, sem perder silenciosamente histórico. O banco de origem e o arquivo de backup nunca são regravados.

Fechar conexões, apagar o snapshot intermediário e guardar a nova chave no Windows Credential Manager com escrita/readback antes de liberar a prévia. Nenhuma senha, chave ou conexão fica retida durante a revisão humana da prévia. Guardam-se apenas metadados, contagens, hash do ciphertext e geração do pedido. Prévia mostra origem, data do backup, nome local resultante e contagens das 12 tabelas; exige reconhecimento antes de confirmar. A UI esconde dados/campos durante processamento e descarta respostas antigas. Após restaurar, a visão inicial deixa de afirmar que um cofre desconhecido está vazio; consulta financeira completa pertence às próximas telas.

## Confirmação, repetição e recuperação

Mensagens de conclusão são genéricas e não incluem nome do espaço. O status nativo pode informar bloqueio depois de entregar uma resposta de confirmação; nesse caso a tela protegida não deve reapresentar metadados por meio do aviso. Teste de navegador reproduz essa ordem sem emitir blur no DOM, verifica ausência de nomes e exige nova autenticação antes de abrir o espaço.

Confirmar exige sessão aberta, ID da prévia e geração válidos. Conferir novamente hash, schema/integridade e contagens, fechar banco/chave e conferir cancelamento antes de renomear staging para workspaces no mesmo volume. Renomear é a última operação falível da publicação. Nunca oferecer substituição de espaço existente. Um bloqueio após a publicação pode impedir a resposta, mas não apaga um cofre publicado.

O recibo privado .restored-v1 contém somente o UUID aleatório do novo espaço e acompanha a mesma publicação do diretório. Repetir confirm_local_restore com esse ID reabre o mesmo espaço, inclusive após reiniciar o processo; não cria outra cópia. Um workspace comum sem recibo não serve como confirmação de restauração. Não armazenar recibo ou histórico financeiro em localStorage/IndexedDB. Após perder resposta/estado da UI, orientar conferir a lista antes de selecionar novamente; importar deliberadamente de novo cria outra autoridade independente.

Bloqueio/foco/política revogam a prévia e removem sua chave/staging, sem ler chaves financeiras existentes. Cancelar é permitido com sessão fechada para limpar somente recursos do pedido. Criar outro espaço é recusado enquanto uma prévia está pendente, para não acionar a recuperação genérica sobre staging em revisão. Ao reiniciar, recuperação existente descarta staging órfão e suas credenciais; nunca remove chave de diretório publicado. Escrita ambígua/limpeza falha permanecem erro e preservam material criptografado recuperável. Três subprocessos são encerrados após staging, antes e depois da publicação para verificar essas fronteiras.

## Ameaças e limites

A validação atual cobre formato, histórico conhecido e constraints do schema persistido corrente. Regras financeiras ampliadas permanecem no Domain e na integração dos módulos de contas/movimentações; não são duplicadas no adaptador de restauração nem declaradas globalmente homologadas por esta história.

Cobrir pacote adulterado/senha errada, schema/contagens falsificados com autenticação válida, IDs reutilizados, referências incorretas, dinheiro com float em histórico, texto UUID alterado, prévia sem publicação, cancelamento/resposta antiga, PIN fechado, staging alterado, falha de secret store e confirmação repetida. Oráculo de teste normaliza IDs por ordem dos registros e referências explícitas, sem consultar o mapa de IDs do produto, comparando todas as colunas financeiras do FIN-002. Processo de restauração real usa outra instalação com a chave da origem removida do Windows store depois do backup.

Nenhuma dependência de produção nova, migration financeira ou serviço externo é adicionado. Caminhos/credenciais/conteúdo financeiro não entram em logs ou relatórios. OS/perfil/diretório continuam confiáveis; não há promessa de resistência a administrador comprometido, power loss, todo filesystem, assinatura ou outras plataformas. O seletor humano e o sistema integrado serão homologados depois, sem marcar execução inexistente como aprovada. Próximo incremento é US-036. Sete originais, DP-01 a DP-04, outbox e G07-VAULT global preservam seus escopos.
