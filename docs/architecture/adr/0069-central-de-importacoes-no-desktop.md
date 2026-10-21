# ADR-0069 — Central de importações no Desktop e restauração v3

Estado: aceito. Data: 2026-10-20. História: US-050, IM-01/09.

## Contexto e decisão

O [ADR-0068](0068-central-compartilhada-de-importacoes.md) manteve o ledger v3 opt-in até integrar interface, Rust, backup e restauração. Este incremento ativa a v3 no catálogo nativo Windows. Os catálogos padrão compartilhados PostgreSQL/SQLite continuam na v2; a composição compartilhada de importações mantém sua adoção explícita. Não altera gates cloud/Mobile, outbox/feed ou DP-01 a DP-04.

A navegação Importações lista lotes por conta/estado, exibe fontes, período, autor, contagens e efeitos com movimentações/revisões. Há três comandos específicos: `list_local_imports`, `read_local_import` e `prepare_local_import`, totalizando 35 permissões de produto. Workspace, chave Windows e bloqueio local continuam no controlador existente. O host captura e valida a intenção novamente, usa o relógio nativo e não recebe SQL, caminhos, autor, timestamps ou valores para preparar um lote.

Rust mantém a política do port compartilhado para a autoridade LOCAL com acesso a todas as contas do próprio workspace. Leituras usam uma transação de snapshot; preparação usa BEGIN IMMEDIATE e valida conta ativa antes de criar IMPORT/PREPARING v1. Replay de ID/conta/autor retorna o estado atual; divergência conflita. Uma nova gravação é recusada com restauração preparada e o bloqueio é conferido antes do commit. Os limites compartilhados são preservados, sem truncar lotes ou declarar uma página incompleta como completa.

A interface valida respostas contra a intenção capturada e mantém o mesmo UUID/conta após ACK perdido ou malformado. Respostas de componentes encerrados por troca de workspace/bloqueio são descartadas. A página usa memória transitória; não persiste informações financeiras no navegador. Metadados e conteúdo de linhas não entram em logs operacionais. Preparar um cabeçalho não altera saldos nem revisões.

## Migração, backup e restauração

Novos cofres e backups usam schema v3. Abertura migra v1/v2 existentes sob a transação do migrador, com verificação de schema/checksums/integridade antes e depois; `user_version` só é atualizado quando necessário. A migration v3 não converte nem remove dados financeiros.

O pacote criptografado continua no formato v1, com AES-GCM, Argon2id, snapshot SQLCipher e senha independente. Aceita snapshots autenticados de schemas conhecidos v1–v3; futuras versões são recusadas. Antes de migrar um backup antigo, verifica exatamente seu schema, histórico, manifesto, contagens e integridade. Migra somente a cópia protegida em staging. Manifesto/pacote originais não são reescritos. As contagens da prévia refletem o staging normalizado, incluindo zeros nas quatro tabelas novas; o histórico de migrations é validado na versão atual.

Restauração cria outro workspace, chave e geração. Remapeia lotes, fontes, itens, efeitos, contas, movimentações e revisões por suas FKs tipadas. Referências de reversão podem apontar para um lote inserido depois: FKs permanecem habilitadas e são diferidas até o commit da cópia. IDs externos e JSON opaco de proveniência não são substituídos por coincidência textual. Valores INTEGER, descrições originais, hashes e versões de leitores são preservados. Não há perda do ledger em backup nem sobrescrita da instalação de origem.

Além de schema/constraints/FKs, backup e restauração verificam a semântica dos metadados de lotes, fontes e efeitos. Nome de arquivo com caminho, formato inválido ou ligação inconsistente impede a publicação. Não há dependência de produção nova.

## Verificação e limites

O [protocolo Desktop](../../development/desktop-imports.md) compara 102 vetores TypeScript/Rust e testa SQLCipher, replay, rollback, filtros, paginação, isolamento, reabertura e portabilidade. Chromium e WebView2 exercitam a interface, resposta perdida, bloqueio e ausência de persistência/egress. O teste de backup antigo verifica migração v2 em staging e preservação dos bytes da origem; o de v3 inclui as quatro tabelas, efeitos de seis ações, revisão ligada à transação correta e referência de reversão em ordem inversa de inserção.

Seleção/validação defensiva de arquivo, parsers, revisão editável, deduplicação e confirmação financeira pertencem às US-051–057 e histórias correspondentes. A interface informa essa próxima etapa e oferece preparação de cabeçalho. Não habilita reversão financeira por um link de histórico. Homologações humanas permanecem após a integração completa; execução local não presume CI remota ou distribuição assinada.
