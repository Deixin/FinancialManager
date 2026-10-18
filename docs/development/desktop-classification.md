# US-045 — Classificação versionada no Desktop

Movimentações → detalhe → Classificar movimentação permite editar categoria, subcategoria e tags. A opção também fica no detalhe da consulta Filtrar por classificação. O editor usa a base completa e o histórico do SQLCipher. Complementa os [catálogos](desktop-taxonomy.md), a [consulta](desktop-classification-filters.md) e a [política compartilhada](classification.md). [ADR-0062](../architecture/adr/0062-editor-versionado-de-classificacao-no-desktop.md).

## Comportamento

Conservar classificação mantém todas as parcelas. Escolher classificação única usa o valor absoluto exato da movimentação e conserva ID/nota da parcela existente; uma primeira classificação recebe UUIDv7. Remover classificação exige escolha explícita e conserva as tags selecionadas. Em rateios, somente tags são editáveis neste incremento; as parcelas permanecem intactas para o editor US-046.

Escolhas novas exigem referências ativas, pai correto e categoria compatível: entrada usa INCOME/BOTH, gasto/estorno usa EXPENSE/BOTH, outras naturezas usam BOTH. Referências arquivadas já associadas podem permanecer ou ser removidas. O nome exibido respeita o tipo da referência, inclusive quando IDs de tabelas diferentes coincidem. Tags podem se sobrepor e não são parcelas aditivas de orçamento.

Valores, conta, data, grupo, contraparte, natureza econômica, descrição original e origem permanecem iguais. É possível classificar dados importados sem transformá-los em lançamento manual. A revisão da edição registra MANUAL com ator local; o histórico original continua imutável. Classificar transferência ou pagamento não os transforma em consumo. Transações excluídas precisam ser restauradas antes de classificar.

Em operações agrupadas, o editor envia os dois membros e bases correntes. O parceiro permanece com sua classificação e tags; somente registros efetivamente alterados recebem nova revisão. O servidor verifica grupo ativo, composição real e contas/sinais. Grupos exigem contas ativas; registros sem grupo podem receber classificação em conta arquivada conforme a política compartilhada. Salvar sem mudanças com base corrente conserva a versão e não cria auditoria.

Depois de uma resposta perdida ou inválida, o formulário conserva intenção, IDs e base e bloqueia alterações. Repetir usa a mesma tentativa; commit anterior produz conflito de versão. Consultar resultado e revisar carrega a situação atual e descarta a tentativa para revisão explícita. Não há reconstrução silenciosa de IDs nem rebase automático. Uma resposta atrasada de uma tela fechada não dispara leitura posterior. Bloqueio e troca de espaço descartam a árvore financeira.

O gateway confere ACKs e a leitura posterior, incluindo snapshots antes/depois. O histórico exibe referências resolvidas pelo catálogo atual; nomes dos metadados não possuem versões próprias neste incremento. Formatos legados incompatíveis permanecem identificados e preservados. O editor é carregado sob demanda; não há dados financeiros persistentes em localStorage, sessionStorage ou IndexedDB.

## Persistência e limites

O comando específico apply_local_classification_change eleva a capability de produção a 28 comandos. Não aceita SQL, ator ou alterações financeiras adicionais. LocalState verifica PIN antes da chave, bloqueio antes do commit e restauração preparada. O adapter lê metadados pelo módulo proprietário, planeja o lote inteiro e reutiliza o gravador de revisões numa transação imediata. As funções de revisão de transferências/pagamentos foram deduplicadas e reutilizadas pela classificação.

Lotes admitem 1–256 transações únicas, até 4 Mi unidades UTF-16 de JSON e 4 MiB UTF-8 no IPC. Sem truncamento. Zero e mínimo i64 não admitem nova alocação positiva única, mas permitem KEEP para editar tags. A consulta conserva os limites documentados no [guia de filtros](desktop-classification-filters.md).

## Reprodução

```powershell
pnpm build
node infra/classification-desktop/generate.mjs --check
node infra/classification-desktop/browser.mjs
node infra/classification-desktop/native.mjs
pnpm check
```

Os protocolos Cargo compartilham target; execute-os sequencialmente com CARGO_BUILD_JOBS=1. Chromium pode executar independentemente. Os cenários são explicitamente sintéticos. Dados e perfis temporários ficam em .tools/us045-desktop-classification e são removidos com as credenciais próprias. Relatórios arquivam apenas flags, versões, pendências e hashes: [Chromium](../quality/evidence/us-045-desktop-classification-browser-2026-10-18.json) e [Windows](../quality/evidence/us-045-desktop-classification-windows-2026-10-18.json).

A suíte própria compara 58 vetores compartilhados, testa o comportamento SQLCipher, ACK perdido, histórico, concorrência, preservação de origem, tags em rateios e grupos. Chromium cobre acessibilidade/teclado, reflow 320 px/200%, cores forçadas e descarte de respostas tardias. Processos independentes exercitam rollback e interrupção nas três fases, reabertura e restauração em outra instalação com chave de origem excluída e escrita recusada durante staging preparado.

Validação local concluída em 2026-10-18: pnpm check aprovado com 443 testes Node, zero falhas/skips, formatação, lint, tipos e build; 19 workspaces e 138 Markdown. Os dez testes Rust, 58 vetores compartilhados, dez gates Chromium e 17 Windows passaram. As regressões Desktop afetadas foram reexecutadas e passaram; 27 cápsulas novas ou renovadas compõem, com os 16 relatórios de dados/infraestrutura não afetados, 43 evidências atuais. Seus 462 hashes de fontes foram conferidos contra o Git staging. Recursos sintéticos próprios encerrados. Sem execução de CI remota ou homologação humana.

## Estado e pendências

Este recorte integra associação e filtros da US-045 ao Desktop local. Sem migration, dependência nova, formato de backup alterado ou publicação de endpoint cloud. Próximo incremento: editor de rateios US-046. Outbox/feed, integração Web/Mobile, paginação cloud autorizada, auditoria/versionamento de metadados, recibos duráveis e release assinado permanecem nos próprios gates. Homologações humanas seguem após integrar o sistema; sete originais e DP-01 a DP-04 preservados.
