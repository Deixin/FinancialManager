# ADR-0066 — Associação versionada de contrapartes às movimentações

- Estado: adotada para o núcleo compartilhado da US-047.
- Data: 2026-10-18.
- Referências: PRD RF-06/RF-16; US-047; modelo de dados `counterparty_id`; ADR-0059/0063/0065.

## Contexto

O cadastro da US-047 já oferece identidades reutilizáveis por workspace. Sua associação precisa preservar a origem recebida, os valores e as personalizações financeiras e participar do histórico existente. Renomear uma contraparte não deve reescrever as movimentações que a utilizam nem ativar regras de importação.

## Decisão

O domínio puro oferece intenção explícita KEEP, CLEAR ou SET com o ID escolhido, sempre acompanhada da base completa de uma movimentação existente. O coordenador usa o gravador de revisões e o guard confiável da US-026. Não há segundo gravador, criação implícita de contraparte, mudança de nome de exibição, vinculação automática por texto ou regra retroativa.

O lote aceita de 1 a 256 movimentações únicas e até 4 Mi unidades UTF-16 de JSON. Comandos e bases são capturados antes da autorização assíncrona. A política valida a base inteira e limita o conteúdo resultante à alteração de counterparty_id. Descrição original, nome ajustado, origem, conta, valor, data, natureza econômica, parcelas, notas e tags permanecem iguais. Movimentações excluídas exigem restauração prévia.

O guard acessa uma porta opcional e confiável readCounterparties, implementada pelos adaptadores de revisão dentro da mesma transação. A consulta retorna somente id, workspace_id e status dos IDs finais solicitados, até 256, sem nomes ou identificadores pessoais. O proprietário counterparties executa o SQL; o módulo transactions não lê sua tabela diretamente. O coordenador captura a projeção e compartilha uma única leitura por lote. A ausência da porta falha explicitamente; não existe fallback para uma consulta fora da transação ou para dados do cliente.

Nova escolha deve existir e estar ativa no mesmo workspace. Uma referência arquivada já presente pode permanecer, inclusive por SET do mesmo ID, ou ser removida. Depois da remoção, selecionar novamente essa referência exige reativá-la. Homônimos continuam distintos e somente o ID explicitamente selecionado é usado.

PostgreSQL mantém RLS, papel de aplicação e o lock consultivo por workspace já compartilhado pelos catálogos e revisões. A projeção bloqueia as linhas lidas. SQLite mantém BEGIN IMMEDIATE e a fila do serviço de revisão. Nenhum estado de referência é obtido antes da transação. Mudanças entre autorização e gravação são verificadas sobre o estado corrente.

Todos os planos e grupos são validados antes das escritas. Transferências e pagamentos de cartão exigem os dois membros e autorização sobre ambas as contas, mesmo quando o parceiro usa KEEP. Somente membros alterados recebem nova revisão. Falha em qualquer gravação desfaz dados e auditoria. No-op conserva versão e histórico. Base completa divergente, versão antiga e respostas incertas exigem consulta/revisão explícita, sem rebase automático ou last-write-wins.

Reversão usa a versão corrente e o histórico existente e grava um novo evento REVERSAL. Edição posterior impede desfazimento destrutivo. Restaurar uma associação histórica não a transforma em uma nova escolha manual; referências arquivadas continuam válidas para o histórico, conforme as chaves estrangeiras existentes.

## Consequências e verificação

O protocolo executa os mesmos 18 cenários em PostgreSQL e SQLite, compara o grafo financeiro, reabre o banco local e valida o ator LOCAL_USER sem identidade cloud. Inclui regressões de revisões, categorias, taxonomia, classificação, rateios e cadastro de contrapartes. Os testes cobrem projeção mínima, captura antes de await, estado arquivado, escopo, origem importada, valores i64 exatos, grupos completos, disputa de versão, falha da segunda revisão e reversão protegida.

Sem migration, dependência de produção, alteração de backup, endpoint cloud ou comando Tauri. O núcleo compartilhado da US-047 passa a incluir cadastro e associação; integração Desktop/paridade Rust é o próximo incremento. Web/Mobile, auditoria monotônica do catálogo, recibos duráveis e feed/outbox mantêm seus gates. Homologações humanas permanecem após integração completa. Sete originais e DP-01 a DP-04 preservados.
