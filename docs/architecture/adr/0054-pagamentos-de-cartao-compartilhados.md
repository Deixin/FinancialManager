# ADR-0054 — Pagamentos de cartão compartilhados

Status: adotado no núcleo compartilhado da US-043; integração Desktop pendente. Complementa ADR-0037/0050/0052/0053. Homologação humana continua após integração completa, conforme ADR-0044. DP-01 a DP-04 permanecem abertas.

## Decisão

Comandos CREATE/EDIT/DELETE/RESTORE operam dois lançamentos do mesmo workspace/BRL: saída de uma conta ASSET e redução de um CREDIT_CARD/LIABILITY. Uma magnitude positiva i64 produz duas variações negativas iguais. Dívida exibida positiva diminui com o pagamento; excesso pode resultar em crédito negativo no cartão. O grupo é CARD_PAYMENT/ACTIVE e ambos usam DEBT_SETTLEMENT. Consumo permanece na compra EXPENSE ou em seu estorno EXPENSE_REVERSAL, com suas respectivas datas.

O Domain captura um contrato fechado antes de qualquer await. Descritores de conta são completos e imutáveis; contas precisam estar ativas. Mudanças recebem bases completas de ambos os lados e verificam estado atual, origem MANUAL, versões, vínculo, data, valores e natureza das contas anteriores e novas. Descrições originais, tags, contraparte e classificações são preservadas. Uma alocação acompanha a magnitude; rateio múltiplo exige revisão específica ao mudar valor. Grupos importados, BROKEN/VOIDED e conciliação de linhas existentes mantêm fluxos próprios.

O port usa o coordenador de revisões e adapters existentes. applyComposite aceita somente TRANSFER ou CARD_PAYMENT, com grupo fechado e guard obrigatório do host confiável. Não é rota HTTP/IPC ou callback do usuário. Autorização de escrita, escopo das duas contas, autoridade local/cloud, cobertura integral dos membros existentes e validação dos planos precedem os saves. Grupo, dois membros e revisões compartilham a transação; falha na segunda revisão desfaz o grupo e o primeiro lado. Fila SQLite/BEGIN IMMEDIATE, lock PostgreSQL/RLS, identidade e controle de close são mantidos.

EDIT pode trocar a origem ou o cartão por outro descritor válido. Não transforma compra em pagamento nem classifica linha importada automaticamente. DELETE/RESTORE marcam/desmarcam os dois membros sobre bases atuais e conservam grupo estrutural ACTIVE, IDs e revisões. CREATE repetido após ACK perdido retorna conflito; não gera IDs, rebase ou recibo novo automaticamente.

Pagamento parcial não presume saldo quitado, fatura completa, juros futuros ou parcelas ausentes. Pagamento sem itens não inventa despesa, renda ou categorias. A futura UI deve identificá-lo como “Pagamento de cartão sem detalhamento” enquanto faltar conciliação. Importação, vínculo com fatura/período e substituição dessa apresentação exigem staging/conciliação; o núcleo não conclui RF-08/FL-21 em todas as plataformas.

## Alternativas e consequências

Transferência com crédito positivo aumentaria a dívida do cartão. Uma segunda EXPENSE duplicaria consumo. Duas gravações independentes permitiriam confirmação parcial por falha de armazenamento. O comando específico reutiliza transações e constraints existentes, sem migration, dependência de produção, permissão Tauri ou formato de backup novo.

Ameaças consideradas: workspace/escopo parcial, cartão substituído por ativo/empréstimo, conta anterior arquivada, base forjada/obsoleta, grupo errado/incompleto, confirmação duplicada, falha parcial e precisão i64. Erros retornam códigos seguros; logs operacionais não incluem valores ou descrições. Docker de teste é sintético, isolado e temporário, sem nova integração externa de produto.

## Evidência e limites

O [protocolo](../../development/card-payments.md) executa o mesmo roteiro em PostgreSQL/SQLite, compara snapshots e versões, preserva FIN-002, testa LOCAL sem identidade cloud, RLS, concorrência, rollback, reabertura e limpeza. CT-06 recebe evidência no núcleo: compra em setembro, pagamentos parciais em outubro e estorno em novembro. Desktop, importação/conciliação, cloud/feed/outbox/recibos e homologação humana integrada conservam seus gates. CI configurada não representa execução remota observada.
