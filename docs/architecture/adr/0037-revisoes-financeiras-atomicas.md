# ADR-0037 — Revisões financeiras atômicas

Data: 2026-10-16. História: US-026. Status: fundação de versionamento validada em PostgreSQL e SQLite; integração dos fluxos de produto pendente.

Complementa RF-14/RF-30, o modelo de transaction_revision e os ADRs 0034/0035/0036. O escopo é o agregado financial_transaction com as relações existentes no núcleo. Não versiona automaticamente contas/categorias/referências nem implementa a reversão integral de import_batch, merge de sincronização ou suas interfaces. Os sete originais e DP-01 a DP-04 permanecem preservados.

## Decisão

domain/revisions fornece codecs, plano determinístico e snapshots; finance-ports/revisions coordena autorização, leitura, validação, gravação e reversão. Os adapters PostgreSQL/Kysely e SQLite executam o plano e o append da revisão na mesma transação. API/worker possuem composition roots explícitos; o port não expõe SQL ou callback de transação ao chamador do comando. A entrada principal dos ports de leitura conserva sua API e transação READ ONLY.

version e base_revision são strings decimais canônicas de inteiros i64. Criação exige base 0 e gera versão 1. Alteração exige igualdade com a versão atual e gera n+1; base desatualizada falha mesmo se a proposta se parecer com o estado atual. Overflow é recusado. Um no-op não altera versão, timestamp ou histórico. O lote é não vazio, tem IDs únicos e limite explícito de 10 mil alterações, compatível com o corpus de importação; excedê-lo falha antes de autorização/storage. Não há divisão silenciosa em commits parciais, promessa de desempenho de importação ou limite ilimitado de recursos. Limites de bytes/tempo do transporte pertencem à integração dos handlers.

snapshot.format_version 1 contém base_revision, before e after canônicos. São preservados valor/data/conta, origem/descrição/nome, contraparte/grupo, exclusão lógica, versões/instantes, rateios com notas e IDs das tags. Dinheiro e versões permanecem strings em JSON; arrays são ordenados e congelados. A revisão tem ator/dispositivo/origem da alteração em colunas próprias, provenientes do host autorizado. Ela é histórico financeiro protegido; não é payload de audit_event ou log operacional.

Não há mudança de schema: usamos version e o snapshot JSON já previstos na migração v1, com o catálogo atual v2. Registros legados não recebem histórico inventado. A primeira alteração registra seu estado observado em before, mesmo que não exista uma revisão inicial canônica. Snapshots antigos desconhecidos permanecem imutáveis; tentar revertê-los falha com INVALID_SNAPSHOT. O envelope novo tem versão independente do schema e do dataset.

## Concorrência, relações e reversão

No PostgreSQL, o runtime precisa ser a role esperada, sem owner/superuser/BYPASSRLS. SET LOCAL aplica workspace/UTC/DateStyle no mesmo client. Um advisory lock transacional por workspace coordena os writers desta fundação; FOR UPDATE estabiliza os registros/grupos. UPDATE inclui workspace/id/version e verifica a linha retornada antes de persistir relações e histórico. Falhas antes do commit, inclusive na segunda revisão de um grupo ou encerramento do backend após UPDATE, fazem rollback do conjunto. Conexões com erro são descartadas pelo wrapper de pool. Perda de ACK do próprio commit pode deixar o resultado desconhecido para o chamador: estado e histórico continuam atômicos, mas é preciso consultar o resultado antes de repetir; o recibo de replay pertence à integração de idempotência. RLS/FORCE RLS e FKs compostas continuam ativas, sem grant/policy de produto novo.

No SQLite, uma conexão exclusiva do host executa BEGIN IMMEDIATE; a fila do adapter serializa unidades sobre esse handle. O host não mistura outras unidades/leituras transacionais na mesma conexão enquanto ela está em uso. Falha de rollback envenena a instância e bloqueia novas operações até seu descarte. A conexão é emprestada: close encerra o serviço/aguarda trabalho admitido, e o host fecha o handle. PostgreSQL compartilha um guard de contexto entre unidades de leitura/escrita para recusar abertura aninhada e evitar deadlock com pools pequenos.

Alterações de transferências/pagamentos exigem todos os membros e validam as duas pernas no estado final. Grupos ausentes, quebrados, não suportados ou propostas parciais falham integralmente. Uma transação agrupada não é removida do grupo por atalho. Valores e rateios são validados com BigInt/strings, sem float. Original_description e origin_kind existentes são preservados; correção explícita de proveniência requer um caso de uso próprio.

Revert exige a revisão atual exata e compara seu snapshot after com o estado presente. Edição posterior produz REVERSAL_CONFLICT. O estado anterior é restaurado como nova versão, mantendo as alternativas anteriores; desfazer uma criação faz exclusão lógica. As mesmas regras de grupo/conta se aplicam à reversão. A futura reversão de importação ainda precisa validar efeitos, conciliações e referências externas, orquestrando suas próprias tabelas. Este port não declara RF-14 completo.

Relógio não decide conflitos ou base_revision. updated_at/deleted_at novos são limitados inferiormente pelo instante técnico já registrado para respeitar as constraints sob regressão de relógio. created_at da revisão preserva a leitura UTC canônica do relógio, que pode recuar. A ordem funcional é version, não o relógio ou a cauda aleatória do UUID. IDs novos de revisão usam o gerador seguro US-023; IDs existentes são preservados.

## Autorização, fronteiras e ameaças

authorize é obrigatório e confiável, chamado a cada unidade, inclusive worker/retry. O request capturado contém workspace e principal interno opcional; o grant congelado fornece can_write, contas, autoridade e ator. CLOUD exige principal e não aceita LOCAL_USER. LOCAL dispensa principal remoto, usa ator local/sistema sem actor_id e exige workspace físico LOCAL. Declarar autoridade local não permite escrever numa réplica CLOUD. O provider real deve verificar sessão, membership, dispositivo/lease e estado do workspace; nenhuma política offline ou enum de papel foi escolhido aqui.

Tanto a conta atual quanto a de destino/restauração precisam estar autorizadas. Leituras internas necessárias à validação ficam no mesmo escopo e não são retornadas como dados financeiros. O retorno expõe somente changed/id/base/versão/id da revisão. Snapshots não são oferecidos por um endpoint de histórico; o futuro leitor deverá autorizar as contas presentes em before/after antes de mostrar conteúdo histórico.

As regras de arquitetura registram somente os módulos writers necessários, mantendo dono de tabela. Kysely continua tipado; SQLite aceita SQL estático parametrizado e verifica ownership/join do pai. Casts de projeção SQLite são validados pelo domínio; any, drivers entre módulos, SQL dinâmico e escrita em módulos read-only continuam proibidos. Isso detecta regressões de arquitetura, sem isolar código malicioso dentro do processo.

A avaliação cobre sobrescrita concorrente, revisão sem alteração correspondente, meia transferência, reversão destrutiva, troca de conta/workspace, autoridade local forjada, request/grant mutados durante await, origem/ator forjados e erro sensível. Erros públicos são códigos fixos, sem cause, SQL, parâmetros ou snapshots. Clock/entropy/pool/provider do host continuam confiáveis. A integração de produção deve configurar listeners seguros, timeouts/TLS e ligar os fluxos aos ports; não existe conexão/seed de produção por padrão.

## Evidência e integrações

O [protocolo](../../development/financial-revisions.md) passou em [28 gates reais](../../quality/evidence/us-026-revisions-2026-10-16.json): nove cenários por engine e dez gates de tipos/migrations/fixtures, goldens, local anônimo, processo PostgreSQL perdido, API/worker, reabertura e logs/limpeza. Quatorze testes Node cobrem codecs, política, captura, rollback, fronteiras, lote limitado e evidência. O teste de 65 comandos verifica uma unidade única; não é benchmark de 10 mil gravações. A CI repete o protocolo, com execução remota deste incremento pendente.

Novas dependências de produção são apenas internas: storage-schema usa domain e finance-ports para compartilhar o plano/coordenador sem duplicar regras nos adapters. Nenhuma biblioteca externa nova foi adicionada. O adapter SQLite é portátil por interface, testado com Node SQLite; não é bridge SQL genérico para WebView. Adoção em Rust/Expo/cofre e homologação Native/iOS permanecem nos gates próprios.

Handlers/policy engine, recibos de idempotência, outbox/feed/tombstones e interfaces de conflito/importação ainda não estão ligados a estes comandos. Repetição com base antiga retorna conflito; não é recibo de replay. A composição cloud/replica de produto deve integrar os efeitos de sync atomicamente antes de expor escrita. Não substituímos esses mecanismos por updated_at, snapshot ou last-write-wins, nem declaramos RF-29/30/31 ou US-027 completos.
