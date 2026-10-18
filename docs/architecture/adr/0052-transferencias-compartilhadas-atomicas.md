# ADR-0052 — Transferências compartilhadas atômicas

Status: adotado no núcleo compartilhado da US-042; integração Desktop pendente. Complementa ADR-0037/0050. Homologação humana continua após integração completa, conforme ADR-0044. DP-01 a DP-04 permanecem abertas.

## Decisão

Comandos CREATE/EDIT/DELETE/RESTORE de transferência operam dois lançamentos de contas ASSET distintas, ativas, do mesmo workspace e moeda BRL. O Domain deriva sinais opostos a partir de uma magnitude positiva i64. Ambos usam economic_kind TRANSFER, preservando valor consolidado e separação de receita/consumo. Passivos e pagamentos de cartão seguem a US-043.

CREATE recebe três IDs UUIDv7 distintos: grupo, saída e entrada. Cria grupo TRANSFER/ACTIVE, dois lançamentos MANUAL e duas revisões na mesma transação existente. O coordenador exige autorização de escrita e acesso às duas contas, verifica a autoridade, carrega contas atuais e valida planos antes de inserir o grupo. Os adapters implementam createGroup no módulo dono de transaction_group; não expõem SQL ou conexão ao comando.

applyComposite é uma composição confiável de host com grupo de formato fechado e guard executado no coordenador. Não constitui rota HTTP/IPC e não aceita callback de usuário. Reutiliza fila SQLite/BEGIN IMMEDIATE, advisory lock/locks/RLS PostgreSQL, identidade/ator do host, versões e rollback. O método participa do controle de operações pendentes e de close dos adapters.

EDIT/DELETE/RESTORE recebem bases completas dos dois membros. Estado, origem, vínculo, conta, data e valores precisam formar um par manual coerente. A política compara as duas bases e descritores atuais; o coordenador exige a cobertura completa dos membros reais. Nenhum lado é confirmado isoladamente. Descrição original, tags e contraparte são preservadas. Uma alocação acompanha a magnitude; rateio múltiplo com alteração de valor exige revisão específica.

Exclusão lógica marca os dois membros e conserva o grupo estrutural ACTIVE, seus IDs e seu histórico, seguindo o coordenador de revisões existente. Restauração desmarca ambos somente sobre as versões atuais e contas válidas. Grupos BROKEN/VOIDED exigem seus próprios fluxos. Alterar o estado do grupo na exclusão exigiria outro contrato de versionamento e histórico; esta entrega não introduz essa mudança.

Repetir CREATE após confirmação retorna conflito, inclusive quando a resposta se perde. Não cria IDs ou rebase automaticamente. Não existe recibo durável novo. Os resultados são identificados por ID; a ordenação do lote não define origem/destino.

## Alternativas e consequências

Pré-criar grupos fora da transação deixaria órfãos após falhas. Duas chamadas independentes permitiriam confirmação parcial. Uma segunda camada de persistência duplicaria autorização e invariantes. A extensão estreita do coordenador mantém um único caminho de escrita e usa constraints existentes; não há migration, dependência de produção, permissão Tauri ou formato de backup novo.

Ameaças consideradas: grupo/conta de outro workspace, escopo parcial, base forjada/obsoleta, replay após ACK perdido, origem importada, grupo quebrado, falha na segunda revisão, classificações alteradas silenciosamente e dinheiro fora da faixa. O protocolo cobre rollback de grupo/membros/revisões e preservação integral do FIN-002. Campos financeiros não são registrados em logs operacionais.

## Evidência e limites

[Guia de reprodução](../../development/transfers.md) e protocolo PostgreSQL/SQLite com RLS, fixtures sintéticas, concorrência, precisão, reabertura e limpeza. CI configurada não representa execução remota observada. Desktop precisa de comando Rust e telas próprios; cloud precisa de composição real de identidade, feed/outbox e recibos. A base compartilhada não conclui a US-042 em todas as plataformas.
