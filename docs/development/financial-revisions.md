# Revisões e versionamento financeiro — US-026

A [política manual US-041](manual-movements.md) consome applyGuarded dos adapters: um guard interno de host recebe plano e contas atuais, depois da autorização/escopo e antes de persistir, dentro da mesma transação. Não recebe SQL/conexão ou função do corpo HTTP/IPC. apply/revert mantêm o comportamento anterior. O registro abaixo preserva a fundação original.

A fundação implementa revisão atômica do agregado financial_transaction, incluindo rateios, tags e vínculos de conta/grupo/contraparte existentes. [Decisão, limites e ameaças](../architecture/adr/0037-revisoes-financeiras-atomicas.md). É um serviço interno; rotas HTTP, interface de histórico/conflito e integração dos cofres/replicas seguem nas histórias consumidoras.

## Entradas e autorização

domain/revisions contém os codecs/plano puros. finance-ports/revisions fornece createRevisionService e os contratos para adapters confiáveis. persistence-postgres/revisions exporta createPostgresRevisionService; storage-schema/revisions exporta createSqliteRevisionService. API e worker oferecem createApiRevisionModel/createWorkerRevisionModel com identidade segura do host US-023. Não instalam banco, autenticação ou permissões por padrão.

O host injeta authorize, identidade/relógio, change_source e pool/conexão. Cada comando recebe workspace_id e, para CLOUD, principal_id interno autenticado. O grant retorna autoridade, can_write, lista de contas (null para todas, [] para nenhuma) e ator/dispositivo. Ele não vem do corpo HTTP. LOCAL usa request sem principal e actor_id null, verifica storage_mode LOCAL e não cria cloud_user/workspace_member fictícios. CLOUD exige provider de sessão/membership/dispositivo apropriado; o exemplo de teste usa autorização exclusivamente sintética.

apply recebe um lote de mudanças com id, base_revision e content completo: conta, data/valor/tipo econômico, proveniência/nome, contraparte/grupo, deleted, rateios e tags. IDs são canônicos; dinheiro e versões são strings i64. A criação usa base 0; alterações usam a versão atual. Arrays são capturados/normalizados antes de await. Não altere proveniência existente ou envie snapshots/timestamps/atores no lugar do conteúdo permitido.

O lote deve conter entre 1 e 10000 IDs únicos. Um lote maior é recusado antes de autorização/storage; o serviço não faz commits parciais para contornar o limite. Esse teto é um limite técnico explícito, não uma medição de throughput. Os futuros transports/importadores precisam controlar bytes/tempo e respeitar a atomicidade de seus efeitos completos.

## Resultados e conflitos

Cada mudança relevante incrementa version e insere snapshot format_version 1 com base_revision/before/after na mesma transação. No-op mantém a versão e não cria revisão. O retorno contém IDs/versões/changed, sem conteúdo financeiro. VERSION_CONFLICT preserva o estado confirmado; não ocorre merge ou last-write-wins. A solução de conflitos de produto e os recibos de replay ainda precisam de suas histórias próprias.

revert recebe id, base_revision atual e revision_version atual. Exige que o after histórico corresponda ao estado presente e cria uma revisão nova com o estado anterior. Edição posterior falha com REVERSAL_CONFLICT. Desfazer criação resulta em exclusão lógica. Snapshots legados desconhecidos não são sobrescritos nem interpretados por aproximação; a próxima edição captura o estado observado em before. O número da versão continua sendo a ordem funcional, inclusive sob regressão do relógio.

Transferências e pagamentos de cartão exigem todos os membros do grupo no mesmo lote, com bases corretas. As duas pernas e o estado de exclusão precisam ser coerentes; falhas antes do commit revertem todo o lote, inclusive uma revisão já inserida antes da falha seguinte. Perda de ACK do commit exige consultar o resultado; base obsoleta evita reaplicar silenciosamente, e o recibo idempotente ainda precisa de integração. Contas atuais/destino/restauração devem permanecer no grant. O futuro undo de import_batch também precisará validar conciliações, referências e efeitos externos antes de restaurar versões.

## Ciclo de vida e hosts

O PostgreSQL usa role esperada sem owner/BYPASSRLS, contexto SET LOCAL, lock transacional por workspace, locks dos registros e UPDATE condicional por versão. Somente composition roots instalam o adapter; módulos consultam seu próprio conjunto de tabelas. Não abra uma unidade de revisão dentro de uma unidade de leitura/escrita: o contexto compartilhado recusa a operação. close bloqueia novas chamadas, drena trabalho admitido e encerra o pool somente com owns_pool true.

O SQLite recebe um handle exclusivo já desbloqueado pelo host. BEGIN IMMEDIATE e fila do serviço serializam suas unidades. Evite compartilhar o handle com outras unidades ou leituras transacionais durante a operação. Falha de rollback envenena o serviço; o host deve descartá-lo/fechar a conexão. close do serviço drena trabalho e conserva o handle emprestado. Rust/Tauri precisa de binding próprio por comandos estreitos; esta interface SQL interna não deve ser exposta ao WebView. Expo/Rust/SQLCipher reais ainda precisam de adoção/homologação do incremento.

Nenhum writer novo está conectado a um handler de produto, fila ou outbox. Antes de expor escrita cloud/offline, a composição deve integrar recibo/feed/outbox/tombstone no commit correspondente e verificar a política real de acesso. Estes snapshots/versionamentos não substituem esses mecanismos. Não há alteração de schema: a migração atual v2 já possui os campos necessários.

## Reprodução

```sh
pnpm install --frozen-lockfile
pnpm revisions:test
pnpm revisions:clean
pnpm check
```

O runner usa FIN-002 v1, PostgreSQL 18.6 e SQLite 3.53.3 com migrations v2, porta loopback 43221 e projeto financial-manager-us026. Não execute simultaneamente protocolos US-021/022/024/025 que compartilham essa porta. As permissões adicionais são de fixtures isoladas; a migração de produto conserva default deny/RLS/FORCE RLS. Todos os dados são sintéticos.

Os [28 gates](../quality/evidence/us-026-revisions-2026-10-16.json) cobrem edição/no-op/snapshots, base obsoleta/reversão, criação/exclusão/restauração, grupos/classificação, i64, autorização, falha atômica, concorrência e histórico/relógio nas duas engines; tipos/fronteiras, migrations/geração, goldens, local sem identidade cloud, backend PostgreSQL encerrado, API/worker/revogação, reabertura, logs/limpeza completam o protocolo. Quatorze testes Node acompanham a fundação, incluindo uma unidade com 65 mudanças e recusa de 10001 antes de storage.

Artefatos privados ficam em .tools/us026-revisions e são ignorados. Banco/journals, senha, contêiner e rede próprios são removidos; clean recusa Docker remoto, paths ligados, lock ativo e dono/imagem divergentes. Relatórios contêm somente gates, versões, datas, pendências e hashes de fontes. Nenhum snapshot, parâmetro, dado pessoal ou segredo é arquivado. A nova CI está configurada; execução remota pendente. Próxima história: US-027, suíte de invariantes cross-engine.
