# ADR-0055 — Cartões e pagamentos no Desktop

Status: adotado no recorte Desktop local da US-043. Complementa ADR-0054/0053. Homologação humana permanece após integração completa (ADR-0044); DP-01 a DP-04 preservadas.

## Decisão

read_local_card_payments e apply_local_card_payment acrescentam duas operações específicas, totalizando 23 permissões de produto. O Rust verifica workspace local, PIN, contas atuais e bases completas. Grupo CARD_PAYMENT/ACTIVE, dois membros DEBT_SETTLEMENT, relações e revisões são confirmados na mesma transação SQLCipher IMMEDIATE. A variação é negativa nos dois lados: diminui banco e dívida exibida do cartão. Ator LOCAL_USER, IDs de revisão e instante vêm do host.

O comando fechado admite CREATE/EDIT/DELETE/RESTORE com origem ASSET e destino CREDIT_CARD/LIABILITY ativos do mesmo workspace/BRL. Leitura retorna movimentos, contas, referências, histórico e grupos no mesmo snapshot DEFERRED. A fronteira TypeScript confere correspondência integral dos membros; a natureza da conta identifica origem e cartão, pois ambos têm valores negativos. Validações Rust são confrontadas com vetores gerados pelo serviço compartilhado.

Bases forjadas/obsoletas, contas anteriores/novas incompatíveis, grupo incompleto/anulado e origem importada permanecem recusados para escrita neste fluxo. Metadados, descrições originais e classificações são preservados. Uma alocação acompanha a magnitude; rateio múltiplo exige revisão própria. Exclusão/restauração altera os dois membros, conserva o grupo estrutural ACTIVE e registra histórico. Intenção congelada mantém IDs/bases após resposta perdida; replay confirmado retorna conflito, sem rebase ou recibo novo.

## Interface e ciclo de vida

Movimentações oferece Cartões e pagamentos, Novo pagamento de cartão e acesso ao par completo. O detalhe de uma conta CREDIT_CARD oferece Ver cartão e pagamentos/Pagar cartão; Adicionar movimentação continua usando o fluxo manual com a conta selecionada. A visão de cartões mostra dívida ou crédito calculado, cobertura estimada, compras/créditos disponíveis e pagamentos. Não presume quitação ou inventa parcelas/juros futuros.

Todo pagamento aparece como “Pagamento de cartão sem detalhamento” enquanto este fluxo não possui conciliação de itens. A coexistência de compras com mesmo valor/data não autoriza associação automática. Importação, fatura/período e conciliação posterior permanecem nas histórias correspondentes. O núcleo e a tela não substituem essa homologação integrada de RF-08/FL-21/CT-06.

Estado financeiro é transitório e removido ao bloquear/trocar workspace; respostas anteriores são descartadas. Leituras recusam mais de 200 mil registros/32 MiB e comandos acima de 1 MiB são recusados antes da chave financeira. Não há truncamento, SQL/caminhos/chaves/ator arbitrários no IPC ou persistência financeira no navegador.

## Consequências e evidência

Reutiliza schema v2, proprietário SQLCipher, chave Windows, política de revisões e formato de backup existentes. Não há migration ou dependência de produção nova. Instrumentação/falhas injetadas são opcionais e ausentes do build padrão. Relatórios antigos preservam seus formatos; versões novas registram as 23 permissões, com aceitação histórica somente quando não se exige correspondência aos fontes atuais.

O [protocolo Desktop](../../development/desktop-card-payments.md) exige paridade, SQLCipher, compra e pagamentos em meses distintos, perda de resposta após commit, reabertura independente, interrupções antes/depois do commit e restauração em outra instalação após remover a chave de origem. CI configurada não significa execução remota observada. Cloud/outbox/feed/recibos, Web/Mobile, importação/conciliação, classificação, paginação e release assinado mantêm seus gates.
