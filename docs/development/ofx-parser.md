# US-052 — Núcleo compartilhado OFX normalizado

Contrato: [ADR-0074](../architecture/adr/0074-parser-ofx-normalizado-compartilhado.md), RF-10/11 e [barreira US-051](import-file-validation.md).

`await parseOfx(request, destination, signal?)` recebe os mesmos metadados/bytes de `validateImportFile` e um destino fechado: `workspace_id`, `account_id`, `balance_nature` (`ASSET`/`LIABILITY`) e `currency` (`BRL`). O destino precisa ser autorizado e validado pelo chamador; a biblioteca pura não consulta membros, contas ou bancos. Não aceite um resultado do cliente como autorização para persistir ou confirmar lançamentos.

O parser valida um snapshot de até 16 MiB, interpreta um extrato bancário/cartão no subconjunto OFX 1.02 SGML ou XML 2.03/2.20/2.30, calcula SHA-256 sobre os mesmos bytes e devolve `OfxResult` congelado. `source` contém leitor `fm-ofx/1.0.0`, nome, hash, layout, BRL, período em DATE e fingerprint da conta de origem. O fingerprint inclui tipo, banco, agência e conta; é metadado privado, não anonimização. Números de conta não aparecem em claro no resultado.

`items` é um modelo intermediário para staging, sem UUID de entidade ou efeitos financeiros. Cada item contém ordinal, FITID quando disponível, data, valor i64 como string decimal canônica, descrição original, nome proposto, disposição NEW/INVALID, erros, avisos e proveniência. A proveniência aponta para o hash/leitor/versão e caminhos estruturais como `/OFX/BANKMSGSRSV1/STMTTRNRS/STMTRS/BANKTRANLIST/STMTTRN[1]/TRNAMT`.

| Situação                                                      | Comportamento                                                                                                                       |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Banco: fluxo OFX `-123.45`                                    | ASSET recebe `-12345`; sem arredondamento ou ponto flutuante.                                                                       |
| Cartão: compra `-25.90`, crédito/pagamento `10`               | LIABILITY recebe `2590` e `-1000`; aumenta/reduz dívida conforme a convenção do produto.                                            |
| Timestamp com fuso                                            | Valida os componentes e preserva o dia escrito, sem conversão da data financeira para UTC. O período informado é tratado como DATE. |
| FITID ausente/repetido                                        | Mantém os itens com avisos; não deduplica automaticamente.                                                                          |
| Data, valor, descrição ou tipo inválidos                      | Retém a linha com INVALID e códigos fixos; campos não interpretáveis ficam nulos.                                                   |
| Correção OFX                                                  | INVALID até revisão explícita; não altera movimento anterior.                                                                       |
| XFER/PAYMENT                                                  | Aviso de revisão; não transforma transferência ou liquidação em consumo.                                                            |
| Entidades XML                                                 | Decodificação única das referências fixas/números já validados; não executa conteúdo.                                               |
| Campo repetido, filho desconhecido, múltiplas contas/extratos | Falha estrutural integral; não escolhe primeiro/último campo silenciosamente.                                                       |
| Cancelamento/prazo, inclusive depois de hashing               | Erro seguro, sem retorno parcial, escrita ou retenção de arquivo.                                                                   |

São aceitas datas de oito dígitos ou timestamps completos. Horários truncados, agrupadores/decimal não OFX, valores com mais de duas casas e tipos bancários fora de CHECKING/SAVINGS/MONEYMRKT são recusados ou marcados inválidos. Moeda ou natureza de conta incompatíveis falham no arquivo inteiro. Saldos observados não se tornam referências de saldo automaticamente. Não executar a normalização longa na thread de UI; cada integração de runtime deve manter worker/host e cancelamento próprios.

## Verificação reproduzível

O item também retém `source_transaction_type` (enum OFX conhecido ou nulo) e seu caminho `provenance.fields.type`. Use esse dado como indício na revisão de transferências/pagamentos, junto aos erros e avisos, sem inferir automaticamente a natureza econômica. Hashing usa os bytes originais do snapshot, inclusive BOM e Windows-1252; subviews são limitadas ao intervalo recebido.

```text
pnpm --filter @financial-manager/importers build
node --test infra/scripts/ofx-parser.test.mjs
node infra/validation/cli.mjs plan
node infra/validation/cli.mjs run
```

O scope compartilhado `us051-defensive-files` conserva seus dez gates anteriores e acrescenta três gates da US-052, com fixtures FIN-002 sintéticas, i64 nos limites, sinais de cartão, datas/fusos, entidades, campos ambíguos, cancelamento, capturas antes do await, erros sem conteúdo e benchmark de dez mil registros. O produtor compara integralmente os resultados Node/Chromium, usa sax e SHA-256 Node como oráculos e mantém heap Node de 128 MiB, RSS até 256 MiB e prazo externo de 35 segundos. Relatórios são arquivados somente pelo runner; não renove evidências manualmente.

A [adaptação Desktop/Rust da normalização](desktop-ofx.md) está integrada com prévia privada paginada e paridade completa. Persistência/revisão de staging, regras, deduplicação e confirmação permanecem pendentes. A US-051 de seleção/leitura/inspeção nativa continua integrada e seus testes permanecem ativos. Os resultados abaixo preservam a execução do núcleo compartilhado; a integração Desktop possui evidência própria. Não há mudança de schema, dependências de produção, permissões, backup/restauração ou regras de confirmação. Fixtures reais e homologação humana seguem o ADR-0044.

Resultado local em 2026-10-25: `pnpm check` aprovado com 533 testes e 54 protocolos atuais, sem falhas ou skips. O [relatório imutável](../quality/evidence/runs/e94df2458ba0f2b2a6b9dea1da7637db5d18ad615aaca15521b65a3fd345ebd3.json), formato 2, aprova 97 casos defensivos e 70 casos OFX em Node/Chromium; registra 170.516.480 bytes de RSS de pico Node e 23.336.256 bytes de heap observado no Chromium. O corpus OFX completo, incluindo benchmark, levou 662,9 ms no subprocesso Node deste ambiente; não representa tempo de prévia integrada ou SLA. O runner reexecutou os três protocolos afetados na rodada final, reutilizou 51 e concluiu `pnpm check`. O teste de preservação de TRNTYPE falhou antes da correção e passou depois. Relatórios anteriores e os sete documentos originais foram preservados.
