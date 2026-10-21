# US-051 — Barreira compartilhada de arquivos

Este incremento implementa a validação estrutural em `@financial-manager/importers`, conforme [ADR-0071](../architecture/adr/0071-validacao-defensiva-compartilhada-de-arquivos.md). A integração de seleção/leitura Desktop e paridade Rust está descrita na [US-051 Desktop](desktop-import-files.md) e no [ADR-0072](../architecture/adr/0072-validacao-defensiva-no-desktop-e-rust.md). Os resultados abaixo preservam a entrega compartilhada anterior.

`validateImportFile({ file_name, mime, encoding, delimiter, bytes }, signal?)` devolve metadados congelados ou `ImportFileError` com código fixo. Encoding aceita `utf-8` ou `windows-1252`; CSV exige delimitador `,`, `;` ou tab, OFX exige `null`. Não há detecção silenciosa de encoding/delimitador nem garantia semântica baseada na extensão/MIME.

| Situação                                                                                                            | Comportamento e alternativa                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| CSV/OFX dentro do subconjunto e limites                                                                             | Metadados estruturais; normalização e revisão serão exigidas antes de qualquer integração financeira.                                     |
| `UNSUPPORTED_FORMAT` / `UNSUPPORTED_LAYOUT`                                                                         | Recusar; usar exportação OFX/CSV compatível ou cadastro manual. XLSX, PDF e XML fiscal ainda não são admitidos.                           |
| `FILE_LIMIT`, `ROW_LIMIT`, `COLUMN_LIMIT`, `FIELD_LIMIT`, `RECORD_LIMIT`, `LINE_LIMIT`, `DEPTH_LIMIT`, `NODE_LIMIT` | Recusar integralmente; exportar um período menor ou obter arquivo compatível. Sem truncamento silencioso.                                 |
| Tipo, encoding, estrutura ou conteúdo ativo incompatíveis                                                           | Recusar com código seguro; obter nova exportação e escolher encoding correto. Não tentar executar, renderizar ou corrigir conteúdo ativo. |
| `CANCELLED` / `TIME_LIMIT`                                                                                          | Interromper; nada é persistido. O host futuro também deve limitar duração e leitura.                                                      |

O resultado não contém texto original, nome recebido, dados financeiros ou bytes. O gate nunca abre arquivos, expande contêineres, faz fetch, usa storage ou escreve no livro financeiro. Não substitui autorização por workspace/conta, hash de origem, staging, parser, revisão ou confirmação atômica. Adapters devem ler com limite antes da alocação e aplicar o gate novamente sobre o mesmo snapshot usado pelo parser; não aceitar metadados de validação fornecidos pelo cliente como prova no servidor.

## Protocolo reproduzível

```text
pnpm --filter @financial-manager/importers build
pnpm exec playwright install chromium
node infra/import-file-validation/run.mjs
node infra/validation/cli.mjs run
```

Em Windows com o browser já instalado pelo projeto, use `PLAYWRIGHT_BROWSERS_PATH=.tools/us003-oidc/browsers`. O produtor grava `.tools/us051-defensive-files/latest.json` apenas depois de todos os gates aprovados e do encerramento do browser. O runner do catálogo arquiva execuções posteriores por hash; a primeira entrada é registrada a partir da execução real do produtor e conferida pelo mesmo validador estrito.

O corpus FIN-002 é sintético e gerado em memória, incluindo texto com aparência de fórmula, assinatura binária disfarçada, XXE local/remoto, entidades recursivas, truncamento, limites exatos/excedidos, UTF-8 inválido, MIME/encoding divergentes e cancelamento/prazo determinísticos. O subprocesso Node tem heap limitado a 128 MiB, prazo externo de 35 segundos e gate de RSS de pico até 256 MiB. Chromium executa o mesmo corpus, tem rede interceptada e verifica armazenamento vazio; sua métrica de heap é observada ao final, não um limite de memória do processo do browser. Oráculos `csv-parse` e `sax` são os já fixados no spike, usados somente nos testes deste gate.

As evidências desta entrega compartilhada comprovam a biblioteca e seu protocolo nos ambientes registrados. A integração Desktop/Rust possui gates próprios. Layouts bancários reais, parsers financeiros, cloud/Mobile e homologação humana permanecem pendentes.

Resultado local em 2026-10-21: `pnpm check` aprovado com 523 testes, sem falhas ou skips. O [relatório imutável](../quality/evidence/runs/7bb73d75b9cd6295ea0e1ae9296a2838a394273b8c82997ee3c058bae33f0b4a.json) registra 95 casos Node e o corpus correspondente Chromium (memória compartilhada disponível somente no Node deste ambiente), RSS de pico Node de 170.520.576 bytes e duração do corpus Node de 1.373 ms. O runner executou novamente o protocolo após a revisão da fronteira de registro CSV e reutilizou os 53 relatórios anteriores; o catálogo agora contém 54 entradas. Os sete documentos originais permanecem inalterados. O workflow de CI foi adicionado, sem presumir sua execução remota.
