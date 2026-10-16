# ADR-0034 — UUIDv7 e política temporal por plataforma

Data: 2026-10-16. História: US-023. Status: implementação e gates nos runtimes disponíveis; iOS e integração dos fluxos de produto pendentes.

Complementa ADR-004 da arquitetura e [ADR-0024](0024-consolidacao-fisica-e-gates.md) no recorte G07-IDS/TIME. Não altera prazos, papéis, os sete originais ou DP-01 a DP-04.

## Decisão

Novos IDs usam o layout UUIDv7 da [RFC 9562 §5.7/A.6](https://www.rfc-editor.org/rfc/rfc9562.html#section-5.7): 48 bits de Unix milliseconds e 74 bits aleatórios novos por chamada. A implementação TS é um codec de formato em contracts, com relógio/entropia injetados; não implementa um PRNG. Web/API/worker usam Web Crypto nativo, Node fixado em 24.19.0; Mobile usa expo-crypto 58.0.6/getRandomValues; Rust usa uuid 1.28.0/Builder::from_unix_timestamp_millis e getrandom 0.4.3. O PostgreSQL 18.6 pode gerar IDs exclusivamente server-side com uuidv7(). Nenhuma biblioteca npm de UUID foi adicionada.

Escolhemos a variante com cauda aleatória, sem contador ou estado persistido. Milissegundos crescentes ordenam lexicalmente; no mesmo ms a ordem é aleatória. Se o relógio recua, o prefixo também pode recuar. Reinício ou múltiplas instâncias não compartilham contador. A unicidade é probabilística, protegida também por PK/constraints; ausência de duplicatas em um corpus não é prova universal. Falha da fonte segura impede gerar o ID, sem Math.random ou timestamp usado como substituto de aleatoriedade.

getRandomBytes do Expo instalado possui fallback de desenvolvimento para Math.random; o adaptador novo chama getRandomValues diretamente. A escolha foi conferida no código instalado e na [documentação Expo](https://docs.expo.dev/versions/latest/sdk/crypto/#cryptogetrandomvaluestypedarray). Portas de entropia/relógio são internas e confiáveis, não parâmetros de UI/HTTP. IDs expõem aproximadamente o instante de criação e não são segredos, credenciais ou autorização.

resourceId aceita UUIDs canônicos minúsculos da variante RFC, versões 1 a 8. uuidV7 exige versão 7 apenas para saídas dos novos geradores. IDs existentes, importados, restaurados e recebidos da sync não são regenerados. A persistência continua UUID PostgreSQL/TEXT SQLite; não há migration ou restrição de versão 7 nas tabelas existentes. Conversão interna do tipo UUID PostgreSQL não substitui a validação estrita na fronteira JSON.

O domínio oferece UtcInstant, utcInstant e codecs de epoch ms determinísticos. A representação interna/JSON é YYYY-MM-DDTHH:mm:ss.SSSZ, calendário gregoriano, anos 0001–9999. Epochs negativos são válidos para instantes históricos; UUIDv7 requer epoch não negativo de 48 bits. Offsets, ausência/excesso de precisão, segundos intercalares, normalização de dias inválidos e objetos Date recebidos como input são recusados. Capturar um relógio atual em ms é distinto de truncar dados persistidos: entradas históricas de precisão maior não são arredondadas silenciosamente.

Datas financeiras permanecem YYYY-MM-DD sem fuso, separadas dos instantes. Nenhum codec deriva data financeira do UUID ou de UTC. Revisões, cursores, geração de sincronização e conflitos explícitos continuam determinando ordem/autoridade; relógio local e ordenação de IDs não arbitram conflitos, vencimentos, autorização ou validade offline. A regressão verifica que alterar/inverter a ordem de IDs não muda o resumo financeiro.

A única dependência externa de produção adicionada é chrono 0.4.45, já presente transitivamente no lock Rust, agora declarada com std e sem features padrão para parsing/calendário/formatação UTC. Evita duplicar algoritmos de calendário no core; validação canônica e rejeição de leap seconds são explícitas. JS usa os codecs determinísticos sobre Date com formato estrito e testes em quatro fusos. MoneyMinor e seus inteiros/strings não foram alterados.

## Fronteiras e adoção

Web, API e worker recebem factories de identidade; Mobile importa o adaptador somente em entrypoints nativos. O index genérico Mobile conserva seus modelos/SDK sem carregar expo-crypto nos testes Node. O core Rust expõe operações de ID/instante; o adaptador Desktop TS aceita somente um bridge estreito e valida/sanitiza suas respostas. Vincular esses comandos à aplicação Tauri e aos repositories/casos de uso de produto permanece pendente. Os IDs/formato dos cofres históricos dos spikes não foram alterados.

Os testes PostgreSQL exercitam uuidv7(), tipos físicos do núcleo e tabela técnica sintética própria, sem CRUD financeiro por owner ou relaxamento de RLS. Saídas de instantes são lidas em UTC/ms explícito; domínios rejeitam valores sub-ms antes que um driver possa reduzi-los a Date. Os testes SQLite/SQLCipher usam schema financeiro e dados sintéticos. O probe Android usa também o runner de migrations US-022 em processo nativo, sem afirmar que ele foi adotado no cofre/restore de produto.

O provider SHA-256 do probe Android usa Crypto.digest sobre bytes TextEncoder/UTF-8 e converte o resultado em hex canônico. Os checksums do catálogo são verificados integralmente pelo runner, sem substituí-los por constantes ou desativar a checagem na plataforma.

## Evidência e limites

O [protocolo](../../development/identity-and-time.md) compartilha os vetores de RFC, IDs legados, calendário, limites UTC e rejeições. [Node/Chromium/PostgreSQL/SQLite](../../quality/evidence/us-023-node-2026-10-16.json), [Rust/SQLCipher Windows](../../quality/evidence/us-023-windows-2026-10-16.json) e [Expo/SQLCipher Android](../../quality/evidence/us-023-android-2026-10-16.json) possuem relatórios separados com hashes atuais. Cada runtime usa uma amostra de 4096 IDs com relógio fixo, além de avanço, regressão e instâncias independentes. Os relatórios não incluem IDs gerados, linhas financeiras, segredos ou hashes de dados.

G07-IDS/TIME avançam nas plataformas disponíveis, sem encerrar a homologação iOS em Mac/Xcode ou G07-VAULT/QUERY/JOBS/PDF. O reinício do processo Android verifica reabertura e limpeza de chave/base; não é apresentado como novo reboot do SO. A prova de reboot SQLCipher/SecureStore da US-021 conserva seu alcance histórico. A nova CI está configurada, com execução remota pendente; não há release assinado, deploy ou autorização cloud nova.
