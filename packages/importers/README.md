# importers

Parsers e normalização de entradas. Staging, revisão, deduplicação e limites seguem a documentação.

Estado: US-051 entrega `validateImportFile`, barreira compartilhada de CSV/OFX com limites, encoding explícito, inspeção estrutural e erros seguros. [Contrato e protocolo](../../docs/development/import-file-validation.md), [ADR-0071](../../docs/architecture/adr/0071-validacao-defensiva-compartilhada-de-arquivos.md). Integração Desktop/Rust e parsers financeiros continuam pendentes. O instrumento experimental OFX/CSV permanece em spikes/us-006.

Referência: [arquitetura](../../docs/architecture/04-technical-architecture.md). Execute pnpm --filter @financial-manager/importers typecheck ou build para verificar o módulo isoladamente.

Execute pnpm spike:importers:test para o benchmark de 10 mil linhas e corpus hostil em processos separados. [Protocolo e compatibilidade](../../docs/development/spikes/us-006-parsers.md), [ADR-0023](../../docs/architecture/adr/0023-spike-parsers-ofx-csv.md) e [evidência](../../docs/quality/evidence/us-006-parsers-2026-10-16.json) delimitam o resultado. csv-parse e sax são dependências de runtime do instrumento; sua adoção pelo produto exige a integração prevista nas histórias posteriores.
