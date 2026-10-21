# ADR-0070 — Validação incremental e evidências imutáveis

Estado: aceito. Data: 2026-10-21. Escopo: processo de desenvolvimento após US-050, antes da US-051. Autorizado pelo usuário para melhorar tempo sem reduzir segurança ou integridade financeira.

## Problema

Os relatórios herdavam hashes dos próprios consumidores. Renovar uma referência em um teste invalidava protocolos SQLCipher/WebView2 já aprovados. Na US-047, referências antigas em 12 carregadores provocaram nova rodada nativa de aproximadamente 44 minutos. As filas temporárias por história também repetiam descoberta, arquivamento e conferência de fontes. O histórico e o estado atual estavam misturados em documentos extensos.

## Decisão

O catálogo versionado em `infra/validation/catalog.json` identifica cada protocolo por scope, comando, produtor, validador, função de hashes e resultado vigente. Os 53 resultados iniciais foram importados somente após passar pelos validadores originais com correspondência estrita de fontes. Seus bytes, datas, checks, versões e pendências permanecem intactos; importação do catálogo não significa reexecução.

Novos resultados são arquivados pelo SHA-256 dos bytes, com criação exclusiva. O catálogo registra também o digest canônico do conteúdo. Alteração dos bytes, scope, checks ou fontes não pode ser aceita como o resultado anterior. O executor exige saída bem-sucedida, resultado recente do produtor, validador original estrito e entradas estáveis antes/depois da execução. Cada entrada aprovada é publicada atomicamente; falha posterior mantém o incremento pendente e permite retomar somente resultados ainda válidos.

A validade funcional considera os arquivos declarados pelos produtores existentes. Exclui apenas `infra/scripts/*.test.mjs`: esses arquivos são consumidores e testes Node executados novamente pelo `pnpm check` obrigatório, não código executado pelos protocolos de banco/WebView2. Produtores, fixtures, validadores, código de produto, dependências, build e configuração permanecem no cálculo. A primeira versão conserva as dependências herdadas de forma conservadora; não usa heurísticas de similaridade para presumir ausência de impacto.

Um adaptador restrito permite que os consumidores antigos consultem o catálogo sem editar seus nomes de relatório em cada história. Apenas os nomes explicitamente registrados como atuais são aliases; nomes históricos continuam lendo seus próprios bytes. O caminho de compatibilidade exige relatório íntegro e registrado e igualdade das fontes funcionais. A opção histórica `matchSources: false` serve apenas para verificar formato/checks depois dessas verificações; jamais é, isoladamente, prova de validade atual. Os validadores usados pelos produtores não foram relaxados.

Guardas comuns propagam alterações em migrations, schema, autorização/escopo, dinheiro, revisões, chaves, cofre, comandos, backup e restauração para todas as entradas do runtime afetado. Guardas Desktop atingem seus protocolos Chromium/Windows; guardas financeiros compartilhados atingem ambos os runtimes. O inventário também compara arquivos rastreados e não rastreados: entrada funcional nova/alterada sem cobertura declarada bloqueia a conclusão. O inventário não pode ser atualizado para ocultar uma mudança; deve-se registrar o arquivo na função de fontes do protocolo responsável e validar a cobertura.

## Execução e garantias

- `plan`: explica protocolos pendentes, fontes alteradas, reutilização e entradas sem cobertura.
- `run`: executa verificações rápidas antes de protocolos longos; constrói os pacotes uma vez como preparação; executa a fila selecionada; arquiva resultados; executa sempre `pnpm check` e reconfere as entradas.
- `run --suite=scope`: força uma verificação adicional sem retirar protocolos pendentes do plano.
- `run --full`: executa todos os protocolos cadastrados antes de release/marco integrado.
- `check`: audita o catálogo; integra também a suíte Node obrigatória.

O runner tem exclusão mútua, logs locais por etapa e duração medida. A fila permanece serial porque Cargo, WebView2 e alguns recursos de protocolo são compartilhados. Protocolos não afetados não reconstroem seus binários; protocolos executados continuam usando seus builds e testes originais, com cache Cargo/Turbo existente. Não foram combinadas features Rust incompatíveis nem suprimidos checks de binário de produção. Otimizações adicionais dentro da compilação exigem medição e validação próprias.

O protocolo aprovado continua sendo evidência do ambiente e data registrados, não execução nova na máquina atual. Atualizações de ferramentas/dependências exigem registrar a configuração e revalidar; release e homologação de novo ambiente usam execução completa. CI, plataformas ausentes e homologação humana não são inferidas de evidências reutilizadas.

Formatos legados sem timestamp próprio, como o da US-050 Desktop, conservam seus bytes. O executor exige gravação do arquivo de saída dentro do intervalo da execução e registra início/fim separadamente no catálogo. Saída antiga deixada por uma execução anterior é recusada mesmo quando o processo retorna sucesso.

## Documentação e limites

Índice, status e plano de testes atuais tornam-se curtos. As versões anteriores são preservadas integralmente em arquivos históricos no mesmo diretório, conservando referências relativas. Os documentos originais de produto e arquitetura não mudam. AGENTS.md aponta para contexto pertinente e comandos reproduzíveis.

Este ADR substitui a exigência operacional anterior de renovar protocolos apenas porque mudou o consumidor/referência do relatório. Preserva todos os critérios funcionais, fixtures, checks, RLS, isolamento, criptografia, atomicidade, restauração e `pnpm check`. Não resolve DP-01 a DP-04, não inicia US-051 e não autoriza commit, push ou deploy.

Consulte o [processo operacional](../../development/validation-workflow.md) e o [plano de testes atual](../../quality/test-plan.md).
