# ADR-0021 — Isolamento PostgreSQL RLS e contexto no pool

- Data: 2026-10-15
- Status: Validado como spike; integração ao produto pendente
- História: US-004; subsidia US-007
- Substitui: nenhum; preserva ADR-008

## Contexto

A [US-004](../../delivery/05-backlog.md) exige comprovar isolamento mesmo diante de uma consulta sem filtro de workspace. O [PRD](../../product/01-prd.md), RF-25 a RF-27, exige escopo efetivo em leituras, totais e exportação, permissões de escrita e revalidação após revogação. A [arquitetura](../04-technical-architecture.md), seção 10, exige policy engine e RLS, usuário de runtime sem ownership/BYPASSRLS, transação por request e contexto LOCAL. A divergência READER/VIEWER da DP-03 permanece aberta.

## Alternativas

- Apenas WHERE workspace_id: não protege uma consulta que esqueceu o filtro.
- Usar o proprietário ou um superuser na aplicação: impede demonstrar a barreira RLS exigida.
- SET SESSION sem limpeza: permite transportar contexto entre requisições no pool.
- Criar uma engine de permissões completa agora: anteciparia histórias de autorização e a resolução da DP-03.
- Mockar PostgreSQL: não prova políticas, grants, prepared statements, transações ou isolamento do pool.

## Decisão experimental

apps/api/spikes/us-004 contém um adapter Node e uma migração sintética versionada. PostgreSQL 18.6 Alpine é executado em Docker com imagem oficial fixada por digest. pg 8.23.1 é a nova dependência de produção do workspace API: fornece protocolo PostgreSQL real, pool, parâmetros e transações no mesmo client. O spike não seleciona o typed-query final da US-007 nem integra NestJS/Fastify.

O banco e o endpoint são fixos: us004 em 127.0.0.1:43184. Senhas aleatórias de bootstrap, migrator e runtime são geradas por execução, ficam em .tools ignorado e são removidas no teardown. Não há URL de produção ou banco externo aceito pelo runner. O tráfego PostgreSQL local usa SCRAM e não usa TLS neste instrumento; TLS, secrets manager e topologia de produção continuam pendentes.

O bootstrap superuser cria apenas roles/grants e encerra sua conexão antes dos testes de dados. us004_owner não permite login; us004_migrator não é superuser nem BYPASSRLS e faz SET LOCAL ROLE para aplicar a migração. us004_runtime não é membro do owner, não cria roles/bancos/schemas e não recebe TRUNCATE, escrita em ACLs ou DDL. RLS está ENABLED/FORCED nas quatro tabelas tenant-scoped. As functions de contexto são SECURITY INVOKER com search_path fixo; não há SECURITY DEFINER.

A migração cria schema, constraints, fixtures, funções, políticas e grants dentro de uma transação, com registro de versão/checksum antes do commit. A carga inicial ocorre antes de habilitar RLS na mesma transação privada de migração. Não há janela com tabelas parcialmente protegidas publicadas. Retry confere checksum e não recarrega fixtures. Interrupção de DDL e checksum divergente têm teste próprio. Isso não substitui o framework dual-engine da US-022 ou o schema de produto da US-020.

O port withWorkspace exige UUIDs canônicos, aloca um client do pool, limpa defaults anteriores, inicia READ COMMITTED e vincula workspace/user com set_config parametrizado e is_local=true. O terceiro argumento tem semântica de SET LOCAL. O adapter consulta a participação ativa antes de executar o callback e as políticas voltam a consultar a ACL em cada statement. Fim bem-sucedido faz commit; erro faz rollback no mesmo client. RESET ALL/RESET ROLE limpam o checkout/checkin; falha de rollback ou limpeza descarta a conexão. Uma falha de limpeza após commit confirmado não muda o resultado confirmado da operação.

O callback recebe apenas um port de query para repositórios confiáveis. Handles que escapam da transação são fechados, e contexto aninhado no mesmo runner é rejeitado. Não há endpoint de SQL genérico. Prepared statements são preservados no pool: DISCARD ALL não é usado, pois invalidaria o cache de statements nomeados do driver; a homologação reutiliza um mesmo prepared statement entre workspaces.

## Políticas e integridade

- membership é visível ao runtime somente para seu usuário/workspace ativo. can_write/can_export e ALL/SELECTED são capacidades sintéticas do experimento, sem definir o enum de papéis do produto.
- account_scope herda a participação e restringe quais contas podem ser consultadas. account e entry consultam essa fronteira; joins, agregações e a view de exportação usam o mesmo conjunto autorizado.
- INSERT, UPDATE e DELETE verificam escrita; UPDATE possui USING e WITH CHECK para a linha anterior e a nova. Mudar workspace/account ou usar UPSERT não contorna a política.
- export_entries utiliza security_invoker/security_barrier e exige concessão sintética de exportação. O produto ainda exige autorização do endpoint; nenhuma política impede alguém de copiar manualmente dados que pode consultar.
- FKs de entry e account_scope incluem workspace_id. O teste de FK negativa usa o port administrativo de ACL explicitamente permitido ao owner; referência cruzada é rejeitada por 23503. As tentativas financeiras cruzadas do runtime são barradas antes, por RLS.
- O owner tem política administrativa explícita somente em membership/account_scope para controlar fixtures. Não possui política financeira; FORCE RLS nega a leitura financeira sem contexto inclusive ao owner. Nenhum teste desabilita RLS para obter aprovação.
- BIGINT é recebido pelo JavaScript como string decimal, com extremos de INT64 e ida/volta JSON exatos. O domínio monetário definitivo permanece na US-013.

## Ameaças e limites

| Fronteira             | Ameaça                                                                  | Controle / limite                                                                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pool                  | Contexto de A herdado por B                                             | Mesmo client durante a transação, binding LOCAL, limpeza anterior/posterior, teste de sessão contaminada, rollback, prepared statement e concorrência real                                              |
| Autorização           | Workspace arbitrário ou permissão vinda do cliente                      | Participação e capacidades consultadas na base; workspace sem participação é negado; flag GUC de escrita não concede acesso                                                                             |
| Confiança no servidor | Subject forjado por SQL injection ou credencial de runtime comprometida | GUC não é identidade criptográfica. O servidor futuro deve obter user_id da identidade OIDC verificada; RLS aqui protege erros de filtro, não comprometimento do servidor ou execução arbitrária de SQL |
| Revogação             | Callback continua usando permissão antiga                               | READ COMMITTED e ACL por statement; nova leitura/escrita após commit da revogação é bloqueada mesmo na transação aberta                                                                                 |
| Snapshot              | Cancelamento retroativo de consulta já iniciada                         | RLS usa o snapshot do statement; não cancela automaticamente consulta anterior nem replica revogação em cliente offline                                                                                 |
| SQL administrativo    | Ownership, TRUNCATE, row_security=off ou DDL usados como escape         | Grants mínimos, runtime sem ownership/BYPASSRLS e testes negativos; superuser/migrator não são credenciais da aplicação                                                                                 |
| Constraint            | Inferir existência de outra linha por erro de FK/unique                 | PostgreSQL possui exceções de integridade à RLS; API deve parametrizar queries, aplicar policy engine e devolver erro seguro. Não se promete eliminar todos os canais laterais                          |
| Falha de conexão      | Escrita parcial ou retry automático com resultado incerto               | Rollback/evicção e teste de socket interrompido; sem retry automático. Idempotência e commit com ACK perdido precisam dos contratos de produto                                                          |
| Logs                  | Linha, valor, SQL ou senha em erro nativo                               | Erros do adapter expõem código fixo/SQLSTATE, sem cause/detalhe; logs de statements/parâmetros/erros SQL são suprimidos no serviço; runner verifica stdout/stderr sem publicá-los                       |
| Ambiente              | Banco persistente ou acesso remoto acidental                            | Usuário postgres sem capabilities, endpoint loopback e PGDATA em tmpfs; nenhum diretório financeiro montado; teardown verifica container e arquivos removidos                                           |

O Docker usa uma bridge dedicada com publicação exclusivamente loopback. Não se declara bloqueio de toda saída de rede nem isolamento de um administrador Docker/Windows. As duas credenciais de aplicação/migração e o password file são apenas sintéticos e efêmeros; isto não aprova gestão de segredos de produção.

## Validação

O [protocolo US-004](../../development/spikes/us-004-postgresql-rls.md) separa os testes de lifecycle do adapter, a execução PostgreSQL e os gates do monorepo. A história não entrega policy engine completa, API/NestJS, integração OIDC→cloud_user, convites ou sincronização. Não altera DP-01 a DP-03 nem conclui US-002/US-003.

Homologação aprovada em 2026-10-15: PostgreSQL 18.6 real em container Linux no Docker Desktop 29.8.2/Windows; 20 verificações de ambiente/protocolo e 48 requests concorrentes, com limpeza confirmada. [Evidência sanitizada](../../quality/evidence/us-004-postgresql-2026-10-15.json) inclui hashes de imagem e migração e versões do driver/Node. pnpm check aprovado com 39 testes. O job postgres-rls foi configurado na CI; execução remota ainda pendente.

Fontes consultadas em 2026-10-15: [RLS PostgreSQL 18](https://www.postgresql.org/docs/18/ddl-rowsecurity.html), [CREATE POLICY](https://www.postgresql.org/docs/18/sql-createpolicy.html), [SET LOCAL](https://www.postgresql.org/docs/18/sql-set.html), [views com security_invoker](https://www.postgresql.org/docs/18/sql-createview.html), [logging PostgreSQL](https://www.postgresql.org/docs/18/runtime-config-logging.html), [transações node-postgres](https://node-postgres.com/features/transactions) e [imagem oficial PostgreSQL](https://github.com/docker-library/official-images/blob/master/library/postgres).
