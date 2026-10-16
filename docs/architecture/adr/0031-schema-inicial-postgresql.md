# ADR-0031 — Schema financeiro inicial PostgreSQL

- Data: 2026-10-16.
- Status: adotado para o schema inicial; autorização e integração de produto pendentes.
- História: US-020; não encerra US-021 a US-027, US-100 a US-102 ou os gates G07.
- Referências: [modelo §03–13](../03-data-model.md), [backlog](../../delivery/05-backlog.md), [arquitetura](../04-technical-architecture.md).

## Decisão

O schema fm contém workspace cloud, conta, referência de saldo, grupo, contraparte, categoria/subcategoria, tag/vínculo, movimentação, rateio e revisão. A migração SQL versionada é fonte de verdade física. Não copiamos o schema dos spikes. pg 8.23.1 já existente é usado somente nas ferramentas/testes; nenhuma biblioteca externa de produção foi acrescentada e nenhum repository foi fixado.

IDs são UUIDs não nulos, fornecidos pela aplicação, com PK global e unicidade adicional workspace/id. Todas as relações financeiras usam FKs compostas para impedir referências entre espaços. A FK de subcategoria inclui categoria e workspace. Identificadores fiscais permanecem texto. PostgreSQL é autoridade cloud; o schema não recebe cofres locais nem cria usuário anônimo.

Money usa BIGINT nativo, com leitura como string no driver e no JSON das fixtures. Rateios exigem valores positivos. Zero rateios representa movimentação ainda sem classificação; quando existem parcelas, a soma deve ser exatamente o módulo do valor, inclusive INT64_MIN. O cálculo agregado usa NUMERIC para evitar overflow ao tomar o módulo. Triggers diferíveis validam o estado final e locks na movimentação serializam mudanças de rateio. Regras de transferência, cartão e relatório continuam no domínio e na futura suíte cross-engine.

Categorias e tags têm chave normalizada gerada (Unicode NFKC, espaços, lower) e unicidade parcial para nomes ativos por workspace. A normalização não remove acentos nem promete busca aproximada. Referências ativas são únicas por conta/data/posição no dia; referências históricas ou de outros pontos continuam permitidas. Índices de movimentações incluem workspace/data/id e workspace/conta/data/id para paginação determinística, sem alegação de benchmark de produto.

Revisões têm FK de movimentação, versão positiva e única por movimentação, snapshot JSON objeto e trigger que rejeita UPDATE/DELETE. O formato canônico completo do snapshot, incremento otimista, revisão automática, auditoria, outbox e resource_tombstone ficam na US-026 e histórias de sync. deleted_at preserva o registro e suas revisões; não entrega exclusão sincronizada. IDs e workspace de uma entidade existente não são editáveis.

## Tempo e gates

DATE usa intervalo 0001–9999 e recusa infinity. TIMESTAMPTZ preserva o instante, com domínio que exige precisão de milissegundos, finitude e o mesmo intervalo; não usamos TIMESTAMPTZ(3), que arredondaria uma entrada mais precisa. O banco normaliza offsets equivalentes; a validação lexical UTC do contrato HTTP continua na US-012. O teste usa strings e conversão explícita UTC, sem conversão monetária ou temporal por Number/Date.

G07-TIME avançou apenas no PostgreSQL, com vetores reais de data, UTC, fuso e rejeição de microssegundos. A comparação com os dois bindings SQLCipher permanece aberta antes de adotar o schema SQLite. Esta decisão especifica o lado PostgreSQL e não substitui o gate cross-engine do ADR-0024. G07-IDS continua na US-023: os UUIDs da fixture são vetores fixos, não homologação de gerador. G07-QUERY continua antes de fixar repositories; as queries deste protocolo são ferramentas SQL explícitas. Não houve adoção de Kysely/ORM. G07-VAULT/JOBS/PDF e DP-01 a DP-04 mantêm seus escopos.

## Autorização e ameaças

Todas as 12 tabelas financeiras têm ENABLE/FORCE RLS e policy restritiva que exige workspace do contexto. Não há policy permissiva nem grants de runtime na migração. Assim, a migração isolada nega acesso, inclusive ao owner sob FORCE, e não entrega uma API utilizável. SQL de produto não fica acessível por HTTP/IPC genérico.

O protocolo acrescenta policies permissivas exclusivamente para o grupo de fixtures, ligadas a uma tabela técnica protegida com workspace e login PostgreSQL de sessão. Logins A/B/outsider são distintos. Essas policies se combinam com a fronteira restritiva existente; não desativam RLS, não usam BYPASSRLS e não dão ownership ao papel de CRUD. Os testes verificam negação antes desse addon, contexto forjado, escrita/leitura cruzada e restrições de DDL/TRUNCATE. O addon é instrumento sintético, não migração de produto ou enum de membros.

| Ameaça                                        | Controle e limite                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Referência cruzada por UUID válido            | FKs compostas e RLS restritiva; teste negativo em PostgreSQL real.                                                             |
| Migração incompleta/concorrente               | Transação DDL, advisory lock e checksum; falha após DDL desfaz schema inteiro. Credencial migrator é separada de CRUD.         |
| Rateios concorrentes ou parcialmente escritos | Lock do pai e constraint trigger diferível; ensaio real verifica bloqueio e rollback do segundo total inválido.                |
| Alteração do histórico                        | Unicidade e trigger de imutabilidade; DELETE da movimentação referenciada também falha. Purga terá fluxo privilegiado próprio. |
| Perda de precisão                             | BIGINT/string, soma NUMERIC, DATE e domínio TIMESTAMPTZ; extremos testados.                                                    |
| Vazamento em erros/logs                       | Ferramenta retorna código fixo, sem cause/SQL/payload; logs Docker conferidos contra sentinelas e senhas efêmeras.             |
| Acesso antes da policy engine                 | Default deny, nenhum runtime grant; a autorização de produto permanece pendente.                                               |

O bootstrap privilegiado somente provisiona roles, addon técnico e inspeção. CRUD financeiro e seus testes negativos usam logins restritos. A divergência DP-03 impede fixar o enum de membros, que não integra esta migração. Contexto de workspace sozinho não autentica ou autoriza um membro; a futura integração deve resolver identidade, papéis, capacidades e contas sem enfraquecer esta fronteira.

## Alternativas e evidência

Adiar todo o schema até o ORM impediria testar integridade independente do acesso a dados. Adotar um ORM por compilação violaria G07-QUERY. Políticas permissivas genéricas abririam dados antes da policy engine. Mantemos SQL explícito, schema sem acesso de produto e evidência real das constraints.

[Protocolo/uso](../../development/postgresql-schema.md) e [20 gates reais](../../quality/evidence/us-020-postgresql-2026-10-16.json), com limpeza de recursos próprios. CI postgres-schema repete o ensaio em Ubuntu; execução remota deste incremento permanece pendente. O runner inicial não é o framework dual-engine da US-022 e não oferece downgrade/destruição automática de dados de produto.

Referências consultadas: [constraints PostgreSQL 18](https://www.postgresql.org/docs/18/ddl-constraints.html), [RLS e default deny](https://www.postgresql.org/docs/18/ddl-rowsecurity.html), [tipos de data/tempo](https://www.postgresql.org/docs/18/datatype-datetime.html).
