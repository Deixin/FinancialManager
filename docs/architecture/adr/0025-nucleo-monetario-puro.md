# ADR-0025 — Núcleo monetário puro

- Data: 2026-10-16
- Status: Adotado na implementação da US-013; integrações de produto pendentes
- Histórias: US-013; subsidia US-012, US-020 a US-027 e US-040 a US-043
- Substitui: nenhum; implementa RF-05–08 e a convenção de sinais do modelo original

## Contexto

A [US-013](../../delivery/05-backlog.md) exige MoneyMinor e regras financeiras independentes de UI e persistência, sem ponto flutuante monetário. Os spikes têm codecs experimentais próprios; não constituem o domínio compartilhado de produto. Os gates físicos do [ADR-0024](0024-consolidacao-fisica-e-gates.md) continuam necessários antes da persistência dual-engine.

## Alternativas

- Number: não representa todos os inteiros i64 exigidos pelo contrato.
- BigInt como valor público: preserva precisão, mas exige transformação explícita para JSON.
- Biblioteca decimal: útil para DECIMAL_EXACT, mas desnecessária para somas e subtrações de unidades mínimas inteiras deste recorte.
- String decimal canônica com marca TypeScript e BigInt interno: preserva a representação JSON e permite validar o intervalo antes de entrar no núcleo.

## Decisão

MoneyMinor é uma string validada, com marca de tipo, entre -9223372036854775808 e 9223372036854775807. Não aceita Number, sinal positivo, zero negativo, zeros à esquerda, notação exponencial, separadores ou espaços. A representação JSON já é textual. Cálculos usam BigInt; cada resultado monetário retornado deve caber em i64. Agregações permitem intermediários mais largos para não depender da ordem das linhas. Overflow gera código estável, sem arredondamento ou saturação. O módulo não interpreta valores decimais de UI, calcula câmbio ou implementa DECIMAL_EXACT.

O pacote domain não tem dependências de produção, I/O, relógio atual, geração de IDs ou acesso a autenticação. IDs opacos não vazios e datas financeiras são fornecidos pelo chamador. A geração/validação física UUID permanece no gate G07-IDS/US-023. Datas YYYY-MM-DD são validadas como dias de calendário, com comparação inclusiva e sem fuso local.

As regras operam em BRL, rejeitando moeda incompatível. ASSET e LIABILITY preservam o sinal do saldo exibido: compra aumenta dívida; pagamento reduz banco e dívida. Consolidação retorna ativos, passivos e patrimônio líquido separadamente. A camada de aplicação deve fornecer apenas contas autorizadas; as verificações de workspace/conta do núcleo são invariantes adicionais, sem substituir policy engine ou RLS.

Saldo usa uma referência ACTIVE com início/fim do dia e somente movimentos confirmados posteriores a ela, até a data solicitada. Linhas anteriores não são contadas novamente. Ausência de referência ou histórico incompleto/desconhecido produz resultado INCOMPLETE com motivos explícitos; cobertura não é inferida da ausência de linhas.

Movement é uma projeção mínima de cálculo. Seu posting_state é derivado pelo adaptador de staging, confirmação e tombstone; não acrescenta coluna ou estado ao ERD. Linhas brutas inválidas permanecem no import_item, fora dessa projeção. PlannedMovement não tem posting_state: planejar uma operação não a confirma.

Transferências entre contas ASSET e pagamentos ASSET → cartão LIABILITY geram planos imutáveis com grupo e duas movimentações. O validador rejeita falta de perna, IDs repetidos, escopos cruzados, conta arquivada, grupo/data divergente ou sinais/montantes incompatíveis. Ordem das pernas é origem, destino. A aplicação deve persistir grupo, pernas, revisões e outbox na mesma transação; o plano puro sozinho não entrega atomicidade de banco.

Relatórios distinguem INCOME, EXPENSE e EXPENSE_REVERSAL de TRANSFER, DEBT_SETTLEMENT, ADJUSTMENT e OTHER. Não inferem classificação econômica pelo sinal. Estorno pertence à própria data financeira; pagamento de cartão movimenta caixa sem novo consumo. Fluxos brutos de caixa consideram movimentos ASSET, incluindo transferências; transferências internas completas têm efeito líquido zero. São somas das contas fornecidas, sem reconstrução de detalhes ausentes, DRE, deduplicação ou conciliação de importações.

## Consequências

Clientes devem construir MoneyMinor pela função validante; entradas HTTP/IPC ainda exigem contratos e validação estrutural próprios na US-012. A marca TypeScript não substitui validação em runtime nem impede concatenação textual indevida fora das operações do pacote. Erros do núcleo contêm apenas códigos, sem payload financeiro.

Resultados agregados positivos também respeitam i64. Por exemplo, o módulo aceita uma movimentação de -9223372036854775808, mas rejeita um total positivo absoluto de 9223372036854775808 que não cabe no contrato. Rateios podem validar esse mínimo como duas parcelas positivas válidas cuja soma interna é mais larga.

Não há nova dependência externa ou migração de schema. A única nova dependência entre workspaces é test-fixtures → domain, para validar e tipar fixtures sintéticas; nenhum app recebe fixtures como dependência de produção. O build precede os testes da API pública compilada, e typecheck passa a construir dependências antes de resolver seus exports. Testes de tipos ficam fora do build distribuído.

## Validação e aprovação

35 testes comportamentais novos cobrem precisão acima de 2^53, limites/overflow i64, JSON, rateios, referência, histórico incompleto, escopo, cartões, transferências, períodos, estornos e imutabilidade. A fixture FIN-001 possui totais mensais escritos independentemente das funções. Testes de tipos rejeitam MoneyMinor numérico, string não validada e mutação de plano.

O protocolo e os comandos estão em [núcleo de domínio](../../development/domain-core.md). A execução técnica local está registrada no [estado](../../delivery/status.md); não representa homologação dos runtimes Web/Desktop/Mobile ou aprovação dos gates físicos. DP-01 a DP-04 permanecem abertas nos respectivos escopos.
