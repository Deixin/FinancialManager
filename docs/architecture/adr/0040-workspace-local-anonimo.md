# ADR-0040 — Workspace local anônimo e persistência mínima protegida

Status: adotado e validado para criação/reabertura em Windows x64; G07-VAULT/US-032 ampliados permanecem abertos.

Data: 2026-10-17. História: US-031. Referências: RF-02–03, WS-01, arquitetura §05, ADR-0024/0032/0033/0034/0039.

## Contexto

US-030 chega ao modo local sem persistir espaço. A autoridade local precisa ser SQLCipher no Rust com chave do SO; gravar metadados em texto ou storage WebView apenas para adiar US-032 criaria formato intermediário inseguro e migração desnecessária. O schema de produto v2 está validado, mas o spike não é persistência de produto.

## Decisão

Antecipar somente a fundação de cofre necessária à US-031, com pins já provados e namespace próprio de credenciais/arquivos. Cada workspace é um banco SQLCipher de produto, sem tabelas cloud. Nome/finalidade/LOCAL/BRL são persistidos sem criar usuário, membro ou token remoto. Nenhum dado fiscal é obrigatório ou coletado no guia atual.

Separar modelo puro Rust, credenciais, migrations, coordenação de instalação e comandos. UI envia somente UUIDv7 de pedido/nome/finalidade; Native valida novamente e determina storage/paths. Pedido igual é idempotente; ID publicado com conteúdo diferente gera conflito. Lock por instalação e staging com publicação por rename impedem resultados parciais visíveis. Recuperação limpa apenas criações não publicadas e suas chaves. Fonte de UUID/tempo segue os codecs/CSPRNG da US-023; nenhum ID interno é identidade cloud ou rastreamento.

O catálogo nativo gerado referencia as migrations v1/v2 existentes e repete checksums da US-022. Reabertura valida histórico/schema/integridade antes de ler o espaço; não há importação silenciosa do schema experimental ou downgrade. Secret store indisponível/chave ausente não provoca regeneração, plaintext ou substituição de arquivo. SQL permanece exclusivamente no core, com escrita de workspace pertencente ao módulo workspaces.

Esta decisão substitui no ADR-0039 somente a ausência de IPC/armazenamento de produto: a janela ganha três comandos tipados de criação/listagem/abertura. Mantém CSP, assets locais, ausência de SQL/FS/secrets genéricos e separação do binário de homologação. @tauri-apps/api 2.12.4 é dependência explícita para o invoke público; demais dependências nativas reutilizam pins existentes, justificadas no [guia](../../development/local-workspaces.md).

## Alternativas e consequências

Persistência WebView/plaintext violaria a fronteira. Reusar a base sintética confundiria schema e dados de spike. Adiar toda criação até backup/restore bloquearia o incremento sem melhorar sua persistência. A escolha permite criar/reabrir com proteção mínima comprovada, mantendo gate ampliado antes de declarar cofre/distribuição completos.

São oito gates Chromium, 15 Windows/WebView2, seis testes Rust e quatro Node novos. O teste DOM usa adapter sintético; a prova de persistência/Windows Credential Manager é nativa e passa entre processos. Encerramentos ocorrem antes da publicação, não representam queda de energia ou atualização de schema financeiro existente interrompida. Artefatos/credenciais de homologação são próprios e descartados; relatórios não guardam conteúdo.

## Ameaças e limites

Input com modo cloud, caminho/ID inválido, chave perdida, schema adulterado, submissão dupla/ACK perdido e processo interrompido são mitigados por contrato fechado, ID canônico, chave por instalação/espaço, validação integral, idempotência e staging. Nome é texto em React e parâmetro SQL. Erros não carregam SQL/cause/nome/chave. Isolamento por arquivo mantém a linha workspace esperada; privilégios Windows comprometidos permanecem fora da garantia.

Não encerra G07-VAULT, US-032, backup_manifest/restore, journal/outbox ampliados, PIN, fluxos financeiros, cloud, assinatura/updater ou outras plataformas. Nenhuma migration de produto foi alterada. DP-01 a DP-04 e demais ADRs mantêm seus escopos. O checker de ownership atual cobre TypeScript; os adapters Rust desta história foram revisados no escopo workspaces e não ampliam o checker implicitamente.
