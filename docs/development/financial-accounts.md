# Contas financeiras e referências — US-040 em andamento

Este incremento entrega a base compartilhada de contas em Domain, finance-ports e adapters PostgreSQL/SQLite. As telas e o IPC do Desktop ainda serão integrados na própria US-040. A UI atual permanece como na US-036; build TypeScript não comprova essa integração. [Decisão e ameaças](../architecture/adr/0048-operacoes-compartilhadas-de-contas.md).

## Operações disponíveis

createAccountWriteService coordena um store confiável; createSqliteAccountService e createPostgresAccountService instalam os adapters. A autorização recebe workspace e principal quando cloud. Criação exige can_write, can_create e escopo completo; edição exige a conta autorizada. As factories de produto precisam receber um provider real ao integrar os hosts; não há endpoint ou grant SQL de produto acrescentado aqui.

- CREATE: nome, instituição opcional, tipo/natureza, BRL, UUIDv7 e referência opcional.
- UPDATE: nome, instituição e arquivamento/reativação, com base explícita. Identidade, moeda, tipo e natureza continuam de criação neste incremento.
- REFERENCE: novo ID, valor i64 canônico, data, posição explícita e ID a substituir quando houver. Referências substituídas permanecem históricas.

Metadados legados restaurados podem ser lidos e arquivados sem normalização ou truncamento; somente valores novos/alterados passam pelos limites atuais. Um teste reproduziu a rejeição indevida de nomes longos, falhou antes da correção e passou depois.

Conta e referência inicial são atômicas. Falha durante substituição também desfaz o status SUPERSEDED. Repetir o mesmo pedido reconcilia o estado sem duplicação; conflito não é sobrescrito automaticamente. A comparação de metadados ainda não oferece versão monotônica, auditoria ou recibo de transporte. Esses mecanismos permanecem necessários antes da escrita cloud/sync.

readCalculatedAccountBalance lê todas as páginas de conta/referências/movimentos no mesmo snapshot e reutiliza o cálculo Domain. Use createPostgresReadUnit com snapshot: true; uma unit sem essa garantia é recusada. A cobertura do histórico deve vir de política confiável; desconhecido ou referência ausente gera saldo incompleto. compareAccountBalance calcula diferença exata sem inserir ajuste/receita/despesa. Disponibilidades e passivos mantêm seus sinais; não há consolidação multimoeda.

SQLite requer conexão exclusiva do serviço, migrada para v2, com descarte pelo host se rollback falhar. PostgreSQL requer role de runtime restrita, grants/policies apropriados e conexão RLS; owner/superuser/BYPASSRLS são recusados. Nenhuma dependência externa, migration ou mudança de formato do backup foi necessária.

## Reprodução

```sh
pnpm install --frozen-lockfile
pnpm build
node infra/accounts/run.mjs
pnpm check
```

O protocolo usa Docker Linux local com imagem fixa de PostgreSQL 18.6 e Node SQLite 3.53.3. Reutiliza a porta sintética 127.0.0.1:43221, portanto execute sequencialmente com os protocolos de schema/fixtures/repositories/revisões/invariantes. Instâncias existentes não são adotadas. Raiz própria .tools/us040-accounts guarda apenas recursos sintéticos temporários e o relatório fechado; credenciais/bancos/journals e containers/redes próprios são removidos antes do sucesso. Não utiliza a VM Windows da US-001 nem cofres pessoais.

## Evidências

[49 gates reais](../quality/evidence/us-040-accounts-core-2026-10-17.json) incluem 28 regressões de revisões e 21 verificações de contas. O mesmo roteiro cria, repete, edita, rejeita base obsoleta, arquiva/reativa e corrige referências nas duas engines. Testa i64 mínimo/máximo e valores acima de 2^53, referência ausente, data/posição inválidas, rollback após INSERT e após SUPERSEDED, autorização por workspace/conta e conflito concorrente. Compara estado e histórico completos, incluindo instituição, sem alterar FIN-002.

PostgreSQL confere os sete goldens originais por leitura através dos ports. Um pedido independente grava enquanto uma unit de snapshot lê duas vezes; a unit mantém o estado anterior e outra leitura confirma o commit. Conta local SQLite funciona sem principal cloud. Owner/nesting são recusados, conexão SQLite reabre preservando o estado e logs não contêm credenciais ou canários financeiros.

Dezesseis testes Node novos cobrem planos, captura antes de await, concorrência, falhas/atomicidade, todas as páginas, snapshot obrigatório, precisão, fechamento e evidência. Os seis protocolos compartilhados afetados são reexecutados e arquivados com sufixo us040-core; evidências Desktop anteriores continuam atuais e preservadas. Homologação humana fica para depois da integração completa, conforme ADR-0044, sem aprovação registrada ou nova confirmação por incremento.

Próximo passo: integração das contas/referências no Desktop da US-040. As telas de conferência, ajuste identificado por movimentação, IPC, testes WebView2/SQLCipher deste fluxo, rotas cloud, outbox/auditoria/recibos e paridade Web/Mobile permanecem com seus gates próprios.
