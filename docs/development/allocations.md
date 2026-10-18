# US-046 — Rateios versionados compartilhados

Esta base permite criar, editar, substituir e remover parcelas de classificação por múltiplas categorias, preservando saldo, origem e tags. Complementa a [classificação](classification.md) e reutiliza as [revisões financeiras](financial-revisions.md). O editor Desktop é o próximo incremento. [ADR-0063](../architecture/adr/0063-rateios-versionados-compartilhados.md).

## API e invariantes

Domain/classification expõe captureAllocation, allocationChange, validateAllocationPlan e seus tipos/erros. Finance-ports/classification expõe createAllocationService. Componha-o com o coordenador PostgreSQL ou SQLite existente, sua autorização confiável e identidade. O adapter deve fornecer taxonomyCatalog na mesma transação; ausência é CONFIGURATION_INVALID. Nenhum desses guards ou ports é payload de cliente.

apply recebe request e lista de AllocationCommand. Cada comando contém base completa e allocation:

- KEEP conserva as parcelas atuais e serve também ao parceiro de uma operação agrupada.
- CLEAR remove explicitamente todas as parcelas; tags permanecem.
- REPLACE contém allocations com o conjunto final de uma a mil parcelas. Cada linha possui id, category_id, subcategory_id ou null, amount_minor positivo i64 canônico e note ou null. Lista vazia é recusada; use CLEAR conscientemente.

A soma deve igualar exatamente o módulo de account_amount_minor. Diferença produz ALLOCATION_TOTAL_MISMATCH. Não há float, arredondamento, ajuste implícito ou preenchimento automático. Intermediários BigInt permitem dividir -9223372036854775808 em 9223372036854775807 + 1, ambos positivos e válidos. Zero não admite parcela positiva; KEEP/CLEAR continuam possíveis.

IDs de parcelas existentes podem ser conservados ao revisar valor/nota ou classificação. Novos IDs exigem UUIDv7. Duplicatas são recusadas; colisão com outra transação desfaz a operação inteira. Ordenar visualmente as mesmas parcelas não gera revisão artificial: o núcleo normaliza por ID. Lotes de até 256 transações únicas e 4 Mi unidades UTF-16 de JSON são capturados antes da autorização assíncrona, sem truncamento.

O comando altera apenas allocations. Valor, conta, data, contraparte, grupo, tags, descrição original/ajustada, origem importada e natureza econômica permanecem iguais. Excluídas devem ser restauradas antes. Grupos exigem ambos os membros atuais, contas válidas e autorização completa; o parceiro KEEP não ganha revisão artificial. Transferência e liquidação de dívida continuam fora do consumo.

Novas referências devem estar ativas no workspace, com subcategoria do pai correto e escopo INCOME/BOTH para entradas, EXPENSE/BOTH para gastos/estornos e BOTH para demais naturezas. Associação arquivada já existente pode permanecer no mesmo ID ou ser removida. Referência/ID novo exige escolha ativa. Alterar apenas valor/nota de associação arquivada preservada é permitido. Tags não são redistribuídas entre parcelas.

ALLOCATION_BASE_CONFLICT indica divergência da base inteira. VERSION_CONFLICT inclui repetição de uma alteração já confirmada após resposta perdida. Preserve intenção/IDs/base e consulte o resultado antes de revisar; não reconstrua uma tentativa silenciosamente. No-op conserva versão/histórico. Reversão usa o serviço existente com base atual e registra REVERSAL; edição posterior impede desfazimento destrutivo.

## Reprodução

```powershell
pnpm build
node infra/allocations/run.mjs
node --test infra/scripts/allocations.test.mjs
pnpm check
```

O runner usa Docker local isolado com PostgreSQL 18 e SQLite real. Execute sequencialmente aos demais protocolos de dados: compartilham 127.0.0.1:43221. A imagem possui digest fixado; credenciais aleatórias, banco temporário, container e rede são próprios. node infra/allocations/clean.mjs recupera somente recursos próprios inativos. Artefatos locais ficam em .tools/us046-allocations; segredos e bancos são removidos ao encerrar.

A [evidência sanitizada](../quality/evidence/us-046-allocations-core-2026-10-18.json) aprova 142 gates, incluindo 16 cenários por engine, regressões de revisões/catálogos/classificação, comparação entre bancos, reabertura e ator LOCAL sem identidade cloud. Os testes verificam erro de um centavo, i64 mínimo, parcelas acima de 2^53, metadados cruzados/arquivados, origem importada, pares de transferência/pagamento, falha da segunda revisão, disputa de versões, captura antes de await, colisão de IDs e reversão protegida. Não arquivam payload financeiro.

Validação local concluída em 2026-10-18: pnpm check aprovado com 453 testes Node, zero falhas/skips, formatação, lint, tipos e build; 19 workspaces e 140 Markdown. Os dez testes próprios e 142 gates reais passaram. As regressões afetadas de classificação compartilhada e filtros/editor Desktop em Chromium/Windows foram reexecutadas e passaram. Seis cápsulas novas ou renovadas compõem 44 evidências atuais; seus 473 hashes de fontes foram conferidos contra o Git staging. Os 38 relatórios não afetados mantêm fontes atuais. Recursos sintéticos próprios encerrados. Sem execução de CI remota ou homologação humana.

## Estado

US-046 em andamento: política e persistência compartilhadas integradas; próximo incremento integra editor Desktop e paridade Rust. Nenhuma tela ou permissão Tauri nova neste recorte. Não há migration, dependência de produção ou mudança de backup. Integrações Web/Mobile, outbox/feed, recibos duráveis, reconciliação de itens e descontos de documentos permanecem nas próprias histórias. Homologações humanas após integração completa; sete originais e DP-01 a DP-04 preservados.
