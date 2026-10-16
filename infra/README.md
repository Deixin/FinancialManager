# Infraestrutura

- scripts: verificações locais e de CI do repositório.
- docker: reservado para ambiente local conforme as decisões W0.
- oidc: ambiente sintético Keycloak/Mailpit/Caddy para US-003.
- rls: PostgreSQL efêmero, fixtures e homologação de isolamento/pool para US-004.
- aws: reservado para a infraestrutura de referência descrita na arquitetura.

Os instrumentos locais criam e removem seus próprios serviços/dados de teste. Nenhum recurso cloud foi provisionado. Mantenha adaptadores e configuração de infraestrutura fora do domínio.
