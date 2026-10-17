# Acesso a dados por módulo — US-024

A [US-040 em andamento](financial-accounts.md) acrescenta as factories internas de escrita de contas e a opção snapshot: true em createPostgresReadUnit para leituras financeiras consistentes. O comportamento anterior READ COMMITTED permanece como default; regras continuam no Domain e SQL só nos adapters proprietários.

finance-ports fornece AccountsReadPort, TransactionsReadPort, WorkspaceReadUnit e DTOs imutáveis. persistence-postgres fornece createPostgresReadUnit; os composition roots createApiReadModel/createWorkerReadModel instalam o adapter e expõem read, accountActivity e close. Não criam conexão, aplicam migration ou concedem autorização por padrão. [Decisão e ameaças](../architecture/adr/0035-ports-e-repositories-por-modulo.md).

## Uso pelo backend

O host injeta um pool pg dedicado com role de runtime sem owner/superuser/BYPASSRLS, expected_role e authorize. O provider recebe somente workspace_id/principal_id internos e retorna workspace_id, permissions (accounts:read/transactions:read) e account_ids: lista explícita, [] sem contas ou null para todas naquele workspace. null no grant nega acesso. A autenticação de HTTP/job deve produzir o principal; não aceite essas permissões do cliente. Não existe configuração de banco de produção neste incremento.

read(request, async ports => ...) abre uma unidade READ ONLY e usa o mesmo client para SET LOCAL e todas as consultas. Aguarde todas as chamadas dentro do callback. Não retenha ports para depois, abra unidade aninhada ou chame close de dentro da própria unidade. Erros são DataAccessError com código fechado; não registre o erro original do driver. O host precisa instalar listeners de erro seguros, definir limites/timeouts e usar o transporte apropriado ao ambiente. close aguarda as unidades em curso; owns_pool é false por padrão e true somente se a unidade deve encerrar o pool.

Accounts permite obter/listar contas e paginar referências. Transactions permite obter/listar transações ativas, rateios, IDs das tags e cabeçalhos de revisões. Cada associação filtra a conta do pai no mesmo SQL. Snapshots de revisão, dados de conta oculta, metadados globais, mutações, feed/tombstones e regras de totais/busca/exportação não são oferecidos como atalhos. Os fluxos futuros devem preservar o mesmo escopo. readAccountActivity demonstra orquestração explícita dos dois ports, mantendo a regra de domínio fora do adapter.

Páginas têm limite inteiro de 1 a 100 e cursor com workspace/filtros vinculados; cada unidade reautoriza, inclusive ao usar um cursor anterior. Contas ordenam por id; referências e transações por data/id ascendentes, sem OFFSET. Esses objetos são internos: o handler HTTP futuro deve validar/codificar o token opaco do contrato. Não há snapshot estável entre páginas ou garantia de feed de alterações. Dinheiro/versionamento são strings decimais exatas, data financeira é YYYY-MM-DD e instantes são UTC/ms canônicos.

## Protocolo real

Com Node 24.19.0, pnpm 11.25.0 e Docker Linux local:

```sh
pnpm install --frozen-lockfile
pnpm query:gate
pnpm repositories:test
pnpm repositories:clean
pnpm check
```

query:gate repete o candidato G07-QUERY; repositories:test também testa os ports reais e exige os 22 gates. O runner usa PostgreSQL 18.6 por digest, porta loopback 43221, tmpfs e projeto financial-manager-us024. Não execute simultaneamente outros protocolos que usem essa porta. O banco us021 e o helper dual-postgres preservam o corpus comum; migração v2 é aplicada com login migrator antes das leituras de produto. O login runtime herda apenas permissões de fixture, com políticas sintéticas por login/workspace, sem bypass de RLS. As demais aplicações/contêineres não são alvo da limpeza.

Arquivos privados/lock/senha e relatório ficam em .tools/us024-repositories. O runner remove senha, banco, contêiner e rede ao terminar; clean recusa execução ativa, path ligado, Docker remoto ou recursos com dono/imagem divergentes. O [relatório arquivado](../quality/evidence/us-024-repositories-2026-10-16.json) contém somente gates, versões, datas, pendências e hashes das fontes. Não contém dados, parâmetros ou credenciais. Falhas imprimem apenas etapa e código técnico permitido.

pnpm check:data-access e a suíte padrão verificam fronteiras/tipos negativos. O job scoped-repositories repete o protocolo real no Ubuntu e executa limpeza sempre. O aceite da US-024 cobre os ports de leitura/backend e a detecção de acesso cruzado; policy engine, handlers, transações de escrita e adapters nativos seguem nas histórias próprias. Nenhuma compilação TypeScript homologa Tauri, Expo, Next.js ou NestJS. Próxima história independente: US-025, fixtures financeiras canônicas carregáveis em ambos os bancos com totais esperados versionados.
