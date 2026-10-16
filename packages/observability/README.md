# Observabilidade operacional — US-015

Base Node para API/BFF/worker/sync: OpenTelemetry manual, correlação por operação e projeção JSON de campos permitidos. A emissão é desativada por padrão e exige mode operational mais sink explícito. Nenhum exporter de rede, console, auto-instrumentação ou provider global é instalado.

O [guia](../../docs/development/observability.md) documenta uso, privacidade, propagação e testes. O [ADR-0028](../../docs/architecture/adr/0028-observabilidade-com-scrub.md) registra alternativas, dependências e limites. O pacote não pertence ao domínio, Web client, Desktop ou Mobile; adaptação de runtimes e integração dos frameworks permanecem nas histórias próprias.
