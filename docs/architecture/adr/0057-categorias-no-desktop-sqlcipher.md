# ADR-0057 — Categorias no Desktop SQLCipher

Data: 2026-10-18. Estado: adotado no Desktop local da US-044; homologação humana pós-integração.

## Contexto

O núcleo da US-044 já define sugestões explícitas v1, bases completas, arquivamento e reordenação integral (ADR-0056). O Desktop precisa oferecer esse comportamento sem confiar na WebView ou alterar referências financeiras existentes. Subcategorias, tags e associação/rateio continuam nas US-045/046.

## Decisão

Configurações oferece Gerenciar categorias, com lista de ativas/arquivadas, criação, renomeação, ordenação e arquivamento/reativação. Catálogo vazio oferece sugestões conforme a finalidade; carregá-las exige ação explícita. Catálogo existente não recebe reset ou merge automático de padrões.

Dois comandos fechados, read_local_categories/apply_local_category_change, elevam a capability a 25 permissões específicas. Não expõem SQL, caminhos, chaves ou credenciais. LocalState conserva bloqueio opcional, isolamento por workspace e recusa de escrita durante restauração preparada. O Rust confirma novamente a autorização antes do commit quando a política de bloqueio estiver ativa.

category_model mantém política pura em Rust, confrontada com 52 casos gerados pelo serviço compartilhado TypeScript. local_categories lê um snapshot consistente e executa lotes na mesma transação SQLCipher BEGIN IMMEDIATE. Scope e is_seeded são imutáveis após criação. Arquivamento não altera transações, alocações, saldos ou revisões financeiras. Limites recusam excesso sem truncar o catálogo.

A dependência de produção unicode-normalization =0.1.26 foi acrescentada para executar NFKC no Rust e derivar normalized_name sem confiar em valores fornecidos pela WebView. A versão permanece fixa em Cargo.toml/Cargo.lock. A biblioteca fornece normalização Unicode, conforme sua [documentação primária](https://docs.rs/unicode-normalization/0.1.26/unicode_normalization/). Os testes mantêm o corpus português/NFKC da decisão anterior; não aprovam equivalência universal entre locales/engines.

Gateway valida DTO completo, IDs e catálogo retornado contra a intenção. Após falha de transporte, a interface conserva comando, IDs e base até repetição ou revisão explícita. Não altera intenção nem reaplica defaults sobre catálogo editado. Troca de workspace e bloqueio removem a árvore anterior e descartam respostas tardias. Prévia no browser não cria cofre persistente.

Não há migration nem novo formato de backup. A restauração existente conserva metadados e proveniência de categorias, gerando novos IDs/autoridade; o protocolo testa outra instalação depois de remover a chave de origem. Instrumentação de falhas e WebView fica sob categories-smoke e ausente do executável padrão. Essa ausência é aferida por features, handler/capability e marcadores de código de teste; o catálogo de metadados Tauri pode conter nomes de permissões geradas sem expor seus comandos ao produto.

## Limites e verificação

Bases completas detectam divergências atuais, mas não ABA. Versão monotônica, auditoria de categoria, escrita cloud, outbox/feed e recibos duráveis continuam pendentes. O Desktop não cria associações novas de transações neste incremento. US-045 é o próximo passo.

Verificação automatizada inclui paridade, SQLCipher real, PIN, concorrência, falhas antes/depois do commit, edição de categoria efetivamente usada, preservação do grafo financeiro, Chromium/WebView2, repetição após resposta perdida, acessibilidade, restauração portátil e descarte de recursos próprios. [Reprodução](../../development/desktop-categories.md).

DP-01 a DP-04 e os sete documentos originais permanecem preservados. Homologações humanas ocorrem após integração completa, conforme ADR-0044 e instrução do usuário.
