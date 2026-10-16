# Schema PostgreSQL inicial — US-020

O [aceite](../delivery/05-backlog.md) exige constraints e FKs para workspace, contas, transações, categorias, rateios e revisões. O [ADR-0031](../architecture/adr/0031-schema-inicial-postgresql.md) define as decisões e os limites. A migração de produto está em apps/api/persistence/postgres/migrations/0001-financial-core.sql; não substitui schemas experimentais nem é aplicada automaticamente aos quatro ambientes US-014.

## Executar a homologação

```powershell
pnpm install --frozen-lockfile
pnpm schema:test
pnpm check
# Limpeza da instância sintética dedicada, se necessária:
pnpm schema:clean
```

Exige Docker Linux local, Node/pnpm fixados no repositório e porta loopback 43220 livre. A imagem PostgreSQL 18.6-alpine está fixada por digest no Compose. Não aponta para banco externo nem recebe URL/credencial de produção. O runner verifica contexto local, recusa tomar instância já existente e usa lock para impedir dois ensaios simultâneos. Uma instância em uso não é resetada pelo comando test. clean valida os labels/imagem do ambiente dedicado antes do teardown; não execute enquanto outro ensaio estiver ativo.

Dados ficam em tmpfs do contêiner. Somente senha bootstrap aleatória e temporários técnicos ficam em .tools/us020-schema, ignorados. As demais senhas vivem em memória. O runner encerra pools, contêiner, rede e remove a senha própria em finally, inclusive após falha do protocolo. O relatório latest.json é fechado e sanitizado; não salva SQL, payload, logs brutos, documento ou banco. Interrupção forçada do processo pode exigir recuperar o lock local após confirmar que não há runner ativo; não remova locks de outro processo.

## Objetos entregues

| Objeto                 | Integridade principal                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| workspace              | Autoridade CLOUD, moeda BRL, ID/geração UUID não nil, nome e finalidade                      |
| financial_account      | FK workspace, tipos/status, moeda e cartão com natureza LIABILITY                            |
| balance_reference      | FK composta de conta, valor BIGINT, data e posição no dia, unicidade ativa por ponto         |
| transaction_group      | Workspace, tipo e estado da operação composta                                                |
| counterparty           | Workspace e identificador textual opcional                                                   |
| category/subcategory   | Nome ativo normalizado único; subcategoria ligada à categoria do mesmo espaço                |
| tag/transaction_tag    | Nome ativo único; vínculo N:N sem repetição e sem cruzar espaço                              |
| financial_transaction  | Conta/grupo/contraparte do mesmo espaço, BIGINT assinado, DATE, versão positiva e deleted_at |
| transaction_allocation | Parcela positiva, categoria/subcategoria coerentes e soma diferível completa                 |
| transaction_revision   | FK de movimentação, versão única, snapshot objeto e imutabilidade                            |

schema_migration é metadado técnico de migração e não uma entidade financeira. Não há original fiscal, staging de importação, identidade, membro, conta remota anônima, documento, job ou feed de sync neste schema inicial.

Valores monetários são inteiros exatos em centavos; pg mantém BIGINT como string. INT64_MIN é válido em movimentações; o módulo das parcelas é calculado com NUMERIC para evitar overflow. A movimentação pode permanecer sem categoria. Ao classificá-la, a soma de suas parcelas deve fechar na mesma transação. Alterar valor/rateios juntos é permitido; um estado final inconsistente falha no commit e desfaz todas as escritas. Isso não confirma importação ou produz revisões automaticamente.

Os nomes normalizados usam NFKC, redução de espaços e lower; a grafia original é mantida. Arquivados não bloqueiam nomes ativos equivalentes. A ordenação por financial_date/id desempata páginas sem depender do relógio do UUID. Busca full-text e planos de carga de produto continuam nas histórias próprias.

## Migração e acesso

applyInitialMigration é ferramenta interna, fora do index de API. Recebe um pool de migrator explicitamente provisionado, usa SET LOCAL ROLE fm_schema_owner, transação e advisory lock. Apenas PostgreSQL 18 é aceito. Reaplicar checksum igual não altera nada; checksum diferente é recusado. Erros de conexão/SQL são convertidos em código fixo, sem detalhes do driver. Uma falha de rollback descarta a conexão. Não há execução em produção nem integração NestJS neste incremento.

As 12 tabelas financeiras têm FORCE RLS e somente policy restritiva por workspace. A migração não cria grants ou policies que habilitem um runtime. US-100 a US-102 e a integração da policy engine devem fornecer permissões por membro/conta, mantendo a fronteira existente. DP-03 permanece aberta; não foi escolhido READER ou VIEWER.

O protocolo instala um addon de autorização sintético no ambiente descartável: login A acessa workspace A; B acessa B; outsider não acessa nenhum. O login da sessão é conferido em tabela protegida. O papel de CRUD não possui ownership, BYPASSRLS, DDL, TRUNCATE ou acesso ao registro de migrações. Todos os testes financeiros, inclusive violações de FK e constraints, usam esses logins e RLS ativa. O bootstrap não realiza CRUD financeiro. Esse addon não acompanha a migração de produto.

## Evidência e continuidade

Os [20 gates reais](../quality/evidence/us-020-postgresql-2026-10-16.json) verificam rollback/reaplicação/checksum e migração concorrente; roles/default deny; 12 tabelas/11 FKs compostas; seed autorizado; contexto forjado, leitura/escrita/FKs cruzadas; obrigatoriedade/enums; extremos i64/overflow; datas e precisão UTC; unicidade de nomes; vínculo de subcategoria; rateio atômico e concorrência com bloqueio observado; revisão/soft delete; referências/cartão; paginação/índices; privilégio mínimo; logs e limpeza.

Quatro testes Node verificam a evidência e o tratamento seguro de falhas de conexão/rollback do runner. pnpm check inclui esses testes; o teste real de banco é pnpm schema:test e tem job próprio no CI. O relatório contém versões, hashes das fontes, gates e pendências. As mudanças de package.json/CI também exigiram reexecução dos [quatro perfis Docker](../quality/evidence/us-014-environments-2026-10-16-us020.json) e dos protocolos [DOM](../quality/evidence/us-016-dom-2026-10-16-us020.json)/[flags](../quality/evidence/us-017-flags-2026-10-16-us020.json), com os relatórios anteriores preservados.

A próxima etapa é US-021, schema SQLite equivalente, acompanhada dos gates de tempo/bindings/migração do cofre. Não há conclusão cross-engine, gerador UUIDv7, typed query, policy engine, revisão automática, outbox/tombstone ou integração de produto. Esses trabalhos mantêm suas histórias/gates. DP-01/02 e prazos de retenção/offline não foram alterados.
