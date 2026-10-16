# ADR-0023 — Parsers OFX/CSV e benchmark de staging

- Data: 2026-10-16
- Status: Validado como spike; integração ao produto pendente
- História: US-006; subsidia US-007 e US-050 a US-057
- Substitui: nenhum; preserva ADR-010 e DP-01 a DP-04

## Contexto

A [US-006](../../delivery/05-backlog.md) exige normalizar OFX/CSV com 10 mil linhas dentro da meta de benchmark sem alterar saldo. RF-10 a RF-13 do [PRD](../../product/01-prd.md) exigem destino explícito, interpretação revisável, identificadores de origem e confirmação posterior. RNF-08 propõe prévia em até 30 segundos; RNF-04 e a seção 15 da [arquitetura](../04-technical-architecture.md) exigem limites, isolamento e proteção contra conteúdo hostil.

## Decisão experimental

Implementar os leitores e a normalização em packages/importers/spikes/us-006, com coordenador/processo Node em infra/importers. O pacote público TypeScript continua sem contrato de produto. O experimento não integra Tauri, Expo, NestJS ou Next.js, nem entrega a interface IM-02 a IM-05.

csv-parse 7.0.3 é dependência de runtime do workspace importers: oferece aspas/escape, registros multilinha, streaming, posição e limite de registro, mantendo cast/cast_date desligados. sax 1.6.1 é dependência de runtime para validar o XML estrito sem construir uma árvore completa. Ele não busca DTDs ou entidades externas; o instrumento também rejeita declarações antes do parsing e usa strictEntities. Versões e integridades estão fixadas no lockfile.

O adaptador OFX 1.02 insere apenas fechamentos omitidos de campos escalares conhecidos e passa os tokens pelo mesmo SAX estrito. Agregados truncados ou fora da hierarquia são recusados; não há reparo heurístico de extrato quebrado. A varredura usa offsets/indexOf para percorrer tokens sem regex com tentativas quadráticas em sequências de caracteres `<`. O catálogo é restrito à [compatibilidade testada](../../development/spikes/us-006-parsers.md).

Alternativas consideradas: split por linha/separador perde aspas e campos multilinha; conversão de dinheiro por Number perde precisão; um leitor OFX universal sem corpus autorizado não permite homologação verificável. Bibliotecas de parsing cuidam da sintaxe, enquanto o adaptador mantém layout, normalização e regras de revisão explícitos. O experimento não seleciona parsers XLSX/PDF/XML fiscal da US-007.

## Contrato e dinheiro

O chamador fornece workspace, conta, moeda BRL e natureza ASSET/LIABILITY. Isto delimita o destino local, sem representar autorização cloud. CSV exige mapping de colunas, data, decimal, agrupamento e uma convenção de sinal: cash flow assinado, delta da conta ou débito/crédito separados.

Decimais são separados em texto e convertidos com BigInt, sem parseFloat/Number monetário ou arredondamento implícito. Mais de duas casas decimais é erro revisável. O limite i64 é aplicado ao resultado após conversão do sinal; por exemplo, cash flow positivo em cartão reduz dívida. A coluna SQLite é INTEGER e recebe BigInt; JSON conserva strings decimais canônicas. Datas usam DATE e mantêm o dia financeiro da fonte, sem converter a data OFX para outro dia em UTC.

Cada import_item guarda posição, identificador externo quando disponível, data, valor, descrição original, nome proposto, erros, avisos e provenance de formato/versão/localizador. Campos selecionados da fonte permitem corrigir erros, sem guardar o arquivo inteiro ou colunas não mapeadas. economic_kind fica nulo para revisão: o sinal e TRNTYPE não classificam automaticamente consumo, transferência ou pagamento de dívida.

Linhas inválidas permanecem em REVIEW com INVALID e códigos de campo. Erro estrutural invalida a fonte inteira e desfaz o staging. FITID ausente, correção OFX não suportada e tipo de transação desconhecido são linhas inválidas. Apenas uma conta/extrato por arquivo é admitida; moeda ou natureza incompatível causa rollback.

O experimento identifica candidatos dentro do lote, sem descartar registros: mesmo ID/valores consistentes gera DUPLICATE; ID com valores divergentes ou coincidência sem ID gera POSSIBLE_DUPLICATE. IDs distintos permitem duas compras iguais. Essa evidência não entrega o motor de deduplicação contra movimentos já integrados, confirmação ou reversão.

## Persistência, progresso e cancelamento

Cada execução abre um processo Node novo com old-space limitado a 128 MiB. O coordenador encerra o filho ao atingir 30 segundos e aguarda seu fechamento. O gate também rejeita ensaios com peak RSS acima de 256 MiB. Heap, tamanho/contagem e prazo são limites efetivos do instrumento; o limite RSS é critério medido de homologação, não um sandbox de memória imposto pelo sistema operacional.

CSV usa streaming/async iterator; OFX cede o event loop a cada lote de tokens. Há progresso por contagem e cancelamento por IPC verificado nos checkpoints. PREVIEW_READY é emitido somente após commit do staging. Cancelamento cooperativo faz rollback; morte abrupta deixa journal que o SQLite recupera na reabertura. Não há garantia contra processo hostil com controle do host nem isolamento de toda saída de rede por política do sistema.

Staging tem migração/checksum versionados e transação única para import_batch/import_item. O processo não recebe handle, caminho ou port de escrita do livro financeiro. O banco sintético de conferência é controlado pelo coordenador e permanece byte a byte idêntico após sucesso, falhas, cancelamento e descarte da revisão de 500 linhas. Nenhum endpoint confirma lançamentos neste instrumento.

SQLite sem criptografia, arquivos de entrada e IPC com conteúdo são exclusivos de fixtures sintéticas em .tools/us006-importers, ignorado pelo Git. O finally remove fonte, staging/journal e base de conferência; o comando clean recupera a limpeza após interrupção do coordenador. Adaptadores de produto devem usar o cofre SQLCipher e a política de temporários protegidos. Não se adota retenção permanente de originais.

## Limites e ameaças

| Fronteira     | Ameaça                                                   | Controle / limite                                                                                                                                               |
| ------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fonte         | Extensão/MIME ou encoding falsos, layout desconhecido    | Formato, conteúdo, declaração e encoding explícitos; UTF-8 fatal ou Windows-1252 homologado; erro seguro sem payload.                                           |
| Dinheiro/data | Float, sinal invertido, data deslocada, overflow         | BigInt/INTEGER/strings, convenção de sinal explícita, i64 após conversão e DATE validada.                                                                       |
| CSV           | Aspas truncadas, coluna silenciosamente perdida, fórmula | Parser estrito, linhas/colunas conferidas; erros de linha preservados; fórmulas ficam texto com aviso. Exportação segura permanece em RF-38.                    |
| OFX/XML       | XXE, entity expansion, instruções, agregados quebrados   | DTD/declarações recusadas, entidades predefinidas, árvore permitida, tokens limitados; sem resolver ou buscar recursos externos.                                |
| Recursos      | Arquivo enorme, token longo, trabalho sem cancelamento   | 16 MiB, 10 mil registros, 64 colunas, 8.192 caracteres/registro, 2.048/campo, 32 níveis, heap limitado e timeout do processo.                                   |
| Staging       | Prévia parcial publicada, falha altera saldo             | Transação local, estado REVIEW somente no commit, recuperação após morte do filho e ausência de port financeiro.                                                |
| Duplicidade   | Perder compra legítima ou sobrescrever divergência       | Apenas candidatos revisáveis, nenhum descarte/update financeiro automático.                                                                                     |
| Logs          | Documento, descrição, valor ou nome de arquivo em erro   | Erros públicos são códigos fixos; stdout/stderr do filho inspecionados em memória e não publicados. Relatório contém somente métricas, hashes, versões e flags. |
| Integração    | Interpretar contexto local como permissão cloud          | Sem upload, serviço remoto ou credencial; policy engine/RLS devem ser revalidados na futura confirmação cloud.                                                  |

Os limites são experimentais, sem definir quotas do produto. Não há execução de fórmulas/macros, OCR, IA externa ou novo serviço remoto. O catálogo não declara suporte a todos os bancos. Não foi usado corpus financeiro pessoal ou de terceiros.

## Validação e consequências

[Protocolo](../../development/spikes/us-006-parsers.md) e [evidência sanitizada](../../quality/evidence/us-006-parsers-2026-10-16.json) registram três amostras por layout, cada uma em processo novo, com 10 mil itens conferidos campo a campo. O tempo inclui startup, leitura, migração, parse, normalização e commit de staging, sem geração da fixture ou renderização da UI. A máquina de referência e RSS do processo estão no relatório; não se extrapola esse resultado para Mobile ou outros computadores.

As 17 verificações reais incluem corpus hostil, migração/rollback, encoding, precisão, sinais, duplicidade, cancelamento, morte de processo e imutabilidade do livro financeiro sintético. A suíte Node contém 76 testes após este spike. A CI recebe o gate separado parser-spike em Windows/Linux; execução remota pendente.

A US-006 é concluída no recorte experimental. Confirmar/reverter importações, regras/categorias, deduplicação entre lotes, UI, cofres de staging nativos, frameworks e outros formatos permanecem nas histórias de produto. DP-01 a DP-04 continuam abertas; a US-007 deve consolidar as decisões físicas e suas pendências.

Fontes primárias consultadas em 2026-10-16: [opções csv-parse](https://csv.js.org/parse/options/), [max_record_size](https://csv.js.org/parse/options/max_record_size/), [SAX strictEntities/DTD](https://github.com/isaacs/sax-js), [especificação OFX da FDX](https://financialdataexchange.org/FDX/FDX/About/OFX-Work-Group.aspx) e [OFX 2.2, tipos e TRNAMT](https://www.financialdataexchange.org/common/Uploaded%20files/OFX%20files/OFX%202.2.pdf).
