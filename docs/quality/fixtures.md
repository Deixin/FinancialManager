# Política de fixtures

Use apenas dados sintéticos, identificados como fictícios. Nunca copie bases, extratos, notas fiscais, backups, CPF/CNPJ ou credenciais reais.

O pacote packages/test-fixtures contém o cenário FIN-001 da [US-013](../development/domain-core.md): contas, referências, compra/pagamento/estorno de cartão, transferência e totais mensais esperados, todos fictícios. Testes específicos de um pacote podem manter fixtures próximas ao teste. Arquivos CSV, XLSX, XML e PDF não são bloqueados globalmente pelo Git porque também podem conter exemplos sintéticos legítimos; revise seu conteúdo antes de adicionar.

| Família prevista | Casos relevantes                                             |
| ---------------- | ------------------------------------------------------------ |
| FIN              | INT64, arredondamento, saldo assinado, cartões e liquidação  |
| IMP              | Encoding, layouts, duplicatas, staging, commit e reversão    |
| DOC              | XML fiscal sintético, itens, busca e conciliação N:N         |
| SYNC             | Revisões, conflitos, tombstones, outbox e convergência       |
| ACL              | Workspaces distintos, papéis, escopos de conta e capacidades |
| LIFE             | Backup, restauração, migração, arquivamento e purga          |

As famílias são um catálogo de cobertura; os experimentos US-001 a US-006 possuem fixtures sintéticas próprias, sem encerrar as famílias de produto. A US-006 gera OFX/CSV e corpus hostil em memória a partir de infra/importers/fixtures.mjs, grava apenas temporários em .tools e os remove após a homologação. Nenhum extrato pessoal ou banco de dados é versionado. O .gitignore impede arquivos bancários e backups conhecidos; uma eventual exceção para fixture deve ser específica, documentada e revisada. Dados locais de desenvolvimento ficam em private ou local-data, ambos ignorados.

A [US-012](../development/api-contracts.md) usa infra/contracts/fixtures.mjs para contratos HTTP: UUIDs, nomes, credenciais de teste e valores inteiramente fictícios. O peer usa memória e listener loopback efêmero encerrado no teardown; não cria banco, arquivo financeiro ou sessão de IdP. Esse teste comprova serialização/contrato dos clientes compilados em Node, sem homologar autorização ou runtimes nativos.

A [US-014](../development/environments.md) gera apenas marcadores técnicos, realm sem usuários, CA e credenciais aleatórias por instância. PostgreSQL/Keycloak/Mailpit/Caddy usam armazenamento descartável; artefatos privados ficam em .tools, ignorados, e são removidos no teardown. O staging é Docker local sintético, conforme escolha do usuário. Não há dump de produção, documento, envio externo de e-mail ou seed financeiro real.

A [US-015](../development/observability.md) usa infra/observability/sensitive-fixture.mjs: canários identificados como sintéticos para valores, descrições, itens, CPF/CNPJ, e-mail, arquivo/documento, token/cookie e SQL/stack. Nada corresponde a uma identidade/transação real. São passados em memória a metadados/erros e ao peer HTTP; os testes procuram canários nas saídas de API/worker e não salvam payload ou logs brutos.
