# ADR-0074 — Parser OFX normalizado compartilhado

Estado: aceito. Data: 2026-10-25. História: US-052, núcleo compartilhado; commit-base `0bed20d2a986b19a284892c065957e955a43735c`. Requisitos: RF-10/11, arquitetura §15 e US-051.

## Escopo e término

Implementar `parseOfx` em `@financial-manager/importers`, sem acesso a disco, rede, storage ou portas de escrita. O término exige fixtures FIN-002 sintéticas com resultados explícitos, determinismo Node/Chromium, oráculo XML independente, limites, cancelamento, benchmark de dez mil registros, protocolos selecionados pelo catálogo e `pnpm check`. Preservar a manutenção local do ADR-0073 e suas evidências; validar o conjunto antes de enviá-lo conforme a autorização vigente do usuário.

Este incremento entrega o modelo intermediário para `import_item`, não sua persistência ou integração Desktop/Rust. Identificadores de entidades e autorização pertencem ao serviço de staging futuro; o parser captura workspace e conta informados, mas não comprova autorização. Deduplicação, regras, revisão e confirmação financeira seguem US-056/057 e histórias posteriores.

## Contrato

Aplicar a barreira US-051 sobre o mesmo snapshot limitado usado pelo parser e pelo SHA-256. Aceitar apenas um extrato bancário ou de cartão em BRL nos subconjuntos OFX SGML 1.02 e XML 2.03/2.20/2.30 já permitidos. Recusar filhos desconhecidos, campos repetidos, múltiplas contas/extratos, erro da instituição e moeda/tipo de conta incompatíveis. Não usar primeiro/último campo como desempate silencioso. Entidades fixas/números XML são decodificados uma única vez; entidades externas, DTD, comentários e instruções adicionais continuam bloqueados.

Valores são convertidos com BigInt para strings decimais canônicas i64. No cartão, o fluxo OFX negativo de compra vira aumento positivo da dívida; pagamentos/créditos reduzem dívida. A data financeira conserva o dia escrito na fonte; tempo/fuso são validados, sem converter para UTC. O subconjunto aceita data de oito dígitos ou timestamp completo, segundos intercalares e offsets entre -12 e +12 previstos pela [especificação OFX Banking 2.3, §3.2.8](https://www.financialdataexchange.org/common/Uploaded%20files/OFX%20files/OFX%20Banking%20Specification%20v2.3.pdf). Metadados de período são informativos, sem aplicar saldo observado ao livro.

Linhas semanticamente inválidas permanecem no resultado com `INVALID`, campos normalizados nulos quando inaplicáveis e códigos fixos por campo. FITID ausente ou repetido gera aviso, sem descartar nem classificar automaticamente duplicidade. Correções OFX ficam inválidas até revisão explícita; tipos XFER/PAYMENT recebem aviso para preservar transferências/liquidação separadas de consumo. Nenhuma linha é confirmada automaticamente.

Proveniência contém hash do snapshot, leitor/versão e caminho estrutural com ordinal de STMTTRN e campos. O resultado inclui nome simples, formato, moeda, período e fingerprint da conta de origem, sem número bancário em claro nem arquivo original. Não usar UUID, relógio ou aleatoriedade no parser. Resultados e itens são congelados; entrada e destino são capturados antes do primeiro await. Cancelamento/prazo também são verificados após hashing; não há retorno parcial em falha estrutural ou cancelamento.

## Validação e limites

O modelo retém `source_transaction_type` como enum fechado ou nulo e `provenance.fields.type` apontando para TRNTYPE. Esse dado de origem permite revisar XFER e PAYMENT separadamente após o descarte do original; não determina a natureza econômica nem confirma um lançamento. A revisão do contrato inclui regressão que falhava antes da inclusão do campo e oráculos do hash dos bytes com BOM UTF-8, Windows-1252 e subview de Uint8Array.

Ampliar o protocolo compartilhado `us051-defensive-files` com gates próprios da US-052, mantendo todos os gates anteriores e relatórios históricos imutáveis. Fontes novas devem constar no produtor. Testes consumidores rodam no gate final; não reduzir seleção por lockfile ou dinheiro para acelerar execução.

Sem novas dependências de produção, mudança de schema, permissões, RLS, criptografia ou backup/restauração. Corpus bancário real e homologação humana permanecem pendentes conforme ADR-0044. DP-01 a DP-04 continuam abertas nos escopos já registrados.
