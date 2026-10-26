# US-051 — Validação de arquivos no Desktop

Contrato: [ADR-0072](../architecture/adr/0072-validacao-defensiva-no-desktop-e-rust.md), sobre a [política compartilhada](import-file-validation.md).

Na Central de importações, prepare um lote numa conta ativa, abra seu detalhe e use **Selecionar arquivo para validar**. Escolha o arquivo no Windows. Com PIN ativo, desbloqueie novamente; depois informe formato exportado, encoding e separador CSV e clique em **Validar arquivo**. O resultado mostra nome, formato, tamanho e quantidade estrutural de registros. CSV mantém essa inspeção até a US-053. A [US-052 integrada ao Desktop](desktop-ofx.md) acrescenta normalização OFX, moeda/período e prévia paginada com proveniência. Nenhum dos fluxos cria lançamentos; staging e revisão seguem nos próximos incrementos.

Seleção cancelada, erro de formato/encoding, arquivo hostil ou limite excedido não criam fontes, itens, efeitos ou movimentações. O cabeçalho preparado anteriormente permanece no histórico. Rejeição ou ACK incerto exige selecionar o arquivo novamente; não existe confirmação financeira nesta ação. O arquivo original permanece intacto e nenhum binário é incluído no cofre ou no backup.

O host confirma o lote e a conta no workspace, abre e lê com limites fora da interface, valida com o scanner Rust e calcula SHA-256. A WebView recebe apenas metadados vinculados ao pedido. A seleção é temporária e consumível; trocas de contexto, bloqueio e cancelamento invalidam o contexto. Dados de arquivo são exibidos somente após desbloqueio e somem ao bloquear. Nunca envie um caminho ou bytes por IPC; o comando fechado recusa esses campos.

## Validação reproduzível

```text
node infra/validation/cli.mjs plan
node infra/validation/cli.mjs run
```

O catálogo conserva 54 protocolos. A ampliação da central Desktop executa os cenários anteriores e novos gates da US-051 nos scopes `us050-desktop-imports-browser` e `us050-desktop-imports-windows`. O nome do scope e o gate histórico `production_35_narrow_permissions` são preservados; o teste atual confere 36 permissões contra o handler de produção. Não execute produtores Cargo simultaneamente nem altere fontes ou `dist` durante a fila.

Testes focados: `node --test infra/scripts/import-files-desktop.test.mjs`, `node infra/import-files-desktop/generate.mjs --check`, `node infra/imports-desktop/browser.mjs` e `node infra/imports-desktop/native.mjs`, após o build. Os produtores mantêm os requisitos Windows/MSVC/Rust/Perl/WebView2, Playwright/Chromium e fixtures FIN-002 sintéticas do projeto. O protocolo nativo compara o ledger antes/depois e verifica preservação do original, isolamento, cancelamento, seleção consumida e descarte de recursos próprios. Os scanners são confrontados com o corpus compartilhado e casos adicionais de UTF-16 e Windows-1252 completo.

O instrumento WebView2 substitui somente o seletor por uma fonte sintética de teste; o comando, privacidade, leitura, validação e interface são reais. Isso não homologa interação humana com o diálogo Windows, Windows Hello ou arquivos bancários reais. Outros parsers, staging, revisão, commit, cloud/Mobile e homologação humana permanecem nos respectivos incrementos. Os resultados abaixo são históricos da US-051; a evidência atual da normalização OFX está no protocolo da US-052 Desktop.

Resultado local em 2026-10-21: `pnpm check` aprovado com 527 testes, sem falhas ou skips, e 54 protocolos atuais. O [relatório Windows](../quality/evidence/runs/61e0652cbe8f9a59e40691f4159d49d945271259829145f3bf636cebcd1becc5.json) conserva os sete testes SQLCipher e 102 vetores da central, acrescenta sete testes nativos de arquivos, 357 vetores de paridade e cinco cenários WebView2 do novo fluxo; também aprova backup/restauração sem as credenciais de origem e limpeza dos recursos. O [relatório Chromium](../quality/evidence/runs/82677d28d6740f3ac626d0d28e6defcb05eafd4388ad807fc4d5aa8d37cd70dc.json) aprova oito gates, incluindo resultado com nome de 254 caracteres sem rolagem horizontal em 390 px. A [barreira compartilhada](../quality/evidence/runs/e12c5ac85e3248286df26f1e181ed9e28930dff51730016a6e02498b989dd5ce.json) aprova 97 casos Node e o corpus correspondente em Chromium. Os sete documentos originais permanecem preservados.
