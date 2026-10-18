# ADR-0061 — Filtros de classificação no Desktop

Data: 2026-10-18. Estado: adotado no recorte de consulta da US-045; editor financeiro versionado pendente.

## Contexto

ADR-0058/0060 integram os catálogos e ADR-0059 fornece associação compartilhada e filtros puros. Esses filtros exigem snapshot autorizado, consistente e completo. Filtrar uma página carregada ou consultar catálogo e transações em momentos diferentes não atende essa condição. A edição financeira ainda precisa integrar o coordenador nativo de revisões e a cobertura completa dos membros de grupos.

## Decisão

Movimentações oferece a subvista Filtrar por classificação. O comando existente read_local_movements recebe a opção booleana includeClassification. Ausência/false conserva a resposta anterior; true acrescenta classification com o catálogo do mesmo workspace. A capability e o handler de produção permanecem com 27 comandos específicos. A opção não aceita SQL, paginação arbitrária, contas externas ou contexto de autorização do renderer.

LocalState aplica o bloqueio antes de liberar a chave Windows. O adapter abre uma única transação SQLCipher de leitura, consulta todos os registros, saldos/referências e histórico existentes e lê os catálogos antes de fechar esse snapshot. Confere referências de categoria, subcategoria/pai e tags, incluindo as arquivadas. A resposta não altera o cofre nem cria revisões. O gateway recusa DTOs incompletos, campos adicionais, escopo divergente e referências inconsistentes.

O limite específico é 10 mil estados de transação e 4 Mi unidades UTF-16 de JSON desses estados, incluindo os apagados. Permanecem os limites existentes de movimentações/histórico (200 mil registros e 32 MiB), além dos limites próprios do catálogo. Qualquer excesso recusa a consulta inteira. Não há truncamento, página apresentada como universo completo ou total financeiro parcial.

O renderer chama domain/classification sobre essa cobertura autorizada. Categoria e subcategoria precisam coincidir na mesma parcela. Tags usam ANY/ALL, com lista vazia sem restrição, e sem classificação significa ausência de alocações monetárias mesmo quando existem tags. Datas e conta compõem os critérios. Registros apagados são omitidos. Cada transação aparece uma vez; valores e natureza econômica permanecem intactos. A interface avisa que tags sobrepostas não são parcelas aditivas do orçamento e mostra parcelas/referências no detalhe, sem calcular subtotais.

Atualização explícita descarta resultado anterior e critérios, solicitando novo snapshot completo. Em erro não conserva a lista antiga como se fosse atual. A troca de workspace remonta a subvista pelo ID e o bloqueio remove a árvore financeira; respostas tardias são ignoradas. O navegador comum continua sem cofre persistente. Não se escreve em armazenamento do navegador nem se envia dados para serviços externos.

## Consequências e verificação

Sem migration, dependência de produção, mudança de backup ou integração externa. Reutiliza o protocolo existente de chaves/backup/restauração. Os testes específicos conferem leitura sem alteração do ciphertext, grafo financeiro e auditoria, reabertura independente, isolamento, limites e PIN. Chromium e WebView2 exercitam filtros, dados arquivados, respostas atrasadas, bloqueio e ausência de persistência/egresso. Chromium também verifica acessibilidade, teclado, cores forçadas e reflow a 320 px/200%.

Este recorte não conclui a US-045: próximo incremento é o editor de classificação sobre revisões, preservando bases completas e pares de grupos. Editor de rateio US-046, paginação cloud autorizada, outbox/feed, outras plataformas e homologações humanas após integração completa permanecem nos próprios gates. DP-01 a DP-04 e os sete documentos originais permanecem intactos. Consulte o [guia](../../development/desktop-classification-filters.md).
