# ADR-0024 — Consolidação física e gates de adoção

- Data: 2026-10-16
- Status: Consolidação registrada; propostas de adoção e gates pendentes conforme a tabela
- Histórias: US-007; orienta US-013 e US-020 a US-027
- Substitui: nenhum; preserva os documentos originais e os ADRs dos spikes
- Aprovação: não há aprovação humana formal de produção registrada neste ADR

## Contexto

A [US-007](../../delivery/05-backlog.md) exige que UUID SQLite, timestamps, binding SQLCipher, typed query, job queue e PDF parser tenham decisão registrada **ou spike pendente explícito**. O aceite não exige declarar viáveis integrações ainda não testadas. Este registro consolida as escolhas propostas, a evidência disponível e os gates antes da implementação afetada. Não altera prazos, escopo ou papéis das [DP-01 a DP-03](../decisions-pending.md).

## Seis decisões exigidas

| Item                      | Proposta concreta                                                                                                                                                               | Evidência disponível                                                                                        | Gate ainda necessário                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UUID SQLite               | TEXT canônico minúsculo de 36 caracteres, COLLATE BINARY, FKs com workspace_id. Novos IDs seguem UUIDv7 conforme ADR-004.                                                       | Probe US-007 de armazenamento, unicidade, FK e ordenação de vetores v7. US-001 usa uuid Rust 1.28.0/now_v7. | G07-IDS: biblioteca/entropia e geração v7 equivalentes por plataforma; validar SQLCipher nas US-021/US-023.                                                                 |
| Timestamps SQLite         | TEXT UTC fixo YYYY-MM-DDTHH:mm:ss.SSSZ. Datas financeiras separadas como YYYY-MM-DD. Cloud usa TIMESTAMPTZ com precisão contratual de milissegundos.                            | Probe US-007: persistência, ordem, calendário e rejeição de offsets/precisão diferentes.                    | G07-TIME: repetir os vetores em PostgreSQL e nos bindings SQLCipher, inclusive ida/volta JSON.                                                                              |
| Binding SQLCipher Desktop | Base candidata: rusqlite 0.40.2 com bundled-sqlcipher-vendored-openssl; conexão e chaves no core Rust, comandos Tauri estreitos.                                                | US-001, SQLCipher 4.14.0 community, Windows Credential Manager e restore em outra instalação Windows.       | G07-VAULT: adaptar o core ao schema de produto/migrations, rever dependências/empacotamento e manter gates de distribuição. Mobile é uma homologação própria; iOS pendente. |
| Typed query backend       | Primeiro candidato: Kysely sobre pg, mantendo SQL explícito e o mesmo client/contexto da transação. Drizzle/SQL tipado explícito permanecem alternativas se o candidato falhar. | US-004 valida pg/RLS/pool; não valida um typed-query. Nenhuma nova biblioteca é instalada nesta US-007.     | G07-QUERY: spike obrigatório antes de fixar o acesso a dados de US-020/US-024.                                                                                              |
| Job queue                 | Fila durável PostgreSQL com worker separado, conforme ADR-011. Implementação candidata: adapter SQL com claim/lease, fencing, retry e idempotência de efeito.                   | Arquitetura §18; não há worker/fila de produto implementado.                                                | G07-JOBS: concorrência, queda, retry e contexto/efeito financeiro em PostgreSQL real antes do primeiro job cloud.                                                           |
| PDF textual               | Leitor local versionado por layout; avaliar PDF.js e uma alternativa nativa no corpus sintético antes da escolha final.                                                         | US-006 valida OFX/CSV; não fornece evidência de PDF. Nenhum banco/layout PDF está homologado.               | G07-PDF: extração, posições, limites, isolamento e descarte antes de US-081 e do PDF em US-057.                                                                             |

As propostas dessa tabela são entradas de implementação/revisão, não autorização de release. Cada gate e seu critério de saída estão no [protocolo da US-007](../../development/spikes/us-007-physical-decisions.md). A consolidação cumpre o aceite da história; DP-04 e a W0 como um todo permanecem abertas.

## Representações e alternativas

TEXT para UUID preserva leitura, JSON e comparação sem conversores de byte order entre Rust, JavaScript e PostgreSQL. BLOB 16 reduz o payload de cada identificador; a escolha por TEXT não é uma afirmação de que índices TEXT têm o mesmo custo. Rever somente com medição representativa. Não inferir autoridade ou ordem de commit pelo relógio embutido no UUID. A ordem dos vetores fixos testados não comprova geração, aleatoriedade ou monotonicidade entre dispositivos.

O armazenamento aceita UUIDs canônicos da variante RFC e versões 1 a 8, preservando IDs existentes; o gerador de novos IDs será v7. Nil, texto sem hífens e maiúsculas são recusados no contrato do probe. Não regenerar IDs de backups, importações ou conflitos para obter uma versão diferente.

Instantes UTC em TEXT permitem roundtrip e comparação binária quando a largura/precisão são fixas. Epoch INTEGER também é viável, mas exigiria codec adicional entre os runtimes. A aplicação deve rejeitar formatos ambíguos na fronteira interna; um adaptador que recebe outro formato conhecido converte explicitamente antes. A granularidade contratual é de milissegundos; não truncar silenciosamente dados persistidos de precisão maior. A migração/codec terá teste próprio.

Datas financeiras não carregam fuso e não são convertidas para UTC. Ordem de revisões e sincronização continua definida por versão/cursor do servidor. Nenhuma decisão temporal aqui escolhe a duração da offline lease, retenção de backups ou prazo de exclusão.

DECIMAL_EXACT, adicional ao aceite mínimo, tem proposta de TEXT decimal canônico no SQLite e NUMERIC no PostgreSQL. Sem notação exponencial, zeros redundantes ou Number. O probe preserva frações maiores que centavos e dígitos além de 2^53; não implementa aritmética decimal, escala do produto ou agregações financeiras. Não ordenar/somar esse TEXT como número usando CAST REAL/NUMERIC. Aritmética pertence ao domínio/ports posteriores; o limite de 128 caracteres usado no probe é experimental, sem definir quota de produto.

MoneyMinor mantém a decisão existente: BIGINT PostgreSQL / INTEGER SQLite, ponte e JSON em strings decimais canônicas. As US-001/US-002/US-004/US-006 fornecem provas específicas; US-013 e US-027 ainda precisam transformar isso em regras de domínio e invariantes comuns.

## Contratos que os adaptadores devem preservar

- Repositórios recebem a transação/contexto, sem abrir outra conexão que perca SET LOCAL. Typed query não concede autorização e não transforma BIGINT em Number. Tipos TypeScript precisam refletir os tipos reais do driver.
- Não aplicar o driver SQLite padrão de uma biblioteca JavaScript ao cofre Rust/SQLCipher sem outro gate. Compartilhar domínio/contratos não exige compartilhar o mesmo driver ou ORM entre runtimes.
- Jobs têm semântica de entrega com possibilidade de repetição; o efeito de negócio é idempotente. Um lease expirado não autoriza o worker antigo a confirmar a mesma ação. Operações dependentes usam a transação de negócio apropriada.
- O worker revalida acesso, workspace, lifecycle e escopo na execução. Payload de fila evita documento original ou conteúdo financeiro desnecessário; logs usam somente metadados operacionais permitidos.
- O leitor PDF não executa conteúdo, links, scripts ou consultas externas. Extração não equivale a autorização fiscal. O arquivo selecionado pelo usuário não é apagado; somente a cópia temporária protegida do aplicativo é descartada.

## Demais pontos do ERD §21 e arquitetura §30

| Tema                       | Encaminhamento                                                                                                                                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IdP SaaS e identidade      | ADR-0020 permanece local; provider/custo, Google/Apple e runtimes reais continuam pendentes na US-003. Não escolher Keycloak de produção por associação.                                                                                                       |
| Mobile SQLCipher           | Android comprovado pelo ADR-0019; iOS exige Mac/Xcode e evidência própria. Não adotar node:sqlite dos instrumentos como cofre Mobile.                                                                                                                          |
| RLS                        | Manter ADR-008 e a evidência US-004 como defesa adicional à API. Schema de produto/policy engine e invariantes cross-engine ainda pendentes.                                                                                                                   |
| Sync payload               | US-005 comprova snapshots imutáveis no feed experimental. Proposta para US-131 a US-134: manter payload versionado ou referência imutável com leitura na revisão exata; nunca resolver página antiga pelo registro atual. Volume/retention exige gate próprio. |
| Busca                      | FTS PostgreSQL/FTS5 continuam propostas da arquitetura; corpus de acentos, isolamento, rebuild e escala antes da adoção nas histórias de busca.                                                                                                                |
| Particionamento/retention  | Sem novo particionamento neste corte; medir volume. DP-01/DP-02 bloqueiam somente regras de prazo afetadas.                                                                                                                                                    |
| Analytics, AWS, assinatura | Fornecedor/custo/HA, scrub e credenciais de assinatura de produção continuam pendentes antes do beta/distribuição. Nenhum serviço é provisionado pela consolidação.                                                                                            |

## Validação e limites

O [probe US-007](../../development/spikes/us-007-physical-decisions.md) usa SQLite 3.53.3 real do Node 24.19.0, fixtures e migração com checksum. As nove verificações cobrem atomicidade, UUID, FK, instantes, DATE, DECIMAL_EXACT, rollback e reabertura. O banco é removido; [evidência sanitizada](../../quality/evidence/us-007-physical-2026-10-16.json). O pnpm check contém 80 testes após esta história.

O SQLite desse instrumento não é SQLCipher. Esse resultado não homologa constraints/versões nativas, não mede TEXT versus BLOB em carga representativa e não substitui US-020/US-021/US-022/US-027. Os schemas anteriores de spikes não são migrados nem reinterpretados. A criação do schema financeiro real continua condicionada aos gates/invariantes da seção 22 do ERD.

O documento é a proposta concreta para revisão arquitetural. Não registra aprovação do usuário sobre prazo, fornecedor, criptografia de produção, implantação ou publicação.

Fontes primárias consultadas em 2026-10-16: [tipos SQLite](https://www.sqlite.org/datatype3.html), [STRICT tables](https://www.sqlite.org/stricttables.html), [datas SQLite](https://www.sqlite.org/lang_datefunc.html), [UUID PostgreSQL 18](https://www.postgresql.org/docs/18/datatype-uuid.html), [instantes PostgreSQL](https://www.postgresql.org/docs/18/datatype-datetime.html), [rusqlite 0.40.2](https://docs.rs/rusqlite/0.40.2/rusqlite/), [Kysely/driver e tipos](https://kysely.dev/docs/getting-started), [locks/queue no PostgreSQL](https://www.postgresql.org/docs/18/sql-select.html) e [PDF.js](https://mozilla.github.io/pdf.js/).
