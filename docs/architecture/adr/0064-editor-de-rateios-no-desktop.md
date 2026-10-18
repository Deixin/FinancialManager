# ADR-0064 — Editor de rateios no Desktop

Data: 2026-10-18. Estado: adotado na integração local da US-046; protocolos aprovados conforme o guia.

## Contexto

US-046 e MV-04 exigem parcelas com categorias distintas, soma igual ao módulo da movimentação e tags preservadas. ADR-0063 entregou a política compartilhada. O Desktop já possui consulta completa de classificação, histórico e gravador de revisões SQLCipher, mas seu editor anterior conserva rateios existentes.

## Decisão

Editar rateio fica no detalhe da consulta de classificação, também acessível a partir de Movimentações. O editor é carregado sob demanda e oferece KEEP, CLEAR e REPLACE. Exibe total, soma e diferença exatos; uma substituição exige parcelas positivas, categoria por linha e diferença zero. Adicionar/remover linha é explícito. CLEAR remove todas as parcelas mantendo tags. Valores usam entrada decimal brasileira sem separador de milhares e nunca passam por float.

O gateway usa a política compartilhada do ADR-0063, captura/fixa IDs e base, valida ACK e consulta o estado e os snapshots persistidos. Falha após despacho conserva a intenção e bloqueia mudanças. Repetição envia a mesma tentativa; consulta explícita permite revisar o resultado. Não há reconstrução de IDs, rebase ou preenchimento automático. Resposta tardia de árvore fechada não dispara leitura posterior. Troca de espaço e bloqueio descartam a árvore financeira.

O comando específico apply_local_allocation_change eleva a capability de produção de 28 a 29 comandos. Não aceita SQL, ator, valores financeiros adicionais ou alterações de tags. LocalState exige desbloqueio antes de obter a chave, recusa escrita com restauração preparada e confere bloqueio antes do commit. A política Rust é confrontada com vetores produzidos pelo serviço compartilhado e pelo gateway.

Allocation_model planeja a revisão existente; local_allocations lê estado/conta/catálogo e valida todos os planos e grupos antes da primeira escrita. A persistência usa o gravador de revisões financeiro existente em BEGIN IMMEDIATE. Não há migration ou segundo caminho de gravação. Referências vêm do módulo proprietário. Grupos usam o mesmo validador nativo da classificação: dois membros atuais, contas ativas e composição real; somente o membro alterado recebe auditoria.

Mantêm-se os limites compartilhados: até 256 transações únicas, uma a mil parcelas em REPLACE e 4 Mi unidades UTF-16 por lote. O IPC também recusa mais de 4 MiB UTF-8. A soma nativa usa i128; cada parcela continua positiva i64. O mínimo i64 pode ser dividido em duas ou mais parcelas válidas, sem overflow. Zero permite KEEP/CLEAR. Base integral, categorias/subcategorias, escopo econômico, arquivamento e IDs seguem ADR-0063. Valores, conta, data, contraparte, grupo, tags, descrições, origem e natureza econômica ficam preservados.

## Consequências e verificação

Sem dependência de produção, formato de backup ou endpoint novo. A US-046 integra política compartilhada e Desktop local; Cloud/Mobile, outbox/feed, recibos duráveis, reconciliação de itens e descontos de documentos mantêm seus gates. Próxima história: US-047, contrapartes normalizadas. Nomes de metadados no histórico continuam resolvidos pelo catálogo atual conforme ADR-0062.

O [guia](../../development/desktop-allocations.md) registra paridade Rust/TypeScript, testes SQLCipher, Chromium e WebView2, interrupção em três fases, reabertura e restauração em outra instalação sem a chave de origem. Os protocolos usam dados sintéticos e publicam apenas flags, versões e hashes. Homologações humanas seguem após a integração completa; os sete originais e DP-01 a DP-04 permanecem preservados.
