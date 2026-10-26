# Plano de testes atual

O [ADR-0070](../architecture/adr/0070-validacao-incremental-e-evidencias-imutaveis.md) define execução incremental e evidências imutáveis. O [processo operacional](../development/validation-workflow.md) contém os comandos e as regras de retomada. O [plano histórico](test-plan-history.md) preserva integralmente o catálogo anterior de cenários e suas limitações.

## Gates obrigatórios

- `pnpm check` ao concluir código ou configuração: formatação, lint/fronteiras/geração, tipos, testes de comportamento, validação do catálogo e build.
- Protocolos reais selecionados por hashes dos seus produtores, fixtures, código e configuração. Mudança crítica também invalida os guardas comuns das entradas do runtime afetado; fontes financeiras compartilhadas protegem ambos os runtimes.
- Arquivos novos ou alterados sem cobertura conhecida bloqueiam a conclusão até registrar uma dependência e seu protocolo. Não atualizar o inventário para ocultar uma mudança.
- Relatórios aceitos exigem identidade, conteúdo íntegro, checks originais, recursos encerrados e fontes correspondentes. Relatórios históricos não são reescritos para parecer recentes.
- Testes consumidores de relatórios são executados novamente no gate rápido. Alterar a referência do catálogo não exige repetir SQLCipher/WebView2 quando as entradas funcionais permanecem iguais.
- Integridade financeira, i64, autorização/RLS, atomicidade, idempotência, reversão, falhas de processo e restauração mantêm os cenários existentes.
- Revisão integrada antes de release/marco usa `node infra/validation/cli.mjs run --full`. Ela não substitui plataformas ou homologações ainda pendentes.

## Evidência e interpretação

O [catálogo ativo](../../infra/validation/catalog.json) identifica 54 protocolos atuais, incluindo os 53 herdados, seus validadores, comandos e relatórios. Importações do catálogo conservam o commit de origem e os timestamps reais. Novas execuções são arquivadas pelo hash dos bytes. A consulta do catálogo distingue entradas reutilizáveis, pendentes e arquivos sem cobertura; apenas o executor completo, seguido de `pnpm check`, permite declarar o incremento validado.

A US-051 acrescenta o protocolo [de arquivos defensivos](../development/import-file-validation.md), com corpus hostil em Node isolado e Chromium, comparação com parsers independentes, limites exatos/excedidos e erros sem conteúdo recebido. A [integração Desktop/Rust](../development/desktop-import-files.md) amplia os dois protocolos da central existente, mantendo seus gates anteriores: paridade de 357 vetores, sete testes nativos de arquivos, seleção/desbloqueio/validação em WebView2, cancelamento, isolamento e preservação do ledger e do original. Chromium cobre também nomes longos em tela de 390 px, acessibilidade, privacidade e ausência de storage/egress. O catálogo contém 54 entradas atuais; a homologação do diálogo Windows por uma pessoa permanece pendente.

Não confundir testes TypeScript com integração Tauri/Expo/Next/Nest; Chromium com WebView2; evidência Windows com Android/iOS; execução local com CI remota; testes sintéticos com homologação humana. As pendências do PRD, das histórias e dos ADRs continuam aplicáveis.

A US-052 amplia o mesmo scope compartilhado com três gates de normalização OFX, preservando os dez gates defensivos anteriores. O [protocolo OFX](../development/ofx-parser.md) compara 70 cenários integralmente em Node/Chromium, inclui limites i64/sinais de cartão, tipo original e proveniência, linhas inválidas retidas, BOM/Windows-1252/subview, snapshot, cancelamento e prazo depois do hash. Sax e SHA-256 Node são oráculos independentes; o benchmark verifica dez mil registros sem escrita financeira. A [normalização Desktop/Rust](../development/desktop-ofx.md) amplia os dois scopes existentes da central: seis testes OFX SQLCipher, 77 vetores completos de paridade (incluindo dez mil registros), dez gates Chromium e onze Windows, com prévia real no WebView2. Conta arquivada após seleção, escopo/PIN, destino derivado no host, ACK inválido, paginação/erros, cancelamento tardio e descarte da árvore privada possuem cobertura. Os testes anteriores de arquivos/central, backup/restauração sem credenciais de origem e limpeza continuam obrigatórios. A rodada local aprovou os 33 protocolos Desktop afetados, reutilizou 21 e concluiu `pnpm check` com 538 testes, sem falhas ou skips.
