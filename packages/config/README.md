# Configurações compartilhadas

tsconfig.base.json define a compilação estrita dos módulos iniciais. As plataformas poderão estender seus libs e resoluções conforme a integração dos frameworks.

workspace-boundaries.json lista dependências internas de produção permitidas. Config e test-fixtures são permitidos como dependências de desenvolvimento. Nenhum workspace pode depender de uma aplicação.

O verificador também rejeita importações internas não declaradas, caminhos relativos que cruzem workspaces e módulos nativos de Node nos pacotes puros domain, contracts e design-tokens. A análise cobre importações estáticas e import/require com argumento literal.

Novas relações entre pacotes exigem justificativa arquitetural e atualização explícita da matriz.
