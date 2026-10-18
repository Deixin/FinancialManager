# ADR-0053 — Transferências no Desktop SQLCipher

Status: adotado no recorte Desktop local da US-042. Complementa ADR-0052 e mantém homologações humanas após integração completa (ADR-0044). DP-01 a DP-04 permanecem abertas.

## Decisão

read_local_transfers e apply_local_transfer acrescentam duas operações específicas ao Tauri, totalizando 21 permissões de produto. O comando traz intenção fechada; SQL, caminhos, chaves, ator e gravação arbitrária de snapshots permanecem fora do IPC. O Rust confirma espaço local/PIN, contas e bases atuais, grupo íntegro e coerência do par em uma transação SQLCipher IMMEDIATE. Grupo novo, dois lançamentos, relações e revisões são confirmados juntos. Ator LOCAL_USER, horário e IDs de revisão vêm do host.

A leitura específica retorna o snapshot financeiro e metadados de grupo (tipo, estado e membros) na mesma transação DEFERRED. A fronteira TypeScript exige correspondência integral dos membros com os lançamentos visíveis do workspace. Grupos incompletos, anulados, outras origens ou contas arquivadas permanecem consultáveis; a UI não os repara ou restaura por aproximação. O contrato read_local_movements continua com o formato anterior.

O modelo Rust puro é confrontado com vetores produzidos pelo serviço compartilhado de produção. A comparação identificou que o coordenador aceitava metadados parciais de membros existentes. Ele agora exige correspondência exata de ID e conta com todos os membros anteriores incluídos no plano. Grupos novos/pré-criados sem membros continuam compatíveis com inserção atômica do par. A regressão cobre uma projeção incompleta antes de qualquer save; não contorna RLS ou constraints.

## Interface e ciclo de vida

Movimentações oferece Nova transferência, Ver transferências e acesso ao par completo no detalhe de um lançamento. Criar/editar exige contas ASSET distintas e ativas, data, valor positivo BRL, nome e confirmação dos dois lados. Entrada/saída usam sinais opostos; não viram receita/consumo. Edição preserva descrições originais, tags, contraparte e classificações; uma alocação acompanha o valor e rateio múltiplo pede revisão. Excluir/restaurar exige confirmação contextual e muda ambos os membros.

A UI usa dados transitórios, removidos ao bloquear ou trocar de espaço. Intenção congelada mantém os mesmos três IDs/bases após resposta perdida. Repetir uma confirmação já gravada retorna conflito; consultar o resultado antecede uma nova intenção. Não há rebase, recibo durável ou last-write-wins novo.

Leituras recusam mais de 200 mil registros agregados ou 32 MiB e comandos acima de 1 MiB são recusados antes de buscar a chave financeira. Não há truncamento ou total parcial. Saldos permanecem estimados e respeitam as referências e a data financeira. Não se promete efeito em uma data anterior à movimentação.

## Consequências e alternativas

Duas gravações independentes permitiriam confirmação parcial. Abrir SQL genérico ou confiar só na validação da WebView ampliaria a fronteira de confiança. Usar somente a lista de lançamentos ocultaria o estado estrutural do grupo. As operações específicas reutilizam o proprietário SQLCipher e a política de revisão existente; não há schema, dependência de produção ou formato de backup novo.

Grupo estrutural continua ACTIVE na exclusão lógica, conforme ADR-0052. Backup/restauração existente preserva o grafo e snapshots de formato 1, com novos IDs e autoridade no destino. Probes, falhas injetadas e WebView2 instrumentado são opcionais e ausentes do build padrão.

## Evidência e limites

[Guia Desktop](../../development/desktop-transfers.md) com reprodução e evidências Chromium/Windows. Gates exigem corpus compartilhado, SQLCipher, perda de ACK após commit, reabertura independente, interrupção após o primeiro lado/commit e restauração sem a chave de origem. RLS, revisões, manual, contas e fluxos Desktop afetados mantêm seus protocolos reais.

Homologação humana, cloud/outbox/feed/recibos, outras plataformas, paginação e release assinado continuam nos próprios gates. Pagamento de cartão segue na US-043. CI configurada não representa execução remota observada.
