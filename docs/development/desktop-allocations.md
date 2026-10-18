# US-046 — Editor de rateios no Desktop

Movimentações → Classificar movimentação → Editar rateio permite distribuir o módulo do valor por múltiplas categorias e subcategorias, com nota por parcela. A ação também fica no detalhe da consulta por classificação. Usa a [política compartilhada](allocations.md), o histórico e o cofre SQLCipher. [ADR-0064](../architecture/adr/0064-editor-de-rateios-no-desktop.md).

## Comportamento

Conservar parcelas atuais não cria revisão sem mudança. Editar parcelas permite adicionar, remover, recategorizar e revisar valores/notas; a soma deve coincidir exatamente com o total. A diferença aparece antes de salvar, e valores inválidos ou diferença não zero impedem a substituição. Remover todas as parcelas é uma escolha explícita. Não há ajuste, arredondamento ou distribuição automática.

As entradas usam valores positivos com até duas casas decimais e sem separador de milhares, por exemplo 12,50. Internamente, dinheiro continua i64 em centavos, com strings canônicas no JSON. Soma/diferença usam intermediários amplos; -9223372036854775808 pode ser dividido em 9223372036854775807 + 1. Zero permite conservar/remover, sem parcela fictícia.

IDs das parcelas existentes permanecem durante edição; novas linhas recebem UUIDv7 antes do despacho. Categorias/subcategorias novas devem estar ativas, no workspace, sob o pai correto e compatíveis com a natureza econômica. Referências arquivadas existentes podem permanecer no mesmo ID, inclusive ao editar valor/nota, ou ser removidas. Trocar ID/referência exige escolha ativa.

Valor, conta, data, descrições, origem importada, contraparte, grupo, natureza econômica e tags ficam iguais. Tags continuam sobre a movimentação inteira. Em transferências e pagamentos, o gateway inclui o parceiro KEEP com base atual; o nativo exige o grupo real completo e contas ativas. O parceiro inalterado não recebe auditoria artificial. O histórico existente mostra parcelas/notas antes/depois, resolvendo nomes pelo catálogo atual.

Após resposta perdida/inválida ou conflito, a intenção fica congelada. Repetir mesma tentativa conserva IDs/base/parcelas; commit anterior retorna conflito. Consultar resultado e revisar descarta a tentativa somente mediante essa ação explícita. Não há rebase silencioso. Bloqueio/troca de espaço removem a árvore, e resposta tardia não dispara leitura posterior.

## Persistência e reprodução

apply_local_allocation_change é o 29º comando específico de produção. O lote admite até 256 transações únicas, uma a mil parcelas em REPLACE, 4 Mi unidades UTF-16 e 4 MiB UTF-8. Excesso é recusado sem truncamento. LocalState verifica PIN antes da chave, bloqueio antes do commit e staging de restauração. O adapter reutiliza o planejador, a validação de grupos e o gravador de revisões financeiro em uma transação imediata.

```powershell
pnpm build
node infra/allocations-desktop/generate.mjs --check
node infra/allocations-desktop/browser.mjs
node infra/allocations-desktop/native.mjs
pnpm check
```

Os protocolos Cargo compartilham target; execute-os sequencialmente com CARGO_BUILD_JOBS=1. Chromium pode executar independentemente. Cenários explicitamente sintéticos usam diretórios/perfis/chaves próprios em .tools/us046-desktop-allocations. Os produtores encerram seus recursos e arquivam apenas flags, versões, pendências e hashes: [Chromium](../quality/evidence/us-046-desktop-allocations-browser-2026-10-18.json) e [Windows](../quality/evidence/us-046-desktop-allocations-windows-2026-10-18.json).

O corpus de 47 vetores compara comandos e planos do serviço compartilhado/gateway com Rust. Doze testes nativos cobrem SQLCipher, origem, notas/IDs, no-op, rollback, grupos, escopo, PIN, reabertura, i64 mínimo e colisão de IDs. Os protocolos exercitam interface real, ACK perdido, histórico, soma exata, descarte de resposta tardia, acessibilidade, reflow 320 px/200%, cores forçadas e ausência de persistência/egress. Processos independentes verificam interrupção em três fases e restauração em outra instalação sem a chave de origem, com escrita recusada durante staging preparado.

Validação local concluída em 2026-10-18: pnpm check aprovado com 463 testes Node, zero falhas/skips, formatação, lint, tipos e build; 19 workspaces e 142 Markdown. Os 12 testes Rust, 47 vetores compartilhados, dez gates Chromium e 17 Windows passaram. As regressões Desktop afetadas foram reexecutadas com os testes de evidência atualizados e passaram. Foram arquivadas 29 cápsulas novas ou renovadas; 46 evidências atuais conferem com 490 hashes de fontes no Git staging. Os 17 relatórios de dados/infraestrutura não afetados mantêm fontes atuais. Recursos sintéticos próprios encerrados. Sem execução de CI remota ou homologação humana.

## Estado

Política compartilhada e Desktop local integram o recorte de rateios da US-046. Próxima história: US-047, contrapartes normalizadas. Sem migration, dependência de produção, mudança de backup ou endpoint cloud novo. Web/Mobile, outbox/feed, recibos duráveis e reconciliação/descontos documentais permanecem nos próprios gates. Homologações humanas após integração completa; sete originais e DP-01 a DP-04 preservados.
