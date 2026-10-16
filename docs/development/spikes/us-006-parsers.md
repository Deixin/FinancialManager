# US-006 — Parsers OFX/CSV com 10 mil linhas

História: [US-006](../../delivery/05-backlog.md), RF-10 a RF-13 e meta de RNF-08. Decisão, dependências e ameaças: [ADR-0023](../../architecture/adr/0023-spike-parsers-ofx-csv.md).

## Executar

Use Node 24.19.0 e pnpm 11.25.0. O experimento é local e não exige Docker, conta cloud ou arquivo bancário real.

```sh
pnpm install --frozen-lockfile
pnpm spike:importers:test
pnpm check
```

O runner gera fixtures marcadas SYNTHETIC e usa somente .tools/us006-importers. Executa três amostras de 10 mil registros por perfil, com processo Node independente e staging SQLite real. Confere os campos, hashes e inteiros persistidos, além da meta de 30 segundos por prévia. O relatório registra hardware, versões, duração completa e RSS do filho.

O processo envia contagens/fases de progresso por IPC e recebe cancelamento; a homologação cancela durante o parsing e também mata o processo com transação aberta. Nenhum conteúdo do extrato ou erro de biblioteca é publicado nos logs. A fonte, bancos e journals próprios são removidos no finally. Se o coordenador for interrompido, execute:

```sh
pnpm spike:importers:clean
```

Execute uma homologação por vez neste checkout. O relatório sanitizado fica em .tools/us006-importers/report.json. Ele contém somente métricas, flags, hardware e hashes, e é validado antes de ser arquivado em docs/quality/evidence. Os bancos/arquivos originais não devem ser versionados.

## Catálogo experimental de compatibilidade

| Perfil versionado       | Corpus homologado                                                                                    | Restrições                                                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| csv-explicit-mapping-v1 | UTF-8 com/sem BOM; CRLF/LF; vírgula/ponto e vírgula/tab via configuração; aspas/escape/multilinha    | Cabeçalho único, mapping obrigatório; YYYY-MM-DD ou DD/MM/YYYY; decimal/agrupamento explícitos; valor assinado, delta de conta ou débito/crédito.                                                           |
| ofx-102-bank-card-v1    | OFXHEADER 100, VERSION 102, DATA OFXSGML; UTF-8 UNICODE/UTF-8 ou USASCII/1252 com encoding explícito | Uma conta STMTRS ou CCSTMTRS; escalares conhecidos podem omitir fechamento; agregados devem fechar corretamente.                                                                                            |
| ofx-2xml-bank-card-v1   | Declaração XML 1.0 UTF-8, PI OFXHEADER 200; VERSION 203 testada                                      | XML estrito na mesma hierarquia; somente entidades predefinidas/númericas, sem DTD, CDATA, comentários ou atributos. VERSION 220/230 é reconhecida no mesmo subconjunto, sem homologação de corpus próprio. |

O catálogo é de fixtures sintéticas. Nenhum banco, layout de exportação real ou versão adicional foi homologado por associação. Conta bancária exige CHECKING/SAVINGS/MONEYMRKT e destino ASSET; cartão exige CCSTMTRS e destino LIABILITY. Somente BRL. Outras contas, investimentos, correções OFX e múltiplos extratos por arquivo exigem outro leitor/corpus ou revisão explícita; não são transformados em lançamentos válidos silenciosamente.

CSV com campo a mais/a menos ou valor/data inválidos mantém a linha INVALID na revisão. Quebra estrutural de aspas/encoding, OFX truncado, moeda/destino incompatível e limites invalidam a fonte e fazem rollback de todo o staging. Descrições são preservadas como texto; normalização do nome proposto não executa fórmulas. FITID é preservado como texto e nunca confundido com identidade global.

## Gates

- Migração atômica, checksum, reabertura e persistência de INTEGER i64.
- CSV, OFX SGML e OFX XML com 10 mil linhas: três ensaios cada, até 30 segundos, RSS do filho até 256 MiB.
- Valores acima de 2^53 e extremos i64, sinais de cartão/débito/crédito, DATE e provenance.
- UTF-8/BOM e Windows-1252 explícito, mapeamento, multilinha, erro por linha e fórmula como texto.
- Repetição por ID consistente, divergência por ID e compras iguais legítimas sem descarte.
- MIME/extensão/estrutura, binário, DTD/XXE/entidades, layout, moeda e destino hostis/incompatíveis.
- 16 MiB, 10 mil registros, 64 colunas, limite de campo/registro, prazo e cancelamento.
- Processo interrompido não deixa lote parcial; cancelar uma revisão completa de 500 linhas deixa o livro financeiro idêntico.
- Limpeza e logs sem payload; hashes de fonte, saída normalizada, migração e código do instrumento.

## Resultado e limites

Homologação local em 2026-10-16: [evidência](../../quality/evidence/us-006-parsers-2026-10-16.json). O relatório é a referência para durações e hardware, sem extrapolação para outros dispositivos.

Staging guarda apenas o modelo estruturado e metadados necessários à revisão. Não existe ação de confirmação financeira no instrumento. Confirmação atômica/idempotente, reversão, dedupe contra dados já integrados e regras seguem nas histórias de produto. SQLite/temporários sem criptografia são exclusivos das fixtures; integração ao cofre SQLCipher continua pendente.

O gate comprova o processamento computacional da prévia. Não homologa a renderização ou controles visuais de progresso/cancelamento de RNF-08 em Tauri/Expo/Web. XLSX, PDF, XML fiscal e corpus autorizado de bancos também seguem pendentes. O pnpm check valida regressões e estrutura; a CI parser-spike roda o protocolo real separadamente.
