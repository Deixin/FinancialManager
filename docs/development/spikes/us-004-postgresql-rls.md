# US-004 — Protocolo PostgreSQL RLS e pool

## Objetivo e escopo

Comprovar que o runtime de A não consulta nem altera dados de B quando o SQL esquece o filtro de workspace, conforme [US-004](../../delivery/05-backlog.md), RF-25 a RF-27 e [ADR-0021](../../architecture/adr/0021-spike-isolamento-postgresql-rls.md). Instrumento isolado em apps/api/spikes/us-004, sem API pública, NestJS ou dados reais.

## Execução

Pré-requisitos: Node/pnpm nas versões fixadas no repositório, pnpm install --frozen-lockfile, Docker Linux com Compose e porta 43184 livre no loopback. Não configure banco externo ou credenciais reais.

```sh
pnpm spike:rls:test
pnpm check
# Limpeza própria caso uma execução seja interrompida externamente:
pnpm spike:rls:down
```

O runner recria somente o projeto Compose financial-manager-us004. Usa PostgreSQL 18.6 Alpine fixado por digest, dados em tmpfs, sem volumes persistentes; gera três senhas sintéticas, provisiona roles e aplica a migração. O serviço publica exclusivamente 127.0.0.1:43184. Senha de runtime nunca entra em argumento de processo ou configuração versionada.

No fim, o runner encerra pools, remove container/rede/tmpfs e os arquivos bootstrap-password/credentials.json próprios em .tools/us004-rls. Relatório sanitizado é gravado apenas após o teardown; um relatório anterior é removido antes de começar. Imagem/cache Docker não contém fixtures da execução.

## Casos reais no PostgreSQL

1. Aplicar migração v1 atomicamente; conferir checksum em retry, FORCE RLS e funções SECURITY INVOKER. Interromper DDL e provar ausência da tabela parcial e preservação da versão.
2. Conferir runtime sem superuser/BYPASSRLS/ownership/membership do owner, criação de schema ou TRUNCATE.
3. Ler sem contexto, com contexto parcial ou inválido: não obter dados. Workspace solicitado sem participação deve ser rejeitado antes do callback.
4. Executar CRUD autorizado de fixture própria e verificar BIGINT como string exata, incluindo limites de INT64 e JSON.
5. Executar SELECT/UPDATE/DELETE sem WHERE: somente A participa. Alterações são verificadas e revertidas; o dataset de B permanece exato.
6. Tentar INSERT, mudança de workspace/account e UPSERT de B: rejeitar por RLS. Trocar somente o GUC de workspace não fornece participação ao usuário de A.
7. Restringir a uma conta: leitura, join, soma e exportação não incluem a conta oculta. INSERT/UPDATE para conta fora do escopo são negados.
8. Negar escrita para participação somente de leitura e exportação sem concessão. GUC de can_write não concede permissão; runtime não altera ACL.
9. Rejeitar referência de conta de outro workspace por FK composta no port administrativo de ACL, sem desabilitar RLS.
10. Revogar participação/permissão em conexão administrativa independente durante uma transação de runtime. O próximo statement deve respeitar o estado confirmado; nova requisição revogada deve falhar.
11. Com pool de tamanho 1, confirmar mesmo backend após A/B/rollback e remover contexto de sessão contaminado. Sem contexto depois de devolver a conexão, SELECT retorna zero linhas.
12. Reutilizar o mesmo prepared statement entre A, B e um usuário participante de ambos, mantendo o conjunto correto por request.
13. Executar 48 requests concorrentes em pool com até 4 conexões e provar os resultados específicos de cada contexto em pelo menos dois backends.
14. Reverter escrita até savepoint e preservar o contexto da requisição.
15. Interromper o próprio backend depois de uma escrita; confirmar rollback, substituição da conexão e ausência da linha não confirmada.
16. Provar FORCE RLS no owner financeiro e negar tentativas do runtime de SET ROLE, DDL, TRUNCATE e row_security=off.
17. Verificar configuração Docker e inspecionar stdout/stderr do serviço em memória, rejeitando senhas, UUIDs de fixture e valores monetários presentes nos logs. Nenhum log bruto é exportado.

Todas as operações financeiras de homologação usam o runtime restrito. O superuser faz apenas bootstrap de roles e encerra a conexão. A carga inicial pertence à migração transacional; administração de participação usa políticas explícitas de ACL do owner.

## Testes do adapter e evidência

Os unitários verificam validação antes do checkout, binding LOCAL parametrizado, commit, rollback, descarte diante de falha, resultado de commit confirmado, rejeição de contexto aninhado e fechamento de port que escapou. Usam client sintético para testar lifecycle; não são apresentados como evidência de RLS.

A evidência real contém flags, quantidade sintética de requests, versão do engine/driver/Node e hashes de imagem/migração. Não inclui rows, workspace/user IDs, valores, senhas, SQL ou erros nativos. validateRlsEvidence exige todos os casos e cleanup e rejeita campos extras.

## Limites e próximos passos

- Integração OIDC verificada, policy engine, roles definitivos, convites e endpoints da API serão implementados nas histórias correspondentes. UUIDs de usuário do experimento são sintéticos.
- O runtime do servidor pode executar SET de GUC; confiança na identidade depende do servidor. Este teste não promete resistir a SQL injection arbitrária ou comprometimento da credencial runtime.
- RLS não cancela statements iniciados antes de uma revogação nem resolve revogação offline. READ COMMITTED observa o commit da revogação no próximo statement.
- Schema, adapter e permissões são experimentais. Typed-query final, migrations dual-engine, autorização de produto e TLS/secrets de produção permanecem pendentes.
- DP-03 READER/VIEWER não foi resolvida: capacidades booleanas e ALL/SELECTED só modelam a fixture.

## Resultado

Homologação aprovada em 2026-10-15, concluída em 2026-10-16 às 02:26 UTC (noite de 15/10 em America/Fortaleza). [Evidência sanitizada](../../quality/evidence/us-004-postgresql-2026-10-15.json): PostgreSQL 18.6 em container Linux/Docker Desktop 29.8.2 no Windows, Node 24.19.0, pg 8.23.1, 20 verificações e 48 requests concorrentes. Teardown e inspeção de stdout/stderr aprovados; pnpm check aprovado com 39 testes.

O job postgres-rls da [CI](../../../.github/workflows/ci.yml) executa o mesmo comando em Linux e faz limpeza adicional. O job está configurado, sem alegação de execução remota. O resultado conclui a US-004 como spike experimental e subsidia a US-007; os limites de produto acima permanecem.
