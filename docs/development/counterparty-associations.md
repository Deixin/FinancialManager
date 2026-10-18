# US-047 — Associação versionada de contrapartes

Este incremento integra o [cadastro compartilhado](counterparties.md) ao gravador de revisões, conforme [ADR-0066](../architecture/adr/0066-associacao-versionada-de-contrapartes.md). A interface Desktop e a paridade Rust são o próximo incremento.

## Contrato

`@financial-manager/domain/counterparties` exporta captureCounterpartyAssociation, counterpartyAssociationChange e validateCounterpartyAssociationPlan. `@financial-manager/finance-ports/counterparties` exporta createCounterpartyAssociationService, composto sobre applyGuarded do serviço de revisões PostgreSQL/SQLite existente.

`apply(request, commands)` recebe workspace, principal cloud quando necessário e de 1 a 256 comandos únicos. Cada comando contém base completa e counterparty: KEEP, CLEAR ou SET com counterparty_id. A captura ocorre antes de qualquer await; payload acima de 4 Mi unidades UTF-16, campos extras, identidades inválidas, duplicação ou base de outro workspace são recusados. Movimentações excluídas exigem restauração antes de editar sua associação.

A operação altera somente counterparty_id. Descrição original e nome de exibição são preservados, assim como origem, data, conta, valores, natureza econômica, grupo, parcelas, notas e tags. Selecionar uma contraparte não cria ou renomeia registros e não ativa regras de importação. Uma contraparte pode ser reutilizada por várias movimentações do mesmo workspace.

Nova referência precisa estar ativa no workspace. Referência arquivada já existente pode ser mantida ou removida. SET do mesmo ID preservado é no-op; reintroduzir um ID arquivado depois de CLEAR é recusado. Referência ausente, estrangeira ou arquivada como nova escolha retorna COUNTERPARTY_REFERENCE_UNAVAILABLE. Nenhum nome ou identificador pessoal participa da validação de associação.

O adaptador fornece uma projeção confiável de somente id/workspace_id/status para os IDs finais escolhidos, dentro da mesma transação. O coordenador lê essa projeção uma vez por lote, valida seu formato e escopo e a captura de forma imutável. O cliente não fornece catálogo nem callback de validação. PostgreSQL usa RLS, papel restrito, lock por workspace e bloqueio das linhas; SQLite usa BEGIN IMMEDIATE e a fila da conexão exclusiva do serviço de revisão. Não compartilhar a mesma conexão SQLite entre instâncias concorrentes.

COUNTERPARTY_ASSOCIATION_BASE_CONFLICT indica base inteira divergente com a mesma versão; VERSION_CONFLICT indica versão antiga, incluindo replay de alteração já confirmada após resposta perdida. Consulte o estado e o histórico antes de construir uma nova intenção. No-op conserva versão/auditoria. Não há recibo durável de resposta nem rebase silencioso.

Transferências e pagamentos de cartão exigem ambos os membros atuais e autorização sobre suas contas, mesmo quando o parceiro usa KEEP. Parceiro inalterado não ganha revisão artificial. Uma falha desfaz todo o lote e sua auditoria. Associar uma contraparte não transforma transferência ou liquidação de dívida em consumo.

Reversão usa o serviço existente com base e revisão correntes, preserva a trilha e registra REVERSAL. Revisão posterior impede apagar uma personalização mais recente. Renomear ou arquivar o cadastro não reescreve o conteúdo nem as revisões das movimentações que o referenciam.

## Reprodução

```powershell
pnpm build
node infra/counterparty-associations/run.mjs
node --test infra/scripts/counterparty-associations.test.mjs
pnpm check
```

Execute com Docker local em funcionamento e sequencialmente aos outros protocolos de dados: todos usam 127.0.0.1:43221. O ambiente próprio usa PostgreSQL 18 com digest fixado, tmpfs e credenciais aleatórias. `node infra/counterparty-associations/clean.mjs` remove somente recursos próprios inativos. Bancos e credenciais em `.tools/us047-associations` são removidos ao encerrar; apenas a evidência sanitizada é versionada.

A [evidência](../quality/evidence/us-047-associations-core-2026-10-18.json) aprova 207 gates, incluindo 18 cenários por engine e regressões dos módulos financeiros anteriores. Há nove testes Node próprios. A validação cobre descrição recebida, nome ajustado, reutilização, escolhas arquivadas, consulta após autorização, captura antes de await, rollback da segunda revisão, grupos completos, resposta perdida, concorrência, reversão e valores i64 sem alteração. Projeções não expõem nomes ou identificadores pessoais.

Antes de renovar evidências, confira as referências completas e os sufixos concatenados nos testes consumidores. Esses arquivos também participam dos hashes das cápsulas. As evidências históricas permanecem preservadas; as atuais precisam corresponder às fontes usadas em cada execução.

Validação local concluída em 2026-10-18: pnpm check passou com 481 testes Node, zero falhas/skips, formatação, lint/fronteiras/geração, tipos e build; 19 workspaces e 146 Markdown. O protocolo próprio aprovou 207 gates PostgreSQL/SQLite, incluindo 18 cenários de associação por engine, e os nove testes Node próprios passaram. As 11 suítes de dados, nove Chromium e nove Windows afetadas passaram novamente. Foram arquivadas 30 cápsulas novas ou renovadas; 48 evidências atuais conferem com 516 hashes de fontes no Git staging. Os 18 relatórios não afetados mantêm fontes atuais. Recursos sintéticos próprios encerrados. Sem execução de CI remota ou homologação humana.

## Estado

Núcleo compartilhado da US-047 integra cadastro e associação versionada. Próximo incremento: integração Desktop e paridade Rust, com comandos específicos e tratamento de resposta incerta. Não há tela, comando Tauri, migration, dependência de produção ou alteração de backup neste recorte. Web/Mobile, regras de importação, auditoria monotônica dos catálogos, recibos duráveis e feed/outbox seguem seus gates. Homologações humanas após integração completa; sete originais e DP-01 a DP-04 preservados. Consulte o resultado integrado no [estado do projeto](../delivery/status.md).
