# ADR-0028 — Observabilidade base com scrub na origem

- Data: 2026-10-16
- Status: Adotado na fundação Node da US-015; frameworks/coleta remota pendentes
- Histórias: US-015; prepara US-166
- Substitui: nenhum; concretiza arquitetura §21 e RF-35

## Contexto e alternativas

O [aceite da US-015](../../delivery/05-backlog.md) exige trace/correlation IDs e ausência de fixtures sensíveis em logs. [RF-35](../../product/01-prd.md) proíbe telemetria automática no Desktop sem login e conteúdo financeiro em diagnósticos. Ainda não há servidor NestJS/BFF, fila de produto ou fornecedor de error tracking configurado.

Logger genérico com blacklist e serialização de Error facilita vazamento por campos novos, SQL e cause/stack. Auto-instrumentação prematura de HTTP/banco coletaria URLs, headers e statements. Tracing próprio duplicaria o SDK padrão. Escolhemos instrumentação manual OpenTelemetry encapsulada, nomes fechados e projeção de campos antes de qualquer destino.

## Decisão

Novo pacote Node observability, autorizado apenas como dependência de API/worker na matriz. Domain continua puro; clientes Web/Desktop/Mobile não recebem SDK Node. Factories nos apps fixam service. A emissão é disabled por padrão e operational exige sink explícito. Nenhum provider global, console exporter, auto-instrumentação ou endpoint é configurado.

Novas dependências de produção fixadas: @opentelemetry/api 1.9.1 para interfaces/contexto, @opentelemetry/sdk-trace-base 2.12.0 para lifecycle/parentesco/timing de spans e @opentelemetry/resources 2.12.0 para resource explícito sem descoberta de processo/host. @types/node 26.6.5 é somente desenvolvimento, reutilizando versão presente; o código usa APIs existentes no Node 24.19.0 do projeto. Não se inclui collector ou fornecedor externo.

BasicTracerProvider privado, sampler AlwaysOn explícito e SimpleSpanProcessor projetam spans para JSON. A API pública não expõe tracer/span mutável. Resource contém service/environment fechados e não é serializado. Eventos, links, mensagens de status e exceções do SDK não são exportados. Logs usam mesmo destino, catálogos e allowlist tipada com limite de tamanho. Falhas do destino geram apenas contador local e não alteram operações.

AsyncLocalStorage mantém correlação da operação ativa. Raízes geram request_id UUIDv4 e trace/span IDs aleatórios de node:crypto; estes não são IDs de domínio. Filhos compartilham request/trace e recebem spans distintos. Trabalho destacado após encerramento reinicia contexto. Workspace vem de autorização explícita, sem herança automática de metadados.

Entrada pública reinicia IDs. Transporte interno autenticado pode habilitar propagação restrita de traceparent v00 e x-request-id UUID. Baggage/tracestate são descartados. Headers e variáveis ambientais não configuram destinos. Formatos futuros exigem extensão deliberada; não se alega implementação completa de todas as versões do W3C.

## Ameaças e controles

| Fronteira             | Risco                                                     | Controle e limite                                                                                |
| --------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Metadados/erros       | Conteúdo financeiro, documentos, credenciais, SQL e stack | Campos e valores restritos; Error não serializado; sem recursão/getters/toJSON; código fechado   |
| HTTP/job              | Spoofing/correlação e baggage com PII                     | Reinício público; formato exato em trust internal; confiança definida pelo adaptador autenticado |
| Concorrência          | Contexto de outro request/workspace                       | AsyncLocalStorage por instância, metadados por operação; contexto não concede acesso             |
| SDK/destino           | Resource ambiental ou exporter involuntário               | Provider privado, resource explícito, projeção JSON, nenhum exporter global ou de rede           |
| Sink                  | Falha mascarar operação ou recursão                       | Contadores sem payload, sem retry/spool; sink síncrono deve terminar prontamente                 |
| Chamador comprometido | Dados codificados em UUID válido                          | IDs devem vir de código/contexto autorizado; allowlist não impede canal encoberto                |

## Verificação e limites

17 testes Node usam módulos compilados, servidor HTTP real e worker em processo separado. Correlação request/job/sync/db e canários nas duas saídas são verificados. Há cobertura de 32 operações concorrentes, erros arbitrários, getters/Proxy, snapshot, confiança, headers inválidos, escopo encerrado, sink falho e silêncio padrão. Fixtures são sintéticas, sem arquivos brutos, e recursos próprios encerram no teardown. [Guia](../../development/observability.md).

pnpm check aprovado localmente com 172 testes, formatação, lint/fronteiras, geração de contratos, configuração, tipos e build. O protocolo real dos quatro ambientes Docker foi repetido após a mudança do lockfile e passou com limpeza; [evidência atual](../../quality/evidence/us-014-environments-2026-10-16-us015.json), preservando o relatório anterior. CI remota deste incremento não executada.

Não há prova de integração NestJS/Next.js/Tauri/Expo, fila durável ou banco de produto; db.query é uma operação manual sintética no teste. A projeção não é OTLP. Collector, error tracking/analytics, retenção e acesso exigem configuração, avaliação de ameaças e homologação próprias antes de dados reais. US-166 e DP-01 a DP-04/G07 permanecem abertas. Não houve deploy ou envio externo de telemetria.

Fontes primárias consultadas em 2026-10-16: [OpenTelemetry SDK manual](https://open-telemetry.github.io/opentelemetry-js/modules/_opentelemetry_sdk-trace-base.html), [migração SDK 2.x](https://github.com/open-telemetry/opentelemetry-js/blob/main/doc/upgrade-to-2.x.md), [convenções HTTP e captura explícita de headers](https://opentelemetry.io/docs/specs/semconv/http/http-spans/) e [W3C Trace Context](https://www.w3.org/TR/trace-context/).
