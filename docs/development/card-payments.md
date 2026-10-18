# Cartão simplificado — núcleo compartilhado US-043

Integração Desktop disponível em [Cartões e pagamentos](desktop-card-payments.md). As seções abaixo preservam o recorte e a evidência do incremento compartilhado, anterior à integração local.

O núcleo cria, edita, exclui logicamente e restaura pagamentos entre uma conta ASSET e um CREDIT_CARD/LIABILITY. A compra aumenta a dívida exibida e representa consumo; pagamento reduz banco e dívida em uma transação e usa DEBT_SETTLEMENT, sem nova despesa. Desktop e conciliação de extratos/faturas permanecem pendentes. Consulte o [ADR-0054](../architecture/adr/0054-pagamentos-de-cartao-compartilhados.md).

## Contrato e persistência

`@financial-manager/domain/card-payments` expõe captura, mudanças e validação dos planos. `@financial-manager/finance-ports/card-payments` compõe os adapters existentes. CREATE recebe três UUIDv7 distintos, descritores de origem/cartão, data, magnitude positiva i64 em string decimal canônica, nome e descrição original opcional explícita. Gera grupo CARD_PAYMENT/ACTIVE e duas variações negativas iguais, com duas revisões MANUAL. Ator, revisão e instante são fornecidos pelo host.

EDIT/DELETE/RESTORE recebem bases completas dos dois membros. Autorização, escopo de ambas as contas, versões, estado/origem, grupo e contas atuais são verificados sob a mesma transação. Bases obsoletas/forjadas, contas arquivadas ou com natureza alterada e edição isolada são recusadas. Nome/data podem mudar; originais/tags/contraparte/classificações são preservados. Rateio múltiplo não é redimensionado silenciosamente. Grupo estrutural continua ACTIVE com ambos os membros tombstonados após exclusão.

Repetição de CREATE confirmado retorna conflito; erro de transporte não autoriza criar IDs novos ou rebase automático. O host deve preservar a intenção para consultar/repetir a mesma tentativa. Não há recibo durável novo. applyComposite permanece uma composição de host confiável, sem acesso SQL ou callback de usuário.

Pagamentos parciais e crédito por pagamento excedente são representáveis. Sem itens, registra somente liquidação, sem categorias inventadas; a futura apresentação identifica o pagamento sem detalhamento. Não calcula juros, próximas parcelas, fechamento ou vencimento. Vínculo com itens importados e períodos depende do staging/conciliação posterior.

## Reprodução

```sh
pnpm install --frozen-lockfile
pnpm build
node infra/card-payments/run.mjs
pnpm check
```

Docker local executa PostgreSQL em tmpfs, credenciais aleatórias e publicação apenas em 127.0.0.1:43221. Não execute junto a outro protocolo que reserve essa porta. SQLite usa arquivo sintético próprio em .tools/us043-card-payments. Remove containers/rede/credenciais/banco próprios e compara FIN-002 com seu oráculo original. Recuperação exige ausência de execução ativa e usa `node infra/card-payments/clean.mjs`, com validação de proprietário e Docker local. Não acessa dados pessoais ou o cofre do usuário.

Há 16 cenários de pagamento por engine, mais gates de revisão e verificações transversais. Cobrem par/histórico, edição, exclusão/restauração, ACK perdido, bases forjadas, metadados incompatíveis, contas arquivadas/alteradas, classificação/rateio, rollback na segunda revisão, escopo, close, captura antes da autorização, concorrência e limites i64. Compra de 12000 em setembro, pagamentos de 5000/8000 em outubro e estorno de 2000 em novembro verificam consumo, caixa, crédito de -1000 antes do estorno e preservação da compra original. Nenhuma parcela futura é gerada.

Evidência fechada: [PostgreSQL/SQLite](../quality/evidence/us-043-card-payment-core-2026-10-18.json), somente após execução aprovada e limpeza. Fontes, versões, gates e pendências são verificados estritamente; relatórios históricos permanecem preservados. CI dedicada permite reproduzir o protocolo, sem declarar execução remota observada.

Resultado local em 2026-10-18: pnpm check aprovado com 371 testes Node, zero falhas/skips, formatação, lint, tipos e build. Os 62 gates do protocolo passaram com recursos próprios encerrados. Regressões compartilhadas e Desktop Chromium/Windows afetadas foram reexecutadas; 13 cápsulas novas compõem 30 evidências atuais com hashes das fontes. A execução não representa homologação humana ou CI remota.

Próximo incremento: integrar a US-043 ao Desktop, com comandos específicos, telas de cartão/pagamento, paridade e validação SQLCipher/WebView2. Não houve schema, dependência de produção ou mudança de backup. CT-06 de produto, importação/conciliação completa, Web/Mobile/cloud e homologações humanas mantêm seus gates. Sete originais e DP-01 a DP-04 permanecem intactos.
