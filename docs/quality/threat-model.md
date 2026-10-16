# Modelo de ameaças — ponto de partida

Status: roteiro inicial; análise completa e validação ainda pendentes.

Consulte os limites de confiança da [arquitetura](../architecture/04-technical-architecture.md). A implementação deve detalhar ativos, atores, entradas, fluxos, controles e evidências por história.

| Fronteira         | Ameaças a analisar                                       | Controles previstos na documentação                                 |
| ----------------- | -------------------------------------------------------- | ------------------------------------------------------------------- |
| Workspace e API   | Acesso entre tenants, escopo de conta indevido           | Autorização, RLS, contexto transacional e testes negativos          |
| Dispositivo local | Extração de base, chaves ou backup                       | Criptografia, armazenamento seguro de chaves e restauração validada |
| Importação        | Arquivo malformado, abuso de recursos, efeito duplicado  | Limites, parsers isolados, staging, deduplicação e idempotência     |
| Sincronização     | Replay, conflito oculto, réplica revogada                | Revisões, outbox, feed ordenado, capacidades e lease                |
| Originais e logs  | Exposição de documentos e dados pessoais                 | Descarte temporário protegido e logs sem conteúdo financeiro        |
| Ciclo de vida     | Perda de dados, autoridade duplicada, retenção incorreta | Snapshot validado, staging, arquivamento e purga                    |

Os prazos em disputa estão em [decisions-pending.md](../architecture/decisions-pending.md). Esta tabela não declara controles implementados nem substitui a avaliação de segurança prevista no backlog.

A avaliação específica do experimento US-001 está no [ADR-0017](../architecture/adr/0017-spike-cofre-desktop.md): disco/chave, pacote hostil, staging e queda, WebView/IPC, logs/memória e recuperação independente. Os controles passaram nos testes locais e na homologação host → VM Windows independente, com dados sintéticos. O [ADR-0018](../architecture/adr/0018-homologacao-desktop-vm-docker.md) registra as fronteiras do ambiente de homologação. As decisões de produção continuam pendentes; essa evidência não amplia o escopo dos controles às futuras aplicações Web/Mobile/API.

O [ADR-0019](../architecture/adr/0019-spike-cofre-mobile.md) avalia a US-002: chave por réplica, perda de segredo, cache de conexões, transação com SQLCipher, exatidão INT64, logs e isolamento do emulador. Biometria, root/jailbreak, autorização e expiração offline de produção não são controles entregues por esse instrumento. Homologação nativa permanece separada por Android/iOS.
