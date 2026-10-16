# US-012 — Contratos OpenAPI e clientes tipados

Fonte: packages/contracts/openapi/v1.json, OpenAPI 3.1.1/API 1.0.0. [ADR-0026](../architecture/adr/0026-contratos-openapi-e-clientes.md). É a fundação de contrato e SDK; as rotas de produto ainda não estão implementadas/deployadas.

## Operações deste corte

| Método gerado     | Rota                                                          | Entrada                                              |
| ----------------- | ------------------------------------------------------------- | ---------------------------------------------------- |
| listAccounts      | GET /v1/workspaces/{workspaceId}/accounts                     | path.workspaceId; query.after/limit opcionais        |
| getAccountBalance | GET /v1/workspaces/{workspaceId}/accounts/{accountId}/balance | workspaceId/accountId; query.asOf obrigatório        |
| listTransactions  | GET /v1/workspaces/{workspaceId}/transactions                 | workspaceId; after/limit/accountId/from/to opcionais |
| createTransaction | POST /v1/workspaces/{workspaceId}/transactions                | workspaceId; headers.Idempotency-Key; corpo manual   |

createTransaction recebe id, accountId, financialDate, amountMinor, currencyCode, economicKind e displayName. Não aceita workspace no corpo, groupId, version, updatedAt ou TRANSFER/DEBT_SETTLEMENT. As duas classificações exigem futura operação composta, nunca apenas uma perna. O serviço ainda precisa validar autorização, natureza/sinais, rateios e transação completa.

MoneyMinor usa strings canônicas i64 do [núcleo](domain-core.md), com tipo nominal no código gerado. version também é string positiva i64. Não converter para Number. amountMinor é a variação assinada no saldo exibido, inclusive para LIABILITY; não é valor absoluto de consumo. UUIDs são minúsculos canônicos, datas financeiras são dias reais e updatedAt usa UTC com milissegundos.

parseCreateTransactionInput, parseListAccountsInput, parseListTransactionsInput e parseGetAccountBalanceInput validam entrada desconhecida e retornam cópia validada, sem coerção ou rede. Adaptadores de servidor devem decodificar path/query/header nos tipos do contrato antes desses parsers, rejeitando parâmetros duplicados/ambíguos e sem converter dinheiro para Number.

## Geração e verificação

```sh
pnpm install --frozen-lockfile
pnpm contracts:generate
pnpm contracts:check
pnpm test
pnpm check
```

Edite OpenAPI e arquivos manuais; src/generated/schema.ts, sdk.ts e validators.js vêm de infra/scripts/generate-contracts.mjs. contracts:check compara os três artefatos sem escrever, integrado ao lint/CI. O subpath @financial-manager/contracts/openapi/v1.json exporta a especificação. openapi-typescript/Ajv são ferramentas de desenvolvimento; o runtime usa código pré-compilado e formatos locais, sem Ajv ou avaliação dinâmica. Validadores externos devem implementar money-minor/positive-i64; o pattern textual sozinho não impõe todos os limites i64.

## Consumo nas plataformas

Os entrypoints exportam createWebApiClient, createDesktopCloudClient e createMobileApiClient. Todos instanciam createV1Client gerado. Não há endpoint ou credencial de produção embutidos. Exemplo dentro de apps/web/src:

```ts
import { createFetchTransport } from '@financial-manager/contracts';
import { createWebApiClient } from './api-client.js';

export function connectApi(
  origin: string,
  getCsrfToken: () => Promise<string>,
) {
  return createWebApiClient({
    baseUrl: origin,
    webOrigin: origin,
    transport: createFetchTransport(globalThis.fetch),
    getCsrfToken,
  });
}
```

WEB exige origem igual à do BFF, usa cookie same-origin e obtém CSRF nas mutações. A aplicação precisa implementar sessão/CSRF do BFF; não fornecer bearer ao browser. Desktop cloud/Mobile recebem getAccessToken a cada request do adaptador de sessão. O SDK não renova nem armazena tokens. Desktop LOCAL permanece independente desse cliente e de login cloud.

HTTPS é padrão. O teste opta por allowInsecureLoopback:true; HTTP fora de localhost/127.0.0.1/[::1] é rejeitado. O adaptador recebe cache:no-store/redirect:error; transporte nativo precisa homologar esses controles. Respostas JSON, inclusive erros, exigem Cache-Control com no-store. Não há storage ou cache financeiro persistente.

O resultado discrimina ok:true/data e ok:false/error. Páginas têm requestId/items/nextCursor; saldo/criação têm requestId/data. Erros HTTP 4xx/5xx válidos retornam ApiError. Falhas de schema/rede/configuração lançam ContractError por código, sem payload. Texto livre remoto é substituído por mensagem conhecida por código.

after/nextCursor são opacos; null encerra a paginação. O servidor deverá emitir cursores keyset ligados ao workspace/filtros, limite 1..100 (padrão 50). Não há offset/motor persistente neste corte. Idempotency-Key é explícita; depois de falha de rede, eventual reenvio precisa preservar chave e proposta. O SDK não tenta outra gravação automaticamente.

## Evidência e limites

26 testes novos cobrem parsers, formatos, validação, escopo/filtros, credenciais/CSRF, mensagens seguras, ausência de retry, snapshot antes de await e geração reproduzível. O peer HTTP loopback real exercita os três clientes compilados, i64 máximo/mínimo, cursor, erro e redirect bloqueado. infra/contracts/fixtures.mjs contém somente dados fictícios em memória; o listener próprio é encerrado.

pnpm check aprovado com 141 testes totais, tipos, lint/fronteiras, drift, formatação e build. CI quality já executa o comando em Windows/Linux; execução remota deste incremento pendente.

Servidor NestJS, banco, autorização/RLS, idempotência durável, cursores persistentes, BFF e homologação nos runtimes navegador/Tauri/Expo permanecem nas histórias próprias. Timeout/cancelamento/limites de download são do transporte. O SDK limita texto após leitura, sem limite de streaming. Sync, importação, backups, papéis e leases aguardam suas histórias/gates. Evolução /v1 preserva campos/tipos/semântica: sucessos aceitam campos novos; entradas/erros são fechados; enums exigem revisão de compatibilidade. O check de drift não é um detector completo de breaking changes.
