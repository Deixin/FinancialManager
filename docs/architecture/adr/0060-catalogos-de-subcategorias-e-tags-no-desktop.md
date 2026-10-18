# ADR-0060 — Catálogos de subcategorias e tags no Desktop

Data: 2026-10-18. Estado: adotado no recorte de catálogos Desktop da US-045; editor de classificação e filtros de movimentações pendentes.

## Contexto

ADR-0058 define catálogos compartilhados e ADR-0059 define associação às transações. O Desktop já possui categorias, bloqueio, SQLCipher, backup e restauração. Este incremento integra a gestão de subcategorias/tags em Configurações. A integração das associações e dos filtros financeiros será feita na tela de movimentações em incremento separado, preservando as revisões existentes.

## Decisão

LocalTaxonomyFlow é uma subvista de Configurações com criação de tags/subcategorias, edição de nome, pesquisa, filtros de tipo/estado, arquivamento/reativação e ordem completa dos filhos ativos de cada categoria. Pais seguem a ordem das categorias; o pai de uma subcategoria existente não é editável. Tags não têm ordem persistida. Categoria sem estado ativo impede criação/reativação de filhos. Arquivamento conserva os registros e vínculos, sem exclusão física. A tela explica que tags sobrepostas não são parcelas aditivas do orçamento.

Os comandos read_local_taxonomy e apply_local_taxonomy_change usam o LocalState e o cofre já existente. A leitura ocorre em snapshot SQLCipher; a escrita usa transação imediata, valida todo o plano antes das escritas e confirma sob a verificação de bloqueio. PIN impede a liberação da chave; restauração preparada impede escrita concorrente. Não há SQL genérico no IPC. A lista de produto passa de 25 para 27 comandos específicos; probes permanecem condicionados a features de teste.

Rust replica a política de domain/taxonomy, com catálogo e comandos fechados, UUIDs canônicos, UUIDv7 para criação, bases completas e nome normalizado. Reutiliza a normalização já adotada na US-044, sem dependência nova. As 77 entradas sintéticas de paridade cobrem tipos, rótulos, UTF-16, normalização, pais, estados, replay, duplicatas legadas, bases e reordenação. A ampliação de Unicode/locale permanece no gate existente; não se afirma equivalência para todo alfabeto.

O gateway confere o catálogo completo, as categorias de contexto, os IDs alterados e changed contra os planos compartilhados. CREATE exato pode confirmar uma repetição após ACK perdido; UPDATE/reordenação exigem bases correntes. Intenção, IDs e base ficam congelados após resultado incerto; a tela oferece repetição idêntica ou atualização explícita para revisão. Não se refaz a intenção com nova identidade automaticamente. Respostas inválidas não são aceitas como sucesso.

Troca de workspace remonta a subvista por ID e descarta o estado anterior. Bloqueio remove a árvore e os dados transitórios; respostas tardias são ignoradas. O navegador comum não habilita um cofre persistente. Não há escrita em localStorage, sessionStorage, IndexedDB ou envio externo. Dados do catálogo permanecem apenas no SQLCipher e na memória do renderer autorizado.

O catálogo limita 10 mil itens de taxonomia, além das categorias, e 4 Mi unidades UTF-16 de JSON. O comando IPC também limita a serialização UTF-8 a 4 MiB. Excesso é recusado sem truncamento. Bases comparam metadados atuais, sem detectar ABA. Versão/auditoria dos catálogos, escrita cloud, outbox/feed e recibos duráveis permanecem pendentes.

## Consequências e verificação

Sem migration, formato de backup, dependência de produção, integração externa ou alteração das regras monetárias. Vínculos de tags/subcategorias usados por transações e suas revisões permanecem intactos. Restauração continua em staging e cria novo workspace, com novos IDs, relações e chave. A prova portátil descarta a chave de origem antes de restaurar em outra instalação.

Testes Rust exercitam paridade, transações, concorrência pelo proprietário LocalState, limites, PIN e reabertura cifrada. Chromium verifica CRUD, pesquisa, ordem, conflito, ACK perdido, respostas tardias, isolamento, acessibilidade e ausência de persistência/egresso. WebView2 usa os comandos reais, com repetição da mesma intenção; processos independentes verificam reabertura, dados usados, falhas durante/depois da transação e restauração portátil. Consulte o [guia](../../development/desktop-taxonomy.md).

A integração do editor de classificação e dos filtros de movimentações na US-045 é o próximo incremento; US-046 mantém o editor de rateio. DP-01 a DP-04, os sete originais e homologações humanas após integração completa são preservados.
