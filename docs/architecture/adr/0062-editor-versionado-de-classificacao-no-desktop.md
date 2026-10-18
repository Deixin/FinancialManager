# ADR-0062 — Editor versionado de classificação no Desktop

Data: 2026-10-18. Estado: adotado no recorte local da US-045; rateio editável pertence à US-046.

## Contexto

ADR-0058/0060 integram os catálogos, ADR-0059 define a associação compartilhada e ADR-0061 garante leitura completa para filtros no Desktop. Falta associar essas escolhas às revisões reais do cofre. Uma edição de classificação não pode reescrever valores, origem importada ou somente metade de um grupo.

## Decisão

O detalhe de movimentação oferece Classificar movimentação. A consulta por classificação também permite abrir o editor, revisar o histórico e editar categoria/subcategoria e tags. KEEP conserva alocações; SET escolhe uma classificação única com o módulo exato do valor, ID/nota existentes ou UUIDv7 novo; CLEAR remove explicitamente a classificação única. Rateios permitem editar tags com KEEP e recusam SET/CLEAR. Referências arquivadas existentes podem permanecer ou ser removidas; referências novas exigem estado ativo, pai correto e escopo econômico compatível.

apply_local_classification_change recebe um lote fechado de base, classificação e tag_ids, sem ator, SQL ou opções financeiras adicionais. Passa a ser o 28º comando específico de produção. LocalState exige sessão aberta antes da chave Windows, bloqueia escrita durante restauração preparada e verifica bloqueio antes do commit. O ator e a origem de alteração são definidos no host: LOCAL_USER sem identidade cloud e MANUAL. Origem e descrição original da transação permanecem intactas, inclusive para importações.

A função pura de revisão que já atendia transferências e pagamentos foi extraída para movement_model::revision e é reutilizada pelos três planejadores. Os pares existentes continuam com suas políticas específicas. A classificação compõe esse planejador, confere a base inteira e valida os catálogos pelo proprietário dentro da mesma transação. Todos os planos e grupos são conferidos antes da primeira escrita; local_movements::save continua sendo o gravador financeiro de produto, com versão-base e snapshot imutável. Não existe SQL alternativo de transações no novo adapter.

BEGIN IMMEDIATE mantém catálogo, estados e confirmação no mesmo contexto SQLCipher. O catálogo é lido sob demanda após carregar a transação e a conta, e reutilizado no lote. O lote admite 1–256 transações únicas, até 4 Mi unidades UTF-16 de JSON e também 4 MiB UTF-8 no IPC. Bases, dinheiro e versões usam contratos canônicos; não há ponto flutuante para valores financeiros. Nova alocação única com zero ou mínimo i64 é recusada; KEEP ainda permite tags.

Grupos exigem os dois membros atuais e bases completas, mesmo se o parceiro permanecer igual. Somente membros alterados recebem revisão. São conferidos tipo/estado do grupo, membros reais, contas distintas, data, sinais e natureza econômica. Transferência continua separada de consumo, e pagamento de cartão continua liquidação de dívida. A validação existente de grupos exige contas ativas. Em registros sem grupo, a classificação de metadados em conta arquivada segue a política compartilhada de revisões, sem alterar saldo ou reativar a conta.

O gateway copia/congela intenção, IDs e bases, confere todos os ACKs e verifica conteúdo, versões e histórico na leitura posterior. Resposta perdida ou inválida mantém a tentativa congelada. Repetir transmite a mesma intenção; se o commit já ocorreu, a versão antiga retorna conflito. Atualizar exige ação explícita para consultar e revisar. Não há rebase automático ou recibo durável de sucesso anterior. No-op com base atual não cria auditoria. Bloqueio/troca de espaço desmontam a tela; um ACK atrasado de uma tela fechada não inicia nova leitura.

O histórico mostra classificação e tags antes/depois; nomes são resolvidos pelo tipo da referência e pelo catálogo atual. Não se afirma que nomes de catálogo têm versionamento histórico. Snapshots legados incompatíveis permanecem preservados e identificados. O editor carrega sob demanda para limitar o bundle inicial. Dados financeiros continuam transitórios no renderer, sem armazenamento de navegador ou egresso externo.

## Consequências e verificação

Sem migration, dependência de produção, mudança do formato de backup ou integração externa. São preservados os sete originais e DP-01 a DP-04. A paridade compara 58 vetores gerados pela política/serviço compartilhados com o Rust. A preparação de importações de teste insere estados e revisões sintéticos uma única vez, sem desativar triggers de imutabilidade.

Testes Rust e protocolos Chromium/WebView2 cobrem referências, escopo, importação, rateios, grupos completos, no-op, conflito, ACK perdido, rollback, isolamento e PIN. Processos independentes verificam interrupção após a primeira escrita, antes/depois do commit e restauração em outra instalação após excluir a chave de origem, além da recusa de escrita com restauração preparada. Consulte o [guia](../../development/desktop-classification.md).

US-045 integra associação/filtros no núcleo compartilhado e no Desktop local. UI/endpoint cloud, Mobile autorizado, outbox/feed, versão/auditoria de catálogos e recibos duráveis continuam nos próprios gates. O próximo incremento é US-046, edição de rateios. Homologações humanas continuam após integrar o sistema, conforme ADR-0044.
