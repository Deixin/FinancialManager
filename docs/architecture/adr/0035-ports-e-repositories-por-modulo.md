# ADR-0035 — Ports e repositories por módulo

Data: 2026-10-16. História: US-024. Status: adotado para leituras PostgreSQL no backend, após aprovação local do G07-QUERY.

Complementa a arquitetura §04/§11.2, RF-26/RF-27 e o [ADR-0024](0024-consolidacao-fisica-e-gates.md). Substitui a candidatura de typed-query somente no recorte PostgreSQL validado. DP-01 a DP-04, os sete originais e as decisões de escrita/sincronização permanecem nos seus escopos.

## Contexto e decisão

Os módulos precisam consultar dados sem receber um cliente SQL irrestrito. Domain permanece puro. finance-ports define DTOs e capacidades de leitura; persistence-postgres implementa Accounts e Transactions com tipos de tabelas separados. API e worker instalam o adapter somente nos seus composition roots. readAccountActivity coordena os dois ports explicitamente; Accounts não consulta Transactions por atalho.

Adotamos Kysely 0.29.6 como nova dependência de produção do adapter, com pool pg 8.23.1 fornecido pelo host Node 24.19.0. A biblioteca compila queries parametrizadas e controla a transação no mesmo client; não é usada como engine de domínio ou migrations. Seu [PostgresDialect](https://kysely-org.github.io/kysely-apidoc/classes/PostgresDialect.html) aceita um pool fornecido pela aplicação. Os [tipos](https://kysely.dev/docs/getting-started) não substituem conversão/validação em runtime: BIGINT é projetado como TEXT e validado como string i64, DATE como calendário ISO e TIMESTAMPTZ como UTC com milissegundos. Versões são strings positivas i64. Ordenação usa as colunas físicas, inclusive versões 1/2/10, sem ordenar a representação textual.

O candidato foi exercitado antes da declaração da dependência de produção; o protocolo completo repete os nove gates de query e testa os repositories após migrar v1 para v2. SQL explícito com ports era a alternativa se o gate falhasse. Um ORM com entidades/relações implícitas não foi necessário; compartilhar uma conexão genérica entre módulos impediria restringir as capacidades. Não há adoção de driver Kysely para SQLCipher/Rust/Expo neste ADR.

## Autorização e ciclo de vida

Cada read exige workspace/principal interno autenticado e um authorize confiável que retorna capacidades e lista de contas autorizadas. null recusa; lista vazia não lê contas; null na lista autoriza todas as contas daquele workspace. O chamador de HTTP/job não fornece o grant. A factory captura a configuração, e cada unidade captura/congela request/grant antes das queries. Worker revalida a cada execução, inclusive uma nova tentativa; não há cache de autorização. Isso não escolhe READER ou VIEWER (DP-03).

Uma transação READ ONLY/READ COMMITTED verifica session_user/current_user, recusa superuser, BYPASSRLS, role inesperada ou membro de fm_schema_owner, e aplica SET LOCAL de workspace/UTC/DateStyle. Todos os ports usam esse client. Predicados explícitos de workspace e conta complementam RLS/FORCE RLS. A migração de produto continua default deny: as permissões adicionais do protocolo são exclusivamente sintéticas, sem políticas permissivas/grants de produção novos.

Cada leitura de rateios, vínculos de tags e cabeçalhos de revisão faz INNER JOIN com a transação, por workspace/id, filtrando a conta e deleted_at no mesmo SQL. Consultar o pai e depois o filho em comandos distintos permitiria uma mudança concorrente da conta entre as consultas. Não expomos snapshots de revisões ou metadados globais de categorias/contrapartes antes dos seus próprios ports e regras. O retorno contém apenas DTOs imutáveis, nunca handle, query builder ou stream.

Ports expiram quando o callback termina. Queries não aguardadas são drenadas e recusam a unidade; erro de query permanece registrado mesmo se capturado no callback. Unidades aninhadas são recusadas para evitar deadlock com pool pequeno. close impede novas unidades e aguarda as existentes; é chamado pelo host fora do callback. O pool é emprestado por padrão e pode ser explicitamente próprio. Uma conexão com erro é descartada mesmo se rollback falhar. O host configura timeouts, TLS de produto e listeners seguros de erro de pool/client. Erros públicos contêm apenas códigos fixos, sem SQL, parâmetros, stack ou causa; não se emite telemetria financeira.

## Fronteiras e avaliação de ameaças

packages/config/data-access-boundaries.json atribui as 12 tabelas a cinco módulos. O verificador AST recusa tabela alheia, tabelas dinâmicas, imports de adapters/driver entre módulos, raw SQL, any/casts de ampliação, escrita e leituras de filhos sem join do pai. Tipos negativos rejeitam colunas/tipos inválidos e acesso a SQL/escrita pelos ports. Essas verificações detectam regressões de arquitetura; código malicioso com acesso ao processo continua fora desse limite de confiança. Autorizar o principal, limitar o login no banco e manter RLS ativa continuam essenciais.

Riscos tratados: troca de workspace no pool, acesso a conta oculta por associação/histórico, contexto escapando do callback, operação sem await, driver falho devolvido ao pool, injeção por parâmetros e exposição de dados em erros/logs. Um authorize ou pool comprometido permanece confiável e pode invalidar o isolamento; nenhum deles é configurável por entrada pública. A lista de contas é um snapshot da autorização da unidade, sem promessa de revogação no meio de uma query já iniciada. Novas unidades revalidam.

## Evidência e limites

O [relatório](../../quality/evidence/us-024-repositories-2026-10-16.json) exige 22 gates: nove G07-QUERY, onze de repositories, logs sanitizados e limpeza. PostgreSQL 18.6 real usa roles sem bypass, fixtures FIN-SCHEMA-001, RLS sem WHERE, WITH CHECK, rollback, backend encerrado, concorrência, locks e keyset. Os testes de arquitetura introduzem violações deliberadas. O [guia](../../development/data-access.md) descreve reprodução e limites.

São ports de leitura do backend. Escritas financeiras compostas serão implementadas com revisões, idempotência e outbox; read não vira uma transação de escrita. A listagem ascendente por data/id de transações ativas não é feed de sync, histórico completo ou snapshot entre páginas. Cursors internos vinculam workspace/filtros; tokens opacos HTTP, policy engine, rotas de produto e adapters nativos permanecem pendentes. CI está configurada, com execução remota deste incremento pendente. Relatórios nativos US-023 permanecem históricos, sem reexecução ou alteração manual de hashes.
