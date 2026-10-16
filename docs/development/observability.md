# Observabilidade base — US-015

Referências: [RF-35 e CT-13](../product/01-prd.md), [arquitetura §21](../architecture/04-technical-architecture.md), [aceite](../delivery/05-backlog.md) e [ADR-0028](../architecture/adr/0028-observabilidade-com-scrub.md).

## Usar no servidor

packages/observability contém a implementação Node. apps/api e apps/worker exportam createApiObservability e createWorkerObservability com service fixo. Criação sem mode é silenciosa, inclusive com sink fornecido. IDs continuam disponíveis para correlação em memória. Não há exporter remoto ou console automático, e variáveis OTEL não configuram destinos.

```typescript
import { createApiObservability } from './index.js';

const telemetry = createApiObservability({
  environment: 'staging',
  mode: 'operational',
  sink: writeOperationalJsonLine, // destino próprio, explícito e síncrono
});

await telemetry.run('http.accounts.list', async (scope) => {
  scope.setMetadata({ status_code: 200, entity_type: 'account' });
  await telemetry.run('db.query', async (query) => {
    try {
      await readAuthorizedAccounts();
    } catch (error) {
      query.captureError(error, 'DEPENDENCY_UNAVAILABLE');
      throw error;
    }
  });
  return scope.correlation.request_id;
});

// Após drenar os handlers/jobs da aplicação:
await telemetry.flush();
await telemetry.shutdown();
```

Persistência e destino no exemplo são ports da aplicação. A história entrega factories; não instala middleware NestJS/Fastify/Next.js, fila ou instrumentação SQL. O contexto de observabilidade não seleciona workspace nem concede acesso. Metadados de workspace não são herdados por operações filhas: precisam vir do contexto de autorização verificado.

## Campos e scrub

Logs são linhas JSON com schema_version 1, signal log, timestamp UTC, severity, service, environment, evento de catálogo, operação, request_id, trace_id e span_id. Conclusões incluem duration_ms monotônico e erros incluem código fechado. HTTP usa route_template estático, sem URL, parâmetros, query ou headers reais. Spans do SDK OpenTelemetry saem como signal span no mesmo destino, com parent_span_id, status, instante inicial, duração e projeção segura. Essa projeção JSON ainda não é OTLP.

| Metadado aceito | Validação                                                   |
| --------------- | ----------------------------------------------------------- |
| workspace_id    | UUID opaco canônico minúsculo, variante RFC e versões 1–8   |
| entity_type     | workspace, account, transaction, import_batch ou sync_batch |
| status_code     | Inteiro de 100 a 599                                        |
| parser_version  | Três componentes numéricos com até três dígitos cada        |

Novos request IDs são UUIDv4 aleatórios de correlação temporária; não substituem UUIDv7 de recursos persistentes. Trace/span IDs usam node:crypto. Nomes de operações, eventos e códigos de erro são definidos no código e tipados. Campos desconhecidos, valores inválidos, objetos aninhados, getters e toJSON não são serializados. Metadados são copiados antes do handler. Cada registro é limitado a 4096 caracteres.

captureError ignora o objeto recebido e aceita somente o código fechado. Mensagem, stack, cause, SQL, valor, descrição, item, documento, nome de arquivo, e-mail, CPF/CNPJ, token e cookie não são enviados. Exceções não tratadas geram INTERNAL_ERROR e são relançadas intactas para tratamento funcional. Auditoria funcional não é implementada nesta camada.

Falhas de destino incrementam contadores sem payload em diagnostics; não geram log recursivo ou substituem resultado/erro da operação. O sink deve terminar rapidamente e ser síncrono. Rejeições de Promise acidentais são contidas, mas flush não garante entrega de sinks assíncronos. Não há spool, retry ou garantia de entrega. Drene operações antes de shutdown.

## Propagação e confiança

run preserva contexto de operação ativa por AsyncLocalStorage. Filhos compartilham request_id/trace_id e recebem span próprio. Operações concorrentes são isoladas; trabalho destacado após o término inicia contexto novo. current retorna o contexto local ativo, sem depender do provider global.

scope.carrier produz somente traceparent e x-request-id. Entradas públicas reiniciam IDs mesmo quando o header é válido. Para fronteira interna autenticada, o adaptador pode passar carrier e trust internal. A confiança depende do transporte/autenticação, nunca de um campo do request/job. O parser aceita apenas versão 00, 55 caracteres exatos, hexadecimal minúsculo, IDs não nulos e flags 00/01. Outros formatos reiniciam o trace. UUID inválido regenera request_id. Baggage e tracestate são descartados.

BasicTracerProvider privado cria spans manuais, sem provider/context manager global. Sampler AlwaysOn, resource e limites são explícitos. Chamadores recebem somente scope de operações fechadas. A saída não inclui resource livre, eventos de exceção, links ou status com mensagem. Nenhum nome de host/processo ou OTEL_RESOURCE_ATTRIBUTES é exportado.

## Validação e limites

pnpm check inclui build, tipos, lint/fronteiras e infra/scripts/observability.test.mjs. Para executar só a suíte depois do build:

```powershell
pnpm exec turbo run build --filter=@financial-manager/api --filter=@financial-manager/worker
node --test infra/scripts/observability.test.mjs
```

17 testes verificam scrub, erros/causas/stack, objetos hostis, snapshot, 32 operações concorrentes, escopos encerrados, sink falho, defaults silenciosos e headers adulterados. HTTP loopback real recebe fixtures sensíveis e envia carrier a um worker Node independente: request/job/sync/db compartilham trace/request IDs e têm spans distintos. São buscados canários nas duas saídas; o filho recebe variáveis OTEL adversas. Listener e processo encerram no teardown. Nenhum payload ou saída bruta é salvo.

O recorte atende a fundação da US-015. Navegador/Tauri/Expo, middleware, spans reais de banco/fila, collector/OTLP, fornecedor de error tracking/analytics, retenção, acesso aos logs, volumes, amostragem e homologação remota permanecem pendentes. Desktop sem login não importa a instrumentação e não ganha envio automático. US-166 cobre scrub das integrações futuras, inclusive infraestrutura/fornecedores. Allowlist não impede um chamador comprometido de codificar dados em um identificador válido.
