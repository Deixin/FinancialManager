# Ambiente local

A [fundação da US-014](../../docs/development/environments.md) fica em infra/environments: quatro perfis Docker locais sintéticos, PostgreSQL/Keycloak/Mailpit/Caddy, TLS próprio, credenciais e redes por instância. Use pnpm env:stack:up --profile local e pnpm env:stack:down --profile local. env:stack:test executa o protocolo real com teardown; env:stack:check valida a configuração sem Docker.

As aplicações de produto, objetos, schema financeiro e staging remoto continuam nas respectivas histórias. Os Compose de spikes W0 mantêm seus protocolos isolados.

Não adicione credenciais de produção, dados reais ou volumes locais ao Git.
