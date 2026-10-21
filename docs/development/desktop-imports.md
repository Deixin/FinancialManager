# US-050 — Central de importações no Desktop

A [US-051 Desktop](desktop-import-files.md) amplia esta entrega com seleção e validação defensiva, 36 permissões e paridade Rust. Os detalhes e resultados US-050 abaixo preservam o escopo histórico; parsing, revisão e confirmação financeira continuam nos incrementos posteriores.

A navegação Importações consulta lotes do workspace local com filtros de conta/estado, paginação, fontes, período, contagens e efeitos ligados ao detalhe/histórico das movimentações. Preparar lote registra somente IMPORT/PREPARING em conta ativa. A seleção e revisão de arquivos entram nos próximos incrementos. Decisão: [ADR-0069](../architecture/adr/0069-central-de-importacoes-no-desktop.md); base compartilhada: [central US-050](import-central.md).

## Implementação

O gateway TypeScript valida payloads e respostas por formato exato, IDs, ordenação, cursor, contagens e intenção. ACK incerto conserva UUID/conta para replay explícito. Bloqueio e troca de workspace desmontam a página e invalidam respostas tardias. A abertura de efeito navega para a movimentação correspondente, incluindo histórico existente e descrições originais.

`import_model.rs` contém validação pura equivalente ao Domain/contratos, incluindo UTF-16, datas/instantes canônicos, limites e contagens i64 em strings decimais. `local_imports.rs` usa SQLCipher em snapshot e BEGIN IMMEDIATE para preparação, com workspace/chave/controlador existentes. São 35 permissões específicas, sem SQL genérico, filesystem, chaves ou comandos de teste em produção.

O catálogo nativo migra para v3 junto com backup e restauração. Novos backups incluem o ledger completo; pacotes autenticados v1–v3 continuam no formato v1. Restauração verifica a versão original, migra a cópia em staging e cria nova autoridade. As quatro tabelas participam das contagens, remapeamento tipado de IDs e validação semântica. Dinheiro, descrições, proveniência estruturada, nomes/hashes e versões dos leitores são preservados. O pacote e o workspace de origem não são alterados.

## Validação reproduzível

Use Node/pnpm fixados no projeto. Execute `pnpm build`, `node infra/imports-desktop/generate.mjs --check`, `node infra/imports-desktop/browser.mjs`, `node infra/imports-desktop/native.mjs` e `pnpm check`. Chromium exige Playwright instalado; Windows x64 exige Rust/MSVC, Perl/OpenSSL do protocolo existente, WebView2 e Credential Manager. Não execute produtores nativos simultaneamente, pois compartilham o target Cargo. Não recompile `dist` enquanto protocolos o carregam.

O protocolo nativo executa clippy, sete testes SQLCipher e 102 vetores compartilhados, compara as 35 permissões com o handler real, verifica reabertura em processos independentes e exercita o WebView2 real. Também compara as páginas SQLCipher, filtros por estado/conta, detalhes paginados, preparação, replay e conflito com o port TypeScript real, usando o mesmo conjunto sintético e o instante observado no host. O backup v3 é restaurado em outra instalação após remover as credenciais sintéticas de origem. Testes adicionais cobrem backup v2 autenticado, migração em staging, valores acima de 2^53, rollback e metadados inválidos. Chromium verifica filtros/detalhe/histórico, ACK perdido/malformado, isolamento, respostas tardias após troca/bloqueio, acessibilidade e ausência de storage/egress.

Relatórios próprios ficam em `.tools/us050-desktop-imports/{browser,windows}.json`, com checks e SHA-256 exatos. Somente relatórios completos aprovados e com recursos encerrados são arquivados em `docs/quality/evidence`. Protocolos anteriores afetados também precisam ser renovados antes da validação final. Recursos usam apenas FIN-002 e fixtures explicitamente sintéticas; chaves, perfis, bancos e pacotes de teste são removidos pelo produtor.

Resultado local: `pnpm check` aprovado com 510 testes Node, sem falhas ou skips. Sete testes SQLCipher, 102 vetores e a comparação direta de páginas/detalhes/preparação/replay com o port compartilhado passaram, junto dos fluxos de interface e portabilidade. Consulte as evidências [Chromium](../quality/evidence/us-050-desktop-imports-browser-2026-10-20.json) e [Windows/WebView2](../quality/evidence/us-050-desktop-imports-windows-2026-10-20.json). Foram renovados 31 relatórios dos 16 protocolos Windows e 15 Chromium anteriores, e arquivados os dois novos: 53 relatórios atuais conferem com 579 hashes únicos de fontes. Os 20 relatórios não afetados e os sete documentos originais permanecem preservados. Recursos sintéticos próprios encerrados; sem presumir CI remota ou homologação humana.

## Próximos passos

US-051 inicia validação defensiva de arquivos; parsers, revisão e confirmação financeira seguem US-052–057. Web/Mobile, sincronização e distribuição mantêm seus gates. Homologação humana segue pós-integração, conforme instrução do usuário e ADR-0044.
