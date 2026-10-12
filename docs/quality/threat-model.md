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
