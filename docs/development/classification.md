# US-045 — Associação compartilhada de classificação

Este incremento associa categoria/subcategoria/tags às transações com revisão-base e histórico, e fornece filtros puros sobre snapshots autorizados. Complementa os [catálogos](taxonomy.md). [ADR-0059](../architecture/adr/0059-associacao-versionada-de-classificacao.md). A integração Desktop e a apresentação dos filtros são o próximo incremento; nenhuma tela ou comando Tauri é acrescentado aqui.

## Uso do núcleo

Os subpaths domain/classification e finance-ports/classification expõem a política e createClassificationService. Componha o serviço com createSqliteRevisionService/createPostgresRevisionService, mantendo autorização confiável, identidade, origem de alteração e fechamento do coordenador. A leitura de categorias, subcategorias e tags acontece no módulo proprietário e dentro da mesma transação. Um adapter sem o port confiável taxonomyCatalog não pode classificar. O guard e suas funções não são payloads de cliente.

apply recebe request e uma lista de intenções; cada uma tem base (RevisionState completo), classification e tag_ids finais. As entradas são copiadas e congeladas antes da autorização assíncrona. Campos financeiros adicionais são recusados.

- KEEP preserva as alocações atuais, incluindo rateios; permite editar tags sem alterar parcelas.
- SET contém allocation_id, category_id e subcategory_id opcional representado por null. Para classificação única existente, conserva ID/nota; para a primeira classificação, exige UUIDv7. O valor é o módulo exato do valor da transação, sem ponto flutuante.
- CLEAR remove explicitamente a classificação única, conservando as tags solicitadas. SET/CLEAR em rateio exigem revisão pela US-046.

Novas referências devem estar ativas e no workspace. A subcategoria precisa pertencer à categoria escolhida, cujo pai permanece ativo. Classificação de entrada exige escopo INCOME/BOTH; gasto e estorno, EXPENSE/BOTH; demais naturezas, BOTH. Referências arquivadas já existentes podem ser mantidas ou removidas. Não se altera a natureza econômica: transferência e liquidação de dívida continuam fora do consumo, inclusive quando classificadas.

O coordenador compara versão e base real, preserva descrições/origem importadas e grava snapshots atômicos. Em grupos, envie ambos os membros e bases correntes; o usuário precisa de autorização nas duas contas. O membro sem alteração não recebe revisão artificial. Lote de até 256 transações e 4 Mi unidades UTF-16 de JSON é validado antes da primeira escrita.

Conserve a intenção após ACK perdido. A repetição com base antiga retorna VERSION_CONFLICT; recarregue e revise a decisão. Divergência detectada pelo guard produz CLASSIFICATION_BASE_CONFLICT; o coordenador também conserva suas recusas de revisão e origem. Um no-op com base corrente não cria auditoria. A reversão segue o protocolo de revisões existente, com proteção contra alterações posteriores e registro REVERSAL. Zero e mínimo i64 não comportam nova alocação positiva i64, mas permitem editar tags com KEEP.

## Filtros e autorização

filterClassifications recebe workspace_id, um snapshot de RevisionState e ClassificationFilter: category_id, subcategory_id, tag_ids, tag_match ANY/ALL e unclassified_only. IDs opcionais usam null. Lista de tags vazia não restringe resultados; sem classificação significa ausência de alocação monetária, independentemente de tags. Categoria e subcategoria devem coincidir na mesma parcela.

O helper exclui transações apagadas, deduplica IDs idênticos e recusa estados divergentes do mesmo ID. Retorna registros congelados por data/ID decrescente sem modificar valores. O snapshot admite 10 mil entradas; snapshot e consulta são limitados a 4 Mi unidades UTF-16 de JSON, com recusa explícita e sem truncamento. O helper filtra transações inteiras e não calcula subtotais por parcela; relatórios de orçamento precisarão somar as alocações relevantes.

O helper não realiza autorização nem busca dados. O host deve fornecer snapshot autorizado por workspace/contas, consistente e completo. Nunca filtre apenas uma página e apresente como resultado global. Integração de leitura/cobertura, paginação remota e UI continuam pendentes. A futura apresentação deve avisar que tags sobrepostas não são partes aditivas do orçamento.

## Reprodução e resultado

```powershell
pnpm build
node infra/classification/run.mjs
node --test infra/scripts/classification.test.mjs
pnpm check
```

O runner usa fixtures explicitamente sintéticas, PostgreSQL 18 com imagem fixada em Docker local e SQLite real. Execute sequencialmente aos demais protocolos de dados: compartilham 127.0.0.1:43221. O ambiente tem nome e credenciais próprios, armazenamento temporário e limpeza de containers, rede, bancos e segredos. O relatório fica em .tools/us045-classification/classification.json; node infra/classification/clean.mjs recupera somente recursos próprios inativos.

A [evidência](../quality/evidence/us-045-classification-core-2026-10-18.json) inclui regressões de revisões/catálogos, doze casos de associação por engine, comparação dos grafos, LOCAL sem identidade cloud, reabertura e limpeza. Relatórios contêm flags, versões, pendências e hashes, sem payload financeiro. Em falha, o diagnóstico local registra somente frames com caminhos/linhas, sem mensagem SQL, valores ou descrições.

Validação local concluída em 2026-10-18: pnpm check passou com 418 testes Node, zero falhas/skips, formatação, lint/fronteiras/geração, tipos e build; 19 workspaces e 132 Markdown. O protocolo próprio aprovou 108 gates reais em PostgreSQL/SQLite e os nove testes Node de classificação passaram. Regressões de repositories, revisões, invariantes, contas, movimentações, transferências, cartões e catálogos, além dos cinco fluxos Desktop afetados em Chromium/Windows, passaram novamente. Foram arquivadas 20 cápsulas novas ou renovadas; as 37 evidências atuais conferem com 416 hashes de fontes no Git staging. Recursos sintéticos próprios encerrados. Isso não representa execução de CI remota, integração Desktop desta funcionalidade ou homologação humana.

## Pendências preservadas

Sem migration, dependência de produção, mudança de backup ou publicação de endpoint. Escrita cloud de produto, outbox/feed, versão/auditoria dos metadados e recibos duráveis permanecem nos próprios gates. Próximo incremento: integrar associação, leitura autorizada e filtros ao Desktop com paridade Rust e testes reais. Homologações humanas permanecem após integração completa; DP-01 a DP-04 e sete originais intactos.
