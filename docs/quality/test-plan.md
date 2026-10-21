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

O [catálogo ativo](../../infra/validation/catalog.json) identifica 53 protocolos herdados, seus validadores, comandos e relatórios. Importações do catálogo conservam o commit de origem e os timestamps reais. Novas execuções são arquivadas pelo hash dos bytes. A consulta do catálogo distingue entradas reutilizáveis, pendentes e arquivos sem cobertura; apenas o executor completo, seguido de `pnpm check`, permite declarar o incremento validado.

Não confundir testes TypeScript com integração Tauri/Expo/Next/Nest; Chromium com WebView2; evidência Windows com Android/iOS; execução local com CI remota; testes sintéticos com homologação humana. As pendências do PRD, das histórias e dos ADRs continuam aplicáveis.
