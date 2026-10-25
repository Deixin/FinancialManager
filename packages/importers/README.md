# importers

Parsers e normalização de entradas. Staging, revisão, deduplicação e limites seguem a documentação.

Estado: US-051 entrega `validateImportFile`, barreira compartilhada de CSV/OFX com limites, encoding explícito, inspeção estrutural e erros seguros, já integrada ao Desktop/Rust. A US-052 acrescenta `parseOfx`, núcleo compartilhado de normalização determinística, com dinheiro i64, erros por linha e proveniência. [OFX normalizado](../../docs/development/ofx-parser.md), [ADR-0074](../../docs/architecture/adr/0074-parser-ofx-normalizado-compartilhado.md). A adaptação Desktop/Rust deste parser e a persistência/revisão/commit de staging permanecem pendentes. O instrumento experimental OFX/CSV permanece em spikes/us-006; não é o parser de produto.

Referência: [arquitetura](../../docs/architecture/04-technical-architecture.md). Execute pnpm --filter @financial-manager/importers typecheck ou build para verificar o módulo isoladamente.

Execute pnpm spike:importers:test para o benchmark de 10 mil linhas e corpus hostil em processos separados. [Protocolo e compatibilidade](../../docs/development/spikes/us-006-parsers.md), [ADR-0023](../../docs/architecture/adr/0023-spike-parsers-ofx-csv.md) e [evidência](../../docs/quality/evidence/us-006-parsers-2026-10-16.json) delimitam o resultado. csv-parse e sax são dependências de runtime do instrumento; sua adoção pelo produto exige a integração prevista nas histórias posteriores.
