# ADR-0022 — Sincronização experimental entre duas réplicas

- Data: 2026-10-16
- Status: Validado como spike; integração ao produto pendente
- História: US-005; subsidia US-007 e US-131 a US-134
- Substitui: nenhum; preserva ADR-009 e as decisões pendentes

## Contexto

A [US-005](../../delivery/05-backlog.md) pede push/pull, idempotência, tombstone e conflito de mesmo campo sem perda silenciosa. RF-29 a RF-31 do [PRD](../../product/01-prd.md) exigem persistência da fila após desconexão/reinício, revalidação de acesso, comparação base/local/remota e resolução com nova revisão. A seção 13 da [arquitetura](../04-technical-architecture.md) define geração, feed ordenado e cursor aplicado em transação local. DP-01 permanece aberta: o experimento não escolhe 24 horas nem sete dias para acesso offline.

## Decisão experimental

Implementar o servidor isolado em apps/api/spikes/us-005, com PostgreSQL 18.6 real e o pg 8.23.1 já adotado na US-004. O runner usa somente o banco us005 em 127.0.0.1:43186, com imagem oficial fixada por digest, tmpfs e senhas novas por execução. Não há nova dependência de produção ou credencial externa.

Dois processos Node independentes representam as réplicas A/B; um terceiro perfil somente leitor exercita autorização. Cada comando abre seu próprio arquivo SQLite persistente. node:sqlite é apenas instrumento com dados sintéticos, sem criptografia: não substitui os cofres SQLCipher das US-001/US-002. A fila contém a proposta imutável e seu estado; a visão confirmada só recebe revisões do servidor. A interface otimista/totais de produto fica para as histórias correspondentes.

Um transporte HTTP exclusivamente loopback usa sessões sintéticas aleatórias em memória, passadas aos subprocessos por stdin. O corpo nunca concede identidade ou dispositivo; o servidor associa a sessão a user_id/device_id e consulta membership, dispositivo e escopo por conta na base. Não integra OIDC, NestJS, Tauri, Expo ou Web. Não é um endpoint publicável de produção.

packages/sync-core permanece sem API provisória: o contrato experimental depende de registro sintético com amount_minor, description e date. Extrair o protocolo independente dos adaptadores e integrá-lo aos modelos financeiros exige a decisão da US-007 e as histórias de produto.

## Atomicidade e ordenação

Cada push usa um client PostgreSQL e uma transação READ COMMITTED. O contexto workspace/user é LOCAL e parametrizado. O servidor bloqueia a linha do workspace antes de validar geração e operações. Também bloqueia membership, dispositivo e escopos para manter a autorização estável até o commit. O port administrativo sintético segue a mesma ordem de locks.

A serialização por workspace é uma escolha simples do spike; não há alegação de throughput para produção. Incrementar uma sequence independente de commit poderia publicar posições fora de ordem. Aqui o lock é mantido até concluir registro, revisão, feed, tombstone, recibo e eventual resolução. Falha em qualquer etapa desfaz tudo. Pull/snapshot usam o mesmo lock para obter uma visão consistente do stream.

O recibo tem unicidade por workspace/geração/operation_id, fingerprint canônico da proposta e vínculo com ator/dispositivo. Acesso e geração são revalidados antes do replay. Repetição igual retorna o resultado original; payload diferente é rejeitado. O teste perde a conexão HTTP depois do commit e confirma que o reenvio não cria revisão/feed adicional. Há também reenvios concorrentes do mesmo identificador.

Feed armazena o snapshot imutável de cada revisão, incluindo deleted, evitando buscar o estado atual ao paginar revisões antigas. Cursor e versão são BIGINT no servidor e strings decimais no JSON. Valores monetários são strings canônicas, validados com BigInt; a coluna monetária PostgreSQL é BIGINT gerada a partir do snapshot. Os extremos i64 e um valor acima de Number.MAX_SAFE_INTEGER têm ida/volta exata.

Na réplica, outbox e sua proposta são persistidas juntas. Aplicação do feed, conflitos e avanço de cursor usam BEGIN IMMEDIATE/COMMIT, WAL e synchronous=FULL. A homologação encerra processos abruptamente antes/depois do commit da fila e antes do commit do pull. Reabrir recupera somente a transação confirmada. Isso não simula perda física de energia ou corrupção de disco.

## Conflitos e exclusões

Merge usa a união dos campos alterados desde base_revision, incluindo alterações depois revertidas. Campos disjuntos geram MERGED; mesmo campo, criação concorrente e exclusão concorrente geram CONFLICT. client_timestamp é informativo e não participa da decisão. O teste usa relógios deliberadamente divergentes.

O conflito guarda base, proposta local e revisão remota; o servidor conserva o último estado confirmado. Leitor vê o conflito dentro de seu escopo e não o resolve. Resolução exige escrita, conflito aberto e base igual à revisão atual. Cria nova operação/revisão com source=SYNC_RESOLUTION e ator/dispositivo; revisões anteriores e propostas permanecem preservadas. Se outro commit avançou a revisão, a resolução deve ser reapresentada.

Excluir cria tombstone e evento com deleted=true. Clientes antigos não recriam silenciosamente um ID excluído: até base zero gera conflito. Recuperar um registro excluído exige resolução explícita com snapshot completo. O experimento mantém registros/revisões/tombstones; não implementa purga física nem adota os 90 dias propostos de retenção do feed.

Cursor abaixo do piso sintético ou geração diferente retorna SNAPSHOT_REQUIRED. O piso é avançado explicitamente no teste, sem alegar passagem de prazo. Nova geração rejeita push anterior com STALE_GENERATION. Rebootstrap substitui a visão confirmada e coloca operações pendentes da geração anterior em QUARANTINED, sem rebase automático. O teste de geração não implementa migração local/cloud, restauração cloud ou troca real de autoridade.

## Ameaças e limites

| Fronteira    | Ameaça                                                        | Controle e limite                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Autorização  | Sessão, workspace, dispositivo ou conta forjados              | Sessões sintéticas vinculadas no servidor, validação de participação/dispositivo/escopo e RLS ENABLED/FORCED em dez tabelas; testes de leitor e revogação. Identidade OIDC de produção pendente.             |
| Banco        | SQL sem filtro ou mutação de ACL                              | Runtime sem ownership/BYPASSRLS; RLS por workspace/conta; tabelas de autorização permitem locks, mas WITH CHECK(false) proíbe sua atualização pelo runtime. Sem DDL/TRUNCATE/DELETE de histórico no runtime. |
| Confiança    | Credencial runtime ou servidor comprometidos                  | GUC não é identidade criptográfica; código servidor é confiável. Não há endpoint SQL genérico. Este recorte não promete resistir a SQL arbitrário ou administrador do host.                                  |
| Concorrência | Feed fora da ordem de commit, replay ou última escrita oculta | Lock por workspace, recibos duráveis, transação por operação e conflitos explícitos; 12 pushes simultâneos e 12 reenvios concorrentes.                                                                       |
| Exclusão     | Cliente antigo ressuscita registro                            | Tombstone, histórico e comparação com exclusão; rebootstrap obrigatório para geração/cursor inválidos. Purga real pendente.                                                                                  |
| Revogação    | Reenviar operação já recebida após perder acesso              | Revalidar membro, dispositivo e conta antes de consultar recibo; estado REVOKED conserva proposta sem publicação automática. Limpeza/lease do cache de produto pendentes.                                    |
| Disco local  | Fixture fora de cofre ou resto após falha                     | Apenas dados sintéticos em .tools ignorado; remoção dos arquivos SQLite/WAL/SHM no finally e no comando down. SQLCipher continua obrigatório nos adaptadores de produto.                                     |
| Logs         | Payload, token, senha ou erro SQL nos logs                    | Transporte/runner só emitem códigos fixos e nomes de etapa. PostgreSQL suprime SQL/parâmetros de erros; stdout/stderr são inspecionados em memória para sentinelas, sem persistir o conteúdo bruto.          |
| Ambiente     | Expor PostgreSQL ou manter dados de teste                     | Endpoint loopback, usuário sem capabilities, somente password file em bind readonly, dados em tmpfs, teardown verificado. Bridge dedicada não promete bloquear toda saída de rede.                           |

RLS do spike não substitui a policy engine. Este contrato só cobre alteração de um registro sintético por operação; transferências e outras mutações financeiras dependentes exigem agregados/transações de domínio próprios. Não entrega UI de conflitos, cache Web offline, escala, protocolo de dispositivo hostil ou quotas.

## Evidência e fontes

O [protocolo](../../development/spikes/us-005-sync.md) e a [evidência sanitizada](../../quality/evidence/us-005-sync-2026-10-16.json) registram a execução real. Gate separado do pnpm check e job two-client-sync configurado na CI; execução remota pendente.

Fontes primárias consultadas em 2026-10-16: [SQLite no Node 24](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html), [locks PostgreSQL 18](https://www.postgresql.org/docs/18/explicit-locking.html) e [transações node-postgres](https://node-postgres.com/features/transactions). A API node:sqlite desta versão é experimental e fica restrita ao instrumento.
