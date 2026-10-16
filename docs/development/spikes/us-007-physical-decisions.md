# US-007 — Decisões físicas e gates restantes

História: [US-007](../../delivery/05-backlog.md), ERD §21 e arquitetura §30. Propostas e limites: [ADR-0024](../../architecture/adr/0024-consolidacao-fisica-e-gates.md). Os seis itens de aceite têm encaminhamento e gate explícito; isto não encerra todas as homologações W0.

## Probe reproduzível

```sh
pnpm install --frozen-lockfile
pnpm spike:physical:test
pnpm check
```

Node 24.19.0 e pnpm 11.25.0. O instrumento cria somente .tools/us007-physical/synthetic.sqlite, usa migração/checksum versionados, executa os casos e remove o banco/journals próprios em finally. Não aceita caminho de base de usuário. A fonte usa exclusivamente fixtures e não lê bancos, backups ou dados financeiros pessoais.

Verificações reais:

1. Migração interrompida não publica tabelas; reabertura aceita checksum igual e rejeita alteração.
2. UUID em TEXT mantém valor JSON, unicidade e ordem binária dos vetores v7 fixos.
3. UUID nil ou fora do formato canônico é recusado pelo port e por constraints.
4. FK composta workspace/id rejeita referência ao registro de outro espaço.
5. Instantes UTC com três casas decimais persistem e ordenam corretamente.
6. Offsets, outras precisões e instantes inválidos são recusados.
7. DATE valida calendário sem conversão de fuso.
8. DECIMAL_EXACT preserva todos os dígitos como TEXT.
9. Rollback e reabertura preservam o conjunto confirmado.

O relatório local fica em .tools/us007-physical/report.json. A [evidência arquivada](../../quality/evidence/us-007-physical-2026-10-16.json) contém apenas versão, checksum, flags e instante técnico. A suíte Node também testa os codecs, executa o probe SQLite real e confere a evidência. Nenhum resultado afirma que um binding SQLCipher nativo foi executado por esse comando.

## Spikes/gates explícitos

Os identificadores G07 são tarefas técnicas deste protocolo, não novas histórias ou compromissos de calendário. Engenharia é responsável pela execução e registro da evidência; adoção arquitetural passa pela revisão do ADR e distribuição pelo seu gate específico.

| Gate      | Antes de                                                  | Ambiente/entradas                                                           | Critério de saída verificável                                                                                                                                                                                                                                                                                                                  |
| --------- | --------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G07-IDS   | US-023 e criação de IDs de produto                        | Rust/JS/Expo e PostgreSQL; vetores RFC e clock controlado                   | Fixar bibliotecas por plataforma; testar versão/variante, CSPRNG disponível, geração no mesmo ms, regressão de relógio, ordenação aproximada e ausência de duplicatas no corpus. Sem fallback Math.random; relógio não arbitra conflitos.                                                                                                      |
| G07-TIME  | US-020/US-021                                             | PostgreSQL e ambos os bindings SQLCipher homologados                        | Mesmos vetores UTC ms, DATE, limites/calendário e rejeições; roundtrip JSON sem deslocamento. Declarar tratamento de precisão maior; preservar originais até migration validada.                                                                                                                                                               |
| G07-VAULT | US-021/US-022/US-032 e release Desktop                    | Windows x64 real/VM, cofre de produto sintético, versões fixadas            | Repetir falta/chave incorreta, integridade, migrations interrompidas, journal/outbox, backup/restore novo workspace; gates de WebView/capabilities e empacotamento. iOS continua bloqueio separado da US-002.                                                                                                                                  |
| G07-QUERY | Fixar repositories de US-020/US-024                       | Primeiro Kysely+pg em PostgreSQL real, roles do modelo US-004               | Tipos rejeitam coluna/tipo incorretos; BIGINT fica string; mesmo client e SET LOCAL em todo o callback; RLS sem WHERE, rollback, conexão perdida, concorrência, locks e paginação funcionam. Falhar no gate mantém SQL/port experimental, sem adotar ORM por compilação apenas.                                                                |
| G07-JOBS  | Primeiro job cloud de US-081/US-143/exportações/snapshots | PostgreSQL real, dois workers e relógio de teste; somente payload sintético | Claim concorrente sem executar simultaneamente lease válido; fencing do lease vencido, retomada após morte, backoff/dead-letter duráveis, cancelamento, revogação e efeito idempotente após ACK perdido. Comprovar transação entre efeito/recibo. Retention/purge aguarda DP-02.                                                               |
| G07-PDF   | US-081 e PDF em US-057                                    | Corpus PDF textual sintético, processo isolado, runtimes alvo               | Comparar candidato PDF.js/alternativa nativa, fixar versão e catálogo por layout; conferir dados/posições, fonte sem texto/encriptada/malformada, páginas/tamanho/tempo/RSS, ausência de execução/rede e limpeza protegida após sucesso/cancelamento/falha. Sem OCR/IA externa nem apoio em documento pessoal para declarar suporte universal. |

PDF e fila não precisam ser instalados para registrar essa pendência. Não há código de job cloud ou PDF de produto declarado pronto. Configuração externa e concessões de credenciais reais exigem suas histórias e autorização correspondente.

## Continuidade permitida

As US-010/US-011 já têm bootstrap e gates compartilhados, sem integração completa dos frameworks. O próximo incremento independente é US-013: MoneyMinor e regras puras de domínio com fixtures. Ele pode avançar sem escolher prazos DP-01/DP-02, enum DP-03, IdP de produção, PDF ou fila.

US-020/US-021/US-022/US-027 devem produzir schema/migrations e invariantes financeiros comuns, sem copiar como definitivo o schema de qualquer spike. US-002/iOS e US-003/provedores/runtimes continuam com evidências próprias pendentes. DP-04 permanece aberta até a adoção e homologação restantes.
