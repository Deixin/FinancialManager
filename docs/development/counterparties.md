# US-047 — Cadastro compartilhado de contrapartes

Este incremento implementa o catálogo compartilhado por workspace da US-047, conforme [ADR-0065](../architecture/adr/0065-catalogo-compartilhado-de-contrapartes.md). A associação versionada às movimentações é o próximo incremento; a interface Desktop vem em seguida.

## Contrato

`@financial-manager/domain/counterparties` contém captura, planejamento e filtros puros. `@financial-manager/finance-ports/counterparties` oferece `createCounterpartyService`; os subpaths `counterparties` de `storage-schema` e `persistence-postgres` oferecem os adaptadores reais.

Os métodos `list(request, query?)` e `apply(request, command)` recebem workspace e principal cloud quando necessário. Desktop LOCAL pode operar sem principal. A autorização de leitura e gestão é conferida antes do acesso ao banco; a autoridade deve coincidir com o workspace armazenado. Não há rota HTTP/IPC nova neste incremento.

Campos obrigatórios no JSON, com opcionais expressos como null: id, workspace_id, display_name, identifier_type, identifier_value, relationship_hint e status. O nome tem até 120 unidades UTF-16, sem espaços nas extremidades ou controles. Identificador usa par tipo/valor: CPF com 11 dígitos, CNPJ com 14, OTHER com texto até 120; zeros iniciais são preservados. O formato não comprova validade do identificador. Relacionamento é CUSTOMER, SUPPLIER, OTHER ou null. Não há classificação separada pessoa/empresa no schema atual nem coleta de endereço ou folha.

Comandos CREATE e UPDATE são capturados antes de qualquer await. CREATE exige ID UUIDv7 novo e estado ACTIVE; o replay exato por ID não escreve. UPDATE exige base completa, mesmo ID/workspace e conteúdo atual. Base divergente retorna COUNTERPARTY_BASE_CONFLICT; registro ausente retorna COUNTERPARTY_NOT_FOUND. No-op não escreve. Arquivar e reativar são UPDATEs explícitos; nenhuma operação apaga registros usados. A base é comparação de conteúdo, sem versão monotônica ou proteção contra ciclo que volte ao mesmo conteúdo, conforme os catálogos anteriores.

Homônimos e identificadores iguais podem pertencer a IDs diferentes. O serviço não funde nem associa registros por heurística. A reutilização exige seleção explícita do mesmo ID. A busca ignora caixa/acentos, mas preserva a grafia armazenada. Query exige status ALL/ACTIVE/ARCHIVED, relationship_hint ALL/CUSTOMER/SUPPLIER/OTHER/null e search até 120 unidades; null filtra os registros sem relacionamento. Resultado é determinístico por ID. Catálogo acima de 10.000 itens ou 4 Mi unidades UTF-16 do JSON é recusado, sem paginação silenciosa.

O dono de dados counterparties só acessa `counterparty`. Nenhuma escrita altera descrições originais/ajustadas, valores, saldos, classificações, revisões ou grupos. Referências financeiras existentes permanecem válidas após renomear/arquivar. Regras de importação e aplicação retroativa mantêm seus próprios fluxos de prévia e confirmação.

SQLite usa conexão exclusiva para este serviço e fila por instância; não criar instâncias concorrentes sobre a mesma conexão. PostgreSQL usa transação com RLS, papel de aplicação restrito e lock por workspace. Ambos verificam o catálogo e planejam antes de salvar. Falhas são códigos sanitizados, sem nomes, identificadores ou conteúdo financeiro.

## Reprodução

```powershell
pnpm build
node infra/counterparties/run.mjs
node --test infra/scripts/counterparties.test.mjs
pnpm check
```

O Docker precisa estar em execução. O ambiente é local isolado, com PostgreSQL 18 de digest fixado, tmpfs, credenciais aleatórias e porta 127.0.0.1:43221. Execute sequencialmente aos outros protocolos de dados que usam essa porta. `node infra/counterparties/clean.mjs` remove somente recursos próprios inativos. `.tools/us047-counterparties` é ignorado; banco e credenciais são descartados ao encerrar.

A [evidência sanitizada](../quality/evidence/us-047-counterparties-core-2026-10-18.json) contém 82 gates, incluindo 12 cenários por engine e regressões de categorias/revisões. Os testes verificam replay e colisão, homônimos, identificadores opcionais, busca, arquivo/reativação, bases divergentes, autorização, captura antes de await, disputa de edição, rollback após escrita, preservação de histórico e fechamento com trabalho pendente. Há nove testes Node próprios, incluindo limites, fronteiras, falha de rollback e validação estrita da evidência.

Validação local concluída em 2026-10-18: pnpm check passou com 472 testes Node, zero falhas/skips, formatação, lint/fronteiras/geração, tipos e build; 19 workspaces e 144 Markdown. O protocolo próprio aprovou 82 gates PostgreSQL/SQLite, com 12 cenários por engine, e nove testes Node próprios. As 11 suítes de dados, nove Chromium e nove Windows afetadas passaram novamente. Foram arquivadas 30 cápsulas novas ou renovadas; 47 evidências atuais conferem com 505 hashes de fontes no Git staging. Os 17 relatórios não afetados mantêm fontes atuais. Recursos sintéticos próprios encerrados. Sem execução de CI remota ou homologação humana.

## Estado

Cadastro compartilhado implementado; associação versionada e Desktop pendentes. Catálogo ainda não possui auditoria/versionamento monotônico, feed/outbox ou recibo durável. Não há migration, dependência nova, mudança de backup ou comando Tauri. Web/Mobile e regras de importação seguem suas histórias. Homologações humanas após integração completa; sete originais e DP-01 a DP-04 preservados. A validação integrada deste incremento é registrada no [estado do projeto](../delivery/status.md).
