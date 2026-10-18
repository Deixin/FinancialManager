# ADR-0056 — Categorias compartilhadas por workspace

Data: 2026-10-18. Estado: adotado no núcleo compartilhado da US-044; integração Desktop pendente.

## Contexto

A US-044 e RF-15 exigem sugestões por finalidade que possam ser renomeadas e arquivadas sem afetar outro workspace ou apagar referências históricas. O schema v2 já possui category, unicidade normalizada entre categorias ativas e is_seeded; não possui versão monotônica ou trilha de alterações de categoria.

## Decisão

Política pura em domain/categories, serviço de aplicação em finance-ports/categories e adapters próprios PostgreSQL/SQLite mantêm o workspace como fronteira. A autorização separa leitura e gestão; modo LOCAL dispensa identidade cloud e modo CLOUD exige principal e RLS. Nenhuma rota de escrita de produto em nuvem é habilitada neste incremento.

O perfil explícito v1 oferece nove sugestões PERSONAL, nove BUSINESS e duas genéricas OTHER. Os nomes e escopos estão no catálogo imutável categoryDefaults. A finalidade é confirmada no banco. Seed somente em catálogo vazio; repetição exata dos mesmos IDs e metadados é no-op. Qualquer edição, arquivamento ou categoria adicional impede reaplicação, preservando escolhas anteriores. O consumidor deve guardar os IDs de uma intenção até conhecer seu resultado.

CREATE fixa is_seeded=false e UPDATE permite apenas nome, ordem e estado. Escopo e proveniência permanecem imutáveis. Não há exclusão física. Arquivamento preserva transações, alocações, subcategorias e histórico; nomes podem ser reutilizados após arquivar, mas a reativação exige unicidade ativa. REORDER exige bases completas de todas as categorias ativas e uma permutação dos mesmos IDs; arquivadas ficam intactas. sort_order respeita inteiro assinado de 32 bits. Nomes novos têm até 120 unidades UTF-16 e recusam controles; nomes legados inalterados são preservados.

Bases comparam todos os metadados dentro da transação; divergência produz conflito explícito, sem sobrescrita automática. Isso não detecta ABA (alterar e voltar ao mesmo valor). Versão, auditoria, outbox/feed e recibos duráveis de categoria exigem incremento posterior antes de expor escrita cloud de produto.

SQLite usa conexão dedicada por serviço, fila e BEGIN IMMEDIATE; PostgreSQL valida papel sem privilégios de owner/superuser/bypass, contexto de workspace e advisory lock 6026, compartilhado com as operações financeiras existentes. Cada lote é validado antes das escritas e confirmado atomicamente. Leituras recusam mais de 10 mil categorias ou snapshots acima de 4 MiB de texto JSON, sem truncamento.

Normalização conserva a regra existente NFKC, espaços e minúsculas e o corpus português/fullwidth homologado. PostgreSQL mantém sua coluna gerada; SQLite deriva normalized_name na escrita. Não há promessa de equivalência para todo Unicode/locale; expansão requer corpus e decisão específica conforme o gate existente da US-021.

## Consequências e verificação

Sem dependência de produção, migration, formato de backup ou comando IPC novo. A US-044 segue em andamento: o próximo incremento integra comandos, paridade Rust e tela Desktop. US-045/046 continuam responsáveis por subcategorias, tags e associação/rateio.

O protocolo em infra/categories executa cenários reais nos dois bancos: seed/replay, preservação financeira, nomes normalizados, base forjada, autorização, concorrência, captura antes de await, close, rollback de seed/reordenação, isolamento RLS e recusa de owner. Evidências contêm somente flags, versões, pendências e hashes; recursos e credenciais sintéticos são descartados. Consulte o [guia](../../development/categories.md).

DP-01 a DP-04 permanecem abertas. Homologações humanas ocorrem após integração completa, conforme ADR-0044 e instrução do usuário.
