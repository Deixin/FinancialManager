# ADR-0026 — Contratos OpenAPI e clientes gerados

- Data: 2026-10-16
- Status: Adotado na fundação da US-012; servidor e runtimes pendentes
- Histórias: US-012; prepara persistência e clientes cloud
- Substitui: nenhum; concretiza ADR-003 e o contrato monetário do ADR-0025

## Contexto e alternativas

A [US-012](../../delivery/05-backlog.md) exige contrato versionado que gere clientes tipados para Web, Desktop e Mobile. O núcleo US-013 já define MoneyMinor. Não há API NestJS de produto, schema definitivo ou sessão das aplicações. DP-01/02/03 não bloqueiam contratos de contas e movimentações.

Tipos e wrappers mantidos separadamente permitem divergências. Geradores completos acoplados a Fetch/DOM são viáveis, mas aumentam a superfície ambiental antes da homologação nativa. Foi escolhido OpenAPI como fonte, openapi-typescript para tipos e Ajv standalone para validação, com SDK gerado por operação e transporte estrutural injetado.

## Decisão

packages/contracts/openapi/v1.json é a fonte OpenAPI 3.1.1/API 1.0.0, base /v1. O corte contém listAccounts, getAccountBalance, listTransactions e createTransaction. Método, path, parâmetros, tipos e validadores são gerados desse documento. O gerador aceita referências locais e operações GET/POST com um sucesso explícito e erro padrão; outras estruturas exigem extensão deliberada.

openapi-typescript 7.13.0 e Ajv 8.20.0 são dependências de desenvolvimento fixadas no lockfile. A primeira gera paths/operations/components readonly, mapeando money-minor ao tipo MoneyMinor do domínio; a segunda pré-compila validadores ESM. O gerador local emite SDK e parsers de entrada por operationId. pnpm contracts:check compara os artefatos com geração em memória e integra lint/CI.

Não há nova biblioteca externa de produção. contracts → domain reutiliza validação monetária/data; Web/Desktop/Mobile → contracts compartilha o SDK. Validadores gerados importam apenas predicados locais; o gerador rejeita saída que exija require de helpers externos. Ajv e compilação dinâmica não entram no runtime. A adição das ferramentas também re-resolve pares opcionais supports-color no lockfile; versões diretas de Expo/React Native permanecem fixadas.

O transporte é uma função HTTP injetada. createFetchTransport adapta Fetch fornecido pelo chamador, com tipos públicos estruturais sem classes DOM. DOM é usado internamente para URL, sem UI. A proibição de imports Node em contracts permanece; o gerador Node fica em infra.

## Contratos e consequências

- JSON usa camelCase: amountMinor corresponde a account_amount_minor do modelo. MoneyMinor e version são strings i64, sem Number; datas financeiras são YYYY-MM-DD e instantes UTC têm milissegundos. UUIDs são canônicos minúsculos com versão/variante válidas; geração UUIDv7 segue no gate próprio. Validadores externos precisam implementar money-minor/positive-i64 para impor os limites, além do pattern textual.
- Entrada é fechada, sem workspace no corpo ou headers arbitrários de autenticação. O path identifica workspace, mas autorização é obrigação do servidor. Parsers retornam snapshots validados antes de espera assíncrona, sem coerção.
- Paginação usa after opaco, nextCursor ou null e limite 1..100, padrão 50. O servidor futuro deve vincular cursor a workspace, filtros e ordenação keyset. Este corte não emite/verifica cursor persistente.
- Gravação manual exige Idempotency-Key UUID explícita. Não há chave nova ou retry automático. Replay/deduplicação duráveis dependem da transação do servidor. TRANSFER/DEBT_SETTLEMENT são excluídos da criação unitária; operações compostas futuras devem persistir as duas pernas.
- version/updatedAt são metadados de recurso de API; isso não adiciona colunas ou migrations ao ERD. Schema, histórico e outbox atômicos continuam nas histórias de persistência/sync.
- Sucessos aceitam campos adicionais para evolução compatível; campos conhecidos continuam validados. Entradas/erros são fechados. Mudanças incompatíveis de campos, tipos, enums ou semântica exigem nova versão principal/rota ou estratégia explícita de compatibilidade. O gate de geração não substitui essa revisão.
- ApiError contém código, mensagem, requestId e details restritos a conflictId/nomes de campos. O SDK substitui texto livre remoto por mensagem conhecida por código. ContractError local contém somente código, sem payload financeiro.

## Ameaças e controles

| Fronteira           | Risco                                            | Controle e limite                                                                                                                                                                         |
| ------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sessão → transporte | Destino incorreto, header injection, redirect    | HTTPS, URL sem credenciais/query/hash, mesma origem no Web, credencial validada por request e redirect:error. HTTP exige exceção explícita apenas para loopback sintético.                |
| Browser → BFF       | Token no browser, CSRF, cache financeiro         | WEB usa cookie same-origin, CSRF nas mutações e nenhum bearer; requests no-store, respostas exigem Cache-Control com no-store. HttpOnly/SameSite e validação CSRF dependem do BFF futuro. |
| API → cliente       | Perda de precisão, dado de outro workspace/conta | Validação de schema, escopo, período, limite da página, cobertura do saldo e eco dos campos essenciais da criação. Não substitui autorização/RLS.                                         |
| Erros/rede          | Exposição de SQL, valores, stack ou credencial   | Nenhum log no SDK; códigos locais e mensagens remotas substituídas por texto conhecido. Sem retry implícito.                                                                              |
| Geração → runtime   | Schema remoto hostil, avaliação dinâmica         | Referências locais, código pré-compilado versionado e check de divergência. Formatos usam predicados de domínio.                                                                          |

O limite de resposta é 1.048.576 unidades de texto após leitura, antes do parse; não limita download/streaming. Timeout, cancelamento, limite de bytes, TLS e comportamento Fetch nativo exigem adaptação e homologação por runtime. O adaptador deve honrar cache/redirect/credenciais. Nenhum token ou payload é persistido. Desktop LOCAL não instancia o cliente cloud.

## Validação e aprovação

pnpm check aprovado localmente com 141 testes Node, 26 novos, incluindo servidor HTTP loopback real e os três clientes compilados. Contratos negativos de tipos cobrem workspace/chave obrigatórios, MoneyMinor, readonly e criação composta indevida. O peer usa somente fixtures em memória, não autentica com IdP ou persiste, e encerra seu listener.

O resultado valida SDK/contrato em Node; não homologa Next.js, Tauri, Expo/React Native, NestJS ou BFF de produto. G07 e DP-01 a DP-04 continuam nos respectivos escopos. Não houve deploy, publicação ou credenciais reais. [Guia de uso](../../development/api-contracts.md).

Fontes primárias consultadas em 2026-10-16: [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html), [openapi-typescript Node/transform](https://openapi-ts.dev/node) e [Ajv standalone](https://ajv.js.org/standalone.html).
