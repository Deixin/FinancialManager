# runtime-config

Configuração funcional pública e gates da US-017, versão 0.1.0. Pacote puro sem bibliotecas externas de produção. Domain não depende dele.

Exporte/consuma disabledConfiguration, parseConfiguration/decodeConfiguration, configurationFromEnvironment, createFeatureGate e enabledSections. Snapshots imutáveis, ambiente explícito, flags false por padrão e atualização atômica com revisão crescente. execute verifica disponibilidade e autorização antes de entrar no handler; não cancela transações já iniciadas.

Consulte o [guia](../../docs/development/runtime-configuration.md) para contrato, exemplos, protocolo e limites, e o [ADR-0030](../../docs/architecture/adr/0030-flags-e-configuracao-por-ambiente.md) para ameaças/decisões. Templates públicos ficam em infra/config/profiles; nunca inclua credenciais, identidades ou dados financeiros.
