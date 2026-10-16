# US-005 — Protocolo de sincronização entre dois clientes

História: [US-005](../../delivery/05-backlog.md), RF-29 a RF-31. Decisão e ameaças: [ADR-0022](../../architecture/adr/0022-spike-sincronizacao-dois-clientes.md). O objetivo é provar o protocolo mínimo com processos, disco e servidor reais.

## Executar

Pré-requisitos: Node 24.19.0, pnpm 11.25.0, Docker com engine Linux e porta loopback 43186 livre. Use apenas o checkout de desenvolvimento; os endpoints/nomes de banco são fixos e não aceitam conexão de produção.

```sh
pnpm install --frozen-lockfile
pnpm spike:sync:test
pnpm check
```

O runner inicia somente o projeto Docker financial-manager-us005. A imagem oficial PostgreSQL 18.6 Alpine está fixada por digest. Credenciais e sessões são geradas por execução. Dados PostgreSQL ficam em tmpfs; três perfis de réplica usam SQLite em .tools/us005-sync, com fixtures explicitamente sintéticas.

O teste inicia servidor Node HTTP em porta aleatória de 127.0.0.1. Cada comando dos clientes A/B/leitor roda em processo independente, abre o arquivo persistente e usa sessão própria. Não é uma simulação em memória de fila, banco ou protocolo PostgreSQL. HTTP sem TLS e SQLite sem criptografia são exceções exclusivas deste instrumento sintético.

Ao terminar, fecha transporte/pools, remove bancos locais/WAL/SHM, containers, rede e arquivos de credenciais. Se o processo coordenador for interrompido, execute:

```sh
pnpm spike:sync:down
```

O relatório local sanitizado fica em .tools/us005-sync/report.json. Nunca publique os arquivos privados ou stdout dos subprocessos, que transportam as fixtures em pipes. Somente o relatório validado pode ser copiado para docs/quality/evidence.

## Critérios exercitados

| Critério            | Verificação real                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema e isolamento | Migração interrompida não publica schema parcial; retry confere checksum; dez tabelas com FORCE RLS; workspace/conta/sessão não concedem acesso indevido.                           |
| Precisão            | Valor acima de 2^53 e extremos i64 atravessam JSON/SQLite/BIGINT PostgreSQL sem Number monetário.                                                                                   |
| Fila durável        | Processos encerrados abruptamente antes/depois do commit; reabertura distingue rollback e operação PENDING. Desconexão conserva proposta.                                           |
| ACK perdido         | Servidor confirma e derruba resposta HTTP; fila permanece pendente; retry retorna a mesma revisão sem duplicar.                                                                     |
| Idempotência        | Fingerprint verifica payload; ator/dispositivo são vinculados; reenvios concorrentes retornam o mesmo recibo.                                                                       |
| Merge               | Campos independentes convergem; relógios de cliente divergentes não escolhem vencedor.                                                                                              |
| Conflito            | Mesmo campo e alteração revertida não perdem proposta; base/local/remoto visíveis; fila em CONFLICT e servidor conserva revisão confirmada.                                         |
| Resolução           | Leitor vê aviso e não escreve; membro autorizado gera nova revisão auditada; resolução já consumida/desatualizada é recusada.                                                       |
| Exclusão            | Delete vs. edit e edit vs. delete conflitam; tombstone chega pelo feed; base zero antiga não recria registro; restauração exige resolução explícita.                                |
| Pull atômico        | Processo encerrado durante aplicação não avança cursor nem publica dados parciais; reabertura reaplica páginas e converge.                                                          |
| Push atômico        | Falha entre escrita e commit desfaz registro/revisão/feed/recibo; retry bem-sucedido cria só uma revisão.                                                                           |
| Concorrência        | 12 alterações do mesmo campo/base: uma APPLIED e 11 CONFLICT; 12 reenvios do vencedor não geram novas revisões. Sequências seguem commits.                                          |
| Paginação           | Página antiga contém snapshot daquela revisão; clientes chegam à mesma revisão, cursor e conjunto de conflitos dentro do escopo.                                                    |
| Revogação           | Membro, dispositivo e conta revogados não reenviam nem recuperam recibos; membro revogado também não faz pull. Proposta permanece em estado recuperável, sem publicação automática. |
| Rebootstrap         | Cursor abaixo do piso exige snapshot; nova geração rejeita push antigo e coloca fila anterior em quarentena; operação da nova geração sincroniza.                                   |
| Ambiente/logs       | Imagem/loopback/tmpfs verificados; nenhum segredo/sentinela financeiro nos logs PostgreSQL; limpeza de serviços, segredos e réplicas confirmada.                                    |

pnpm test inclui regressões de contrato/INT64, fila persistente, atomicidade/cursor, tombstone, geração e validação estrita da evidência. Elas não substituem pnpm spike:sync:test. O pnpm check não compila nem homologa as integrações nativas de sincronização.

## Resultado e limites

Homologação em 2026-10-16, Windows/Docker Desktop com PostgreSQL 18.6 Linux: [evidência](../../quality/evidence/us-005-sync-2026-10-16.json). A história é concluída no recorte experimental de push/pull/idempotência/tombstone/conflito; os fluxos de sincronização de produto continuam nas US-131 a US-134.

Integração OIDC/NestJS e adaptadores SQLCipher Desktop/Mobile, UI, operações financeiras dependentes, política de expiração offline, retenção/purga e escala continuam pendentes. Não se adota um prazo para DP-01 nem se concluem US-002/iOS ou US-003/provedores/runtimes com esta evidência.
