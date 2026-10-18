# US-044 — Categorias no Desktop

Abra um espaço local e acesse Configurações → Gerenciar categorias. A tela permite criar, renomear, ordenar, arquivar e reativar categorias. Catálogo vazio oferece sugestões pessoais, empresariais ou genéricas conforme a finalidade. A carga é explícita e não reaparece depois de editar ou arquivar categorias existentes. [Núcleo compartilhado](categories.md), [ADR-0057](../architecture/adr/0057-categorias-no-desktop-sqlcipher.md).

Arquivar mantém vínculos e histórico financeiro. Nomes ativos equivalentes são recusados; um nome de categoria arquivada pode ser reutilizado, mas reativar exige disponibilidade. O escopo Receita/Despesa/Ambos e a origem Sugestão inicial/Criada por você são preservados. Ordenação usa todas as categorias ativas, inclusive quando o filtro não as mostra, e deixa arquivadas intactas.

Após resposta perdida, Repetir mesma tentativa conserva IDs e base. Atualizar catálogo e revisar descarta a intenção anterior por ação explícita e consulta o estado atual; conflitos não são rebaseados automaticamente. A tela remove dados e ignora respostas antigas ao bloquear ou trocar de espaço. O modo local funciona sem conta cloud; a prévia no browser continua sem cofre financeiro persistente.

## Implementação e reprodução

O gateway TypeScript envia somente read_local_categories/apply_local_category_change. Rust valida comandos e metadados atuais dentro do cofre, preservando PIN, checagem antes do commit e restauração em staging. A capability possui 25 comandos de produto, sem permissões genéricas de SQL/arquivos. category_model é confrontado com 52 vetores sintéticos gerados pelo serviço compartilhado. A nova dependência Rust unicode-normalization =0.1.26 aplica NFKC; veja a justificativa no ADR.

```powershell
pnpm build
node infra/categories-desktop/generate.mjs --check
node infra/categories-desktop/browser.mjs
node infra/categories-desktop/native.mjs
pnpm check
```

Chromium requer o browser Playwright configurado no ambiente. O protocolo nativo exige Windows x64, Rust 1.99, WebView2 e Perl para o build SQLCipher. Ele cria somente perfis, credenciais, bancos e backups sintéticos próprios em .tools/us044-desktop-categories, verifica ausência de probes no executável padrão e remove os recursos ao encerrar. Use CARGO_BUILD_JOBS=1 para conter o consumo durante a compilação. Não execute protocolos nativos que compartilham o target simultaneamente.

Os cenários verificam sugestões e replay, CRUD de metadados sem exclusão física, ordem, conflito de nome/base, ACK perdido, isolamento, PIN, respostas tardias, acessibilidade, concorrência, rollback de lotes, término de processos e reabertura independente. Categoria efetivamente usada em FIN-002 é renomeada/arquivada sem alterar saldos, alocações ou revisões; os metadados originais são restaurados. Backup é restaurado em outra instalação sem a chave original, com novos IDs e o mesmo grafo semântico.

Os relatórios guardam apenas flags, versões, pendências e hashes, sem payload financeiro. Evidências históricas são preservadas; as afetadas devem ser renovadas pelos respectivos produtores. Nenhum relatório local representa execução de CI remota ou homologação humana.

Resultado local em 2026-10-18: pnpm check aprovado com 398 testes Node, zero falhas/skips, formatação, lint, tipos e build; 19 workspaces e 128 Markdown. Nove testes Rust e 52 vetores de paridade, nove gates Chromium e 16 Windows passaram com recursos próprios encerrados. As regressões afetadas também passaram; 21 cápsulas novas ou renovadas compõem 35 relatórios atuais. Evidências: [Chromium](../quality/evidence/us-044-desktop-categories-browser-2026-10-18.json) e [Windows](../quality/evidence/us-044-desktop-categories-windows-2026-10-18.json).

## Limites atuais

Sem mudança de schema ou formato de backup. Catálogo limitado a 10 mil categorias e ao limite textual existente de 4 Mi unidades UTF-16 em JSON; comandos nativos têm teto de 4 MiB UTF-8. Excesso é recusado, sem retorno parcial. Expansão de Unicode/locale permanece no gate existente da US-021.

Bases comparam metadados atuais e não detectam ABA. Versão/auditoria de categoria, escrita cloud, outbox/feed, recibos duráveis, paginação e outras plataformas permanecem nos próprios incrementos. A [gestão de subcategorias/tags](desktop-taxonomy.md) foi integrada posteriormente na US-045. Associação e filtros na tela de movimentações são o próximo incremento; rateio permanece na US-046. Homologações humanas ficam após a integração completa. DP-01 a DP-04 e os sete originais permanecem preservados.
