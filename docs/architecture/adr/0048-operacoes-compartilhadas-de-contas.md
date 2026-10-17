# ADR-0048 — Operações compartilhadas de contas

Status: adotado para a fundação da US-040. A história permanece em andamento até integrar IPC/telas Desktop. Homologação humana após integrar todo o sistema, conforme [ADR-0044](0044-homologacao-humana-apos-integracao.md).

Data: 2026-10-17. Referências: RF-05/07, CT-01/02/03/05, US-040, [ports](0035-ports-e-repositories-por-modulo.md), [revisões](0037-revisoes-financeiras-atomicas.md) e [guia](../../development/financial-accounts.md).

## Decisão

Implementar captura, validação e plano puros em Domain; coordenação autorizada e leitura de saldo em finance-ports; persistência exclusiva do módulo accounts em PostgreSQL/Kysely e SQLite. Accounts possui financial_account e balance_reference. A consulta de movimentos usa o port de transactions na composição, sem SQL cruzado entre módulos. Não adicionar dependência, schema ou migração: o schema v2 já contém os campos e histórico de referências necessários. Não há novos comandos Tauri, endpoints HTTP ou credenciais de produto.

CREATE recebe UUIDv7 de conta e referência opcional, nome/instituição, tipo, natureza e BRL. Capturar antes de aguardar autorização; rejeitar campos desconhecidos e, em valores novos/alterados, controles ou nome/instituição vazios/acima de 120 caracteres. Metadados legados válidos no schema são lidos e preservados literalmente quando inalterados, inclusive durante arquivamento; a correção explícita passa pelos limites atuais. Cartão/empréstimo simples representam passivos; corrente/poupança/digital/dinheiro/investimento simples representam ativos; OTHER permite ambas as naturezas. Valores usam strings i64 canônicas; negativos são permitidos, por exemplo cheque especial ou crédito no cartão. Sem referência não presumir saldo inicial zero completo. Data e posição START_OF_DAY/END_OF_DAY são explícitas quando há valor.

UPDATE aceita nome, instituição e ACTIVE/ARCHIVED, com base contendo todos os metadados persistidos. Tipo, natureza, moeda e identidade permanecem de criação neste incremento, evitando reinterpretar movimentos existentes. Arquivar/reativar não exclui movimentos ou referências. Não há DELETE físico. Referência nova mantém IDs próprios; substituir exige o ID ainda ACTIVE e conserva valores/data/posição/criação anteriores como SUPERSEDED. Adicionar outro ponto sem substituição preserva os pontos ativos anteriores. Não criar receita, despesa ou ajuste automaticamente.

Cada operação executa em uma transação. PostgreSQL valida login/role sem superuser/BYPASSRLS/owner, usa contexto SET LOCAL, RLS e o mesmo advisory lock por workspace das revisões financeiras, além de bloqueio da conta. SQLite exige conexão exclusiva, FK/triggers habilitados e BEGIN IMMEDIATE; fila serializa operações da instância e rollback falho impede reutilização pelo serviço. O host deve descartar a conexão nessa condição. Não há last-write-wins: base obsoleta ou referência já substituída produz conflito explícito.

Criação repetida com o mesmo ID/conteúdo e referência não duplica. UPDATE com estado desejado já presente é no-op. Repetir a referência já registrada com os mesmos valores não a reativa nem altera uma correção posterior. Isso reconcilia estado de operações locais; não é recibo durável de transporte ou prova de autoria/linhagem. Metadados usam comparação de valores, sem versão monotônica nem detecção de ciclo A→B→A. Auditoria de contas, versão/outbox e recibos de comando serão integrados antes de expor escrita cloud/sync. Identidades de recursos não autorizam acesso.

## Saldo e conferência

readCalculatedAccountBalance exige unit que declare snapshot_consistency. A factory PostgreSQL oferece snapshot: true com transação REPEATABLE READ/READ ONLY; o default anterior READ COMMITTED permanece para os consumidores existentes. Ler conta, todas as referências e todas as páginas de movimentos na mesma unit. Páginas continuam limitadas a 100, sem truncar o total; cursor repetido falha. Snapshot é uma capacidade do adaptador confiável, não uma flag de HTTP ou IPC.

Selecionar a referência ACTIVE mais recente até a data consultada, preferindo END_OF_DAY a START_OF_DAY no mesmo dia. Domain aplica a convenção de sinais e o corte temporal já homologados; referências futuras não viram saldo passado. Movimentos excluídos não vêm do port; staging não pertence à tabela financeira confirmada. Apresentar contagem de registros considerados, referência e avisos de incompletude. A camada confiável deve fornecer a cobertura de histórico; a futura UI não poderá declarar COMPLETE por conta própria. compareAccountBalance fornece diferença exata, sem escrita ou ajuste automático; overflow i64 é rejeitado.

## Ameaças, alternativas e consequências

Confusão de workspace/conta é mitigada por autorização anterior ao storage, cópia do grant, escopo em toda query e RLS mantida. Criar exige capacidade própria e escopo de contas completo; ter acesso a uma conta existente não autoriza criar outra. LOCAL não aceita identidade cloud; CLOUD exige principal e autoridade persistida compatível. Providers de autorização são configuração interna confiável; não vêm do cliente e não concedem grants SQL de produto.

Falha após criar a conta ou superseder referência pode deixar metade do estado se não houver transação. Os dois caminhos são exercitados nas duas engines, comparando snapshots completos com institution_name incluído. O oráculo antigo de FIN-002 segue intacto; não foi alargado silenciosamente para aparentar cobertura desse campo. Erros são fechados, sem causas SQL, valores ou descrições.

Somar páginas em READ COMMITTED poderia misturar estados de duas gravações. A opção explícita de snapshot evita mudar a política dos consumidores anteriores e permite teste com commit independente durante a leitura. Um índice/saldo materializado e uma migração de versionamento agora aumentariam escopo e compatibilidade de backup sem necessidade para este recorte; ficam para sua integração correspondente. Não se declara API/worker, Tauri, Expo ou Next.js conectados por build TypeScript.

## Evidência e pendências

O protocolo real reutiliza os 28 gates de regressão de revisões e acrescenta 21 de contas: oito por engine, equivalência do estado/histórico, sete goldens de saldo via ports PostgreSQL, snapshot durante commit independente, recusa de owner/nesting e SQLite local sem identidade. Usa somente FIN-002/SYNTHETIC, Docker Linux local isolado e SQLite descartável; recursos próprios são removidos antes do sucesso. As evidências e comandos estão no guia.

US-040 continua em andamento. Próximo incremento: integrar a base ao Desktop SQLCipher com IPC estreito e CT-01/02/03/05, mantendo limpeza por workspace/bloqueio, captura do pedido e ausência de storage no navegador. Ajuste financeiro identificado depende das movimentações US-041; escrita cloud, outbox, recibos, linhagem/auditoria e paridade Mobile/Web preservam seus gates. Sete documentos originais e DP-01 a DP-04 permanecem intactos.
