# US-045 — Consulta e filtros de classificação no Desktop

Atualização: o [editor versionado de classificação](desktop-classification.md) já está integrado ao detalhe das movimentações e desta consulta. O comando de escrita específico eleva o conjunto de produto a 28 permissões; a opção de leitura permanece igual. Os resultados abaixo preservam o recorte de consulta.

Movimentações → Filtrar por classificação consulta o catálogo e todas as transações do espaço local em um único snapshot SQLCipher. Inclui critérios de conta, datas, categoria/subcategoria, tags com qualquer/todas e ausência de classificação monetária. Referências arquivadas continuam disponíveis para consulta. [ADR-0061](../architecture/adr/0061-filtros-de-classificacao-no-desktop.md).

## Comportamento

Sem datas, a consulta abrange todos os períodos. Registros excluídos são omitidos. Categoria e subcategoria coincidem na mesma parcela; várias parcelas ou tags não repetem a transação. Sem classificação significa nenhuma alocação monetária, mesmo com tags. Os critérios de categoria/subcategoria são desativados ao selecionar essa opção.

Resultados mostram a transação inteira com valor exato i64, conta, data e natureza econômica. O detalhe identifica categorias, subcategorias, parcelas, notas e tags. Transferências e pagamentos continuam fora do consumo conforme sua natureza; a tela não calcula orçamento ou subtotais. Tags podem se sobrepor, por isso seus resultados não são parcelas aditivas.

A opção includeClassification do read_local_movements inclui o catálogo na mesma transação de leitura; as chamadas existentes sem a opção mantêm o formato anterior. Os 27 comandos de produto permanecem iguais. O gateway valida o formato completo, autorização por workspace, cobertura dos movimentos e referências do catálogo. Não há escrita financeira nesse fluxo. A edição sobre revisões será integrada no próximo incremento.

O snapshot de estados admite 10 mil entradas e 4 Mi unidades UTF-16 de JSON. Limites anteriores de histórico/movimentações e de catálogo também se aplicam. Em excesso, falha de integridade ou leitura incompleta, a consulta inteira é recusada. Atualizar remove os resultados antigos antes de ler e reinicia os critérios. Não existe truncamento ou total parcial apresentado como completo.

Troca de espaço e bloqueio descartam a árvore anterior. Leituras atrasadas não reabrem dados anteriores. A chave Windows permanece protegida pelo PIN conforme a configuração local. Não há cofre persistente no navegador nem persistência dos filtros em localStorage, sessionStorage ou IndexedDB.

## Reprodução

```powershell
pnpm build
node infra/classification-filters-desktop/browser.mjs
node infra/classification-filters-desktop/native.mjs
pnpm check
```

O protocolo nativo Windows usa o mesmo target dos demais; execute os protocolos Cargo sequencialmente, com CARGO_BUILD_JOBS=1. Chromium pode executar independentemente. Os cenários são explicitamente sintéticos. Relatórios ficam em .tools/us045-desktop-classification-filters, sem payload financeiro. O runner elimina somente seus próprios perfis, credenciais e arquivos.

Os relatórios arquivados são [Chromium](../quality/evidence/us-045-desktop-classification-filters-browser-2026-10-18.json) e [Windows](../quality/evidence/us-045-desktop-classification-filters-windows-2026-10-18.json). A verificação inclui seis testes Rust, filtros sobre rateios/tags sobrepostas, valores acima de 2^53, referências arquivadas, resposta incompleta/excessiva, isolamento, descarte de leitura tardia, PIN e leitura sem alteração de ciphertext/grafo/auditoria.

Validação local concluída em 2026-10-18: pnpm check passou com 433 testes Node, zero falhas/skips, formatação, lint/fronteiras/geração, tipos e build; 19 workspaces e 136 Markdown. A suíte própria aprovou seis testes Rust, oito gates Chromium e dez Windows. As regressões Desktop afetadas passaram novamente, com 25 cápsulas novas ou renovadas. As 41 evidências atuais conferem com 445 hashes de fontes no Git staging; os 16 relatórios de dados/infraestrutura não afetados tiveram suas fontes conferidas. Recursos sintéticos próprios encerrados. Isso não representa execução de CI remota, integração do editor financeiro ou homologação humana.

## Pendências preservadas

US-045 segue em andamento até integrar o editor de classificação sobre revisões no Desktop, incluindo membros completos de transferências e pagamentos. Rateio editável pertence à US-046. Paginação cloud autorizada, outbox/feed, versão/auditoria dos metadados, recibos duráveis e outras plataformas mantêm seus gates. Homologações humanas permanecem após integração completa, sem confirmação por incremento; DP-01 a DP-04 e sete originais preservados.
