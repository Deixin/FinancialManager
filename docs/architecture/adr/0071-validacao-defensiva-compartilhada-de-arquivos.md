# ADR-0071 — Validação defensiva compartilhada de arquivos

Estado: aceito. Data: 2026-10-21. História: US-051; PRD RF-10 e arquitetura §15. Este incremento entrega a barreira compartilhada, antes dos parsers US-052–054 e da integração Desktop da US-051.

## Decisão

`@financial-manager/importers` expõe `validateImportFile`: recebe nome simples, MIME declarado, encoding explícito, delimitador CSV explícito e bytes em memória. Confere contrato fechado, extensão, MIME e conteúdo; limita tamanho antes de copiar/decodificar. O snapshot recusa memória compartilhada mutável. O resultado congelado contém somente versão da política, formato, encoding, tamanho e contagens estruturais. Erros têm códigos fixos, sem nome ou conteúdo recebido. O gate não altera a entrada.

A política v1 admite CSV e o subconjunto estrutural OFX 1.02 SGML/OFX 2 XML do spike. UTF-8 fatal e Windows-1252 explícito; sem tentativa silenciosa de outro encoding. MIME vazio/genérico é uma indicação insuficiente e exige as mesmas verificações de bytes e estrutura. MIME incompatível e assinatura binária disfarçada são recusados. CSV não tem assinatura inequívoca: texto delimitado arbitrário pode passar pela estrutura, mas somente mapping, normalização e revisão posteriores podem torná-lo registro financeiro.

CSV usa scanner de estados para aspas, escape, multilinha e limites; mantém linhas com contagens diferentes para revisão posterior. OFX usa scanner iterativo sem resolução de entidades, com fechamento estrito de agregados; somente escalares conhecidos podem omitir fechamento SGML. No XML, tags ASCII sem atributos; não se trata de um parser XML geral. Somente referências XML predefinidas e numéricas válidas são admitidas, sem expansão pelo gate. DTD, entidades personalizadas/externas, comentários, CDATA, instruções adicionais e atributos são recusados. A semântica OFX, conta, moeda e layouts bancários continuam na US-052.

Limites v1: 16 MiB; 10 mil registros de dados (CSV mais um cabeçalho); 64 colunas; 2.048 unidades UTF-16 por campo; 8.192 por registro bruto; 200 mil linhas físicas; profundidade 32; 500 mil elementos OFX; prazo cooperativo de 30 segundos e cancelamento nos checkpoints. Limites do spike são mantidos e linhas/elementos ganham limites explícitos. Não há ajuste de limites enviado pelo arquivo. Não se cria staging ou movimentação.

ZIP/XLSX/XLSM, PDF e XML fiscal são recusados antes de descompactar, renderizar ou interpretar. A admissão futura exige leitor limitado e corpus próprio (incluindo expansão, entradas ZIP, referências, fórmulas, macros, páginas e conteúdo ativo), sem ampliar esta política silenciosamente. Fórmulas aparentes em CSV são texto inerte; escape em exportação continua obrigatório na história correspondente.

## Fronteiras e validação

Nenhuma dependência de produção nova. Os scanners portáveis não importam Node, filesystem, rede, DOM ou executores de documentos. `DOM` no tsconfig fornece apenas tipos de TextDecoder, performance e AbortSignal; não integra Tauri, Expo, Web ou API. Os adapters futuros devem limitar a leitura antes de alocar todo arquivo, autorizar workspace/conta, repetir a validação nos bytes efetivamente usados pelo parser, executar trabalho fora da UI e aplicar cancelamento/prazo no host. Um resultado estrutural não é um recibo confiável de autorização ou um selo transferível para bytes alterados.

O protocolo sintético executa o mesmo corpus em processo Node limitado e Chromium, compara CSV/XML aceitos com os parsers independentes já existentes no spike e verifica erros, imutabilidade, ausência de egress/storage/execução e fronteiras dos limites. Tem prazo externo de processo e mede RSS de pico Node. O catálogo registra o protocolo próprio conforme ADR-0070; relatórios antigos permanecem imutáveis. Não se reexecutam protocolos de cofre/backup quando suas fontes funcionais permanecem iguais.

Não muda schema, dinheiro, revisões, RLS, chaves, backup, restauração ou permissões IPC. Integração de seleção/leitura nativa e paridade Rust da US-051 são o próximo incremento. Cloud, Mobile, parsers, staging, commit financeiro e homologação humana preservam seus gates. DP-01 a DP-04 não são resolvidas.

Referências de gramática: [RFC 4180](https://www.rfc-editor.org/rfc/rfc4180) e [XML 1.0, quinta edição](https://www.w3.org/TR/xml/). São referências para o subconjunto restrito, sem alegação de implementar integralmente os formatos.
