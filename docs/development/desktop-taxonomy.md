# US-045 — Catálogos de subcategorias e tags no Desktop

Configurações → Gerenciar subcategorias e tags integra o [catálogo compartilhado](taxonomy.md) ao SQLCipher local. Inclui criação, edição, pesquisa, filtros de tipo/estado, arquivamento, reativação e ordem de subcategorias. [ADR-0060](../architecture/adr/0060-catalogos-de-subcategorias-e-tags-no-desktop.md). O [núcleo de associação](classification.md) já existe; sua tela e os filtros de movimentações são o próximo incremento.

## Comportamento e limites

Subcategorias pertencem a uma categoria e mantêm esse pai. A seleção de criação mostra apenas categorias ativas; se nenhuma existir, a tela orienta criar/reativar em Gerenciar categorias. Pais e filhos seguem as respectivas ordens. Tags são independentes e pesquisáveis. Nomes ativos equivalentes conflitam por workspace para tags e por categoria para subcategorias. Arquivar conserva vínculos e histórico; reativar exige nome disponível e pai ativo. Duplicatas legadas podem ser corrigidas gradualmente por arquivamento.

As tags não representam parcelas aditivas do orçamento. Este incremento edita somente metadados de catálogo: conta, valor, data, natureza econômica, classificação financeira já gravada e revisões de movimentações permanecem iguais. Não se move subcategoria entre categorias nem se exclui fisicamente um item usado.

O gateway usa read_local_taxonomy/apply_local_taxonomy_change e valida DTOs fechados e o ACK completo contra o Domain. O Rust aplica as mesmas regras dentro da transação. A capability de produto possui 27 comandos específicos; nenhum comando aceita SQL ou caminho de arquivo arbitrário. PIN e bloqueio são verificados antes da chave; restauração preparada impede escrita. Antes do commit, o bloqueio é conferido novamente.

Após ACK perdido, intenção, IDs e bases permanecem congelados. Repetir CREATE exato confirma sem duplicar; UPDATE/reordenação com base antiga retornam conflito. Atualizar catálogo descarta a intenção para revisão explícita, sem rebase automático. Sair e voltar à subvista recarrega o catálogo. Troca de espaço e bloqueio descartam a árvore anterior; respostas atrasadas não a reabrem.

O catálogo admite 10 mil itens de taxonomia, além das categorias, e até 4 Mi unidades UTF-16 de JSON. O comando IPC impõe também 4 MiB UTF-8. Não há truncamento nem catálogo persistente no navegador. Bases completas não detectam ABA. Normalização usa o corpus português/NFKC existente, incluindo limites UTF-16; expansão de Unicode/locale continua no gate da US-021.

## Reprodução

```powershell
pnpm build
node infra/taxonomy-desktop/generate.mjs --check
node infra/taxonomy-desktop/browser.mjs
node infra/taxonomy-desktop/native.mjs
pnpm check
```

Chromium usa somente um transporte sintético em memória. No Windows, o runner compila Tauri com Cargo.lock, Clippy, nove testes Rust e 77 vetores de paridade, confere as 27 permissões e a ausência de probes no handler de produção e executa WebView2 oculto. O aplicativo normal é construído separadamente, sem features de smoke. Os binários taxonomy-probe/taxonomy-smoke exigem taxonomy-smoke; a permissão de finalização existe apenas no host de teste.

Os testes de processo verificam reabertura, preservação de itens usados, rollback da reordenação após a primeira linha e antes do commit, commit completo após interrupção, conflito na repetição de base antiga e restauração em outra instalação após descartar a chave de origem. Chaves Windows, políticas, perfis, bancos e arquivos temporários próprios são removidos. Execute protocolos nativos sequencialmente: compartilham o target Cargo e controlam seus próprios diretórios de fixture; não use dados pessoais.

O relatório local é gerado em .tools/us045-desktop-taxonomy/browser.json e windows.json. As evidências versionadas são [Chromium](../quality/evidence/us-045-desktop-taxonomy-browser-2026-10-18.json) e [Windows](../quality/evidence/us-045-desktop-taxonomy-windows-2026-10-18.json). Os validadores exigem todos os gates, limpeza, versões e hashes atuais. Relatórios antigos permanecem históricos; versões antigas dos esquemas de evidência só são aceitas explicitamente sem correspondência de fontes atuais.

Validação local concluída em 2026-10-18: pnpm check passou com 426 testes Node, zero falhas/skips, formatação, lint/fronteiras/geração, tipos e build; 19 workspaces e 134 Markdown. A suíte própria aprovou nove testes Rust, 77 vetores compartilhados, nove gates Chromium e 16 Windows. Todas as regressões Desktop afetadas foram reexecutadas em Chromium/Windows. Foram arquivadas 23 cápsulas novas ou renovadas; 39 evidências atuais conferem com 433 hashes de fontes no Git staging. Os 16 relatórios de dados/infraestrutura não afetados tiveram a atualidade das fontes verificada. Recursos sintéticos próprios encerrados. Isso não representa execução de CI remota, integração do editor financeiro desta história ou homologação humana.

## Próximo incremento

Integrar a [associação versionada e os filtros](classification.md) à tela de movimentações, com leitura autorizada completa e paridade Rust. A US-045 continua em andamento até essa integração. US-046 mantém o editor de rateio. Nenhuma migration, dependência de produção ou mudança de backup foi necessária. Escrita cloud/outbox/feed, versão/auditoria dos metadados, paginação e outras plataformas continuam pendentes. Homologações humanas seguem após integração completa; DP-01 a DP-04 e os sete originais permanecem intactos.
