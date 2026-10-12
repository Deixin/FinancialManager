# Plano de testes

## Cobertura inicial

O bootstrap verifica sintaxe e tipos, formatação, links Markdown locais, compilação independente dos módulos e limites de dependência/importação. Os testes automatizados exercitam casos permitidos e proibidos do verificador estrutural.

Essa cobertura não valida comportamento financeiro, interfaces, banco de dados, criptografia, autenticação ou integração dos frameworks.

## Cobertura a implementar

Os critérios de aceite do [PRD](../product/01-prd.md), do [backlog](../delivery/05-backlog.md) e os gates do [plano](../delivery/06-implementation-plan.md) orientam os testes:

- Precisão monetária e decimal, saldo de contas e cartões, transferências e relatórios.
- Importação, deduplicação, atomicidade, idempotência, reversão e descarte de originais.
- Extração fiscal, busca por itens e conciliação N:N.
- Autorização, RLS e vazamento entre workspaces e escopos de conta.
- Sync entre clientes, conflitos, revogação e expiração do offline.
- Backup criptografado, corrupção, restauração, migração e retenção.
- Fluxos Desktop, Web e Mobile, acessibilidade e builds nativos.

Cada história deve registrar quais testes foram executados e limitações. Os spikes W0 devem produzir evidências reproduzíveis, especialmente para INT64, criptografia, RLS, OIDC, sync e volume de importação.
