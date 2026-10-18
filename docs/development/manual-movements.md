# Movimentações manuais — fundação US-041

A integração Desktop local foi acrescentada no [guia US-041](desktop-movements.md), com dois comandos específicos Tauri e política Rust validada contra o núcleo. O restante desta página registra a fundação compartilhada anterior; sua ausência de IPC na entrega original não descreve mais o Desktop atual.

O núcleo compartilhado oferece CREATE, EDIT, DELETE, RESTORE e ADJUST por comandos fechados. O [ADR-0050](../architecture/adr/0050-politica-de-movimentacoes-manuais.md) define política, ameaças e limites. A UI Desktop continua na US-040; MV-02/03/05 e o IPC financeiro serão o próximo incremento da US-041. Build TypeScript não comprova integração Tauri.

Use createManualMovementService com um createSqliteRevisionService ou createPostgresRevisionService configurado pelo host. Importe os subpaths manual-movements de domain e finance-ports. O serviço usa applyGuarded do adapter existente; não compartilhe uma conexão SQLite com outro serviço concorrente. Feche o adapter para drenar operações; não há conexão, credencial ou autorização instalada implicitamente.

CREATE/EDIT recebem conta com id/workspace_id/currency_code/account_kind/balance_nature/status, financial_date, amount_minor positivo, movement_kind INCOME/EXPENSE e display_name. CREATE também recebe id UUIDv7 e original_description nullable. EDIT recebe base RevisionState completa. DELETE/RESTORE recebem somente base. ADJUST recebe id UUIDv7, conta, data, delta_minor assinado e reason obrigatório; o delta é variação do saldo exibido, inclusive em passivos. Não derive ajuste automaticamente de uma divergência sem confirmação de produto.

Descrição original e relações permanecem no histórico. Só uma alocação pode ser redimensionada automaticamente; rateios múltiplos ou troca de tipo já classificado exigem revisão própria. Conta arquivada, base alterada, origem não manual ou grupo composto são recusados. Após erro de ACK, consulte o estado e revise antes de reenviar: intenção antiga retorna conflito, sem duplicar ou ressuscitar revisões posteriores. Não existe recibo de transporte novo.

## Reprodução

```sh
pnpm install --frozen-lockfile
pnpm build
node infra/manual-movements/run.mjs
node infra/manual-movements/clean.mjs
pnpm check
```

Docker Linux local, PostgreSQL 18.6 e Node SQLite 3.53.3 seguem os protocolos existentes. A porta sintética 43221 é compartilhada com schema/repositories/revisões/invariantes/contas: execute esses protocolos sequencialmente. O projeto financial-manager-us041-manual e a raiz .tools/us041-manual-revisions são próprios; bancos/journals, credenciais, containers e redes são removidos/verificados. Não utiliza VM Windows US-001 ou dados pessoais.

[54 gates reais](../quality/evidence/us-041-manual-core-2026-10-18.json): 28 regressões e 26 específicos, comparando conteúdo completo e histórico, sinais, escopo, mudança de conta, versões/conflitos, exclusão reversível, descrição original, rateio, ajustes i64 sem consumo, rollback, concorrência e local sem identidade cloud. A suíte Node também executa os 12 casos persistidos em SQLite. O dataset FIN-002 e seus goldens não mudam; relatórios contêm somente gates, versões, hashes e pendências. CI configurada em workflow isolado, sem execução remota observada neste incremento.

Não houve migration, dependência de produção, endpoint, permissão Tauri ou formato novo de backup. Escrita cloud exige composição real de identidade, feed/outbox/recibos; Desktop precisa de binding Rust e protocolos próprios. Homologações humanas seguem após integração completa, conforme orientação do usuário. US-041 permanece em andamento até as telas e comandos locais.
