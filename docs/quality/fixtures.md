# Política de fixtures

A [US-024](../development/data-access.md) reutiliza FIN-SCHEMA-001 no PostgreSQL efêmero e acrescenta rateio/vínculo de tag/cabeçalhos de revisão sintéticos. Grupos/principais/contas de teste não são usuários reais. SQL, parâmetros e DTOs ficam apenas em memória nas asserções; o relatório inclui somente gates/versões/hashes de fontes. Políticas de login/workspace são exclusivas da fixture, com RLS ativa. Não há dump financeiro versionado.

A [US-023](../development/identity-and-time.md) usa packages/contracts/fixtures/us023.json, com vetor RFC público, UUID legado fictício e casos de calendário/UTC/epoch. IDs aleatórios, chaves, bases e logs brutos não são versionados. O corpus compartilhado é gerado como TS para probes; relatórios guardam somente gates/contagens/versões/hashes de fontes. Amostras de unicidade são finitas e não demonstram impossibilidade universal de colisão.

A [US-022](../development/schema-migrations.md) reutiliza FIN-SCHEMA-001 em bancos descartáveis, adicionando somente objetos técnicos sintéticos para testar migrations inválidas/irreversíveis. Doze processos são encerrados nos checkpoints de up/down PostgreSQL/SQLite. Snapshots financeiros são comparados por hash somente em memória; o relatório contém contagens/gates/versões/hashes de fontes, sem linhas ou hashes financeiros. Bancos, journals, segredo, contêiner e rede próprios são removidos ao final.

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

A [US-016](../development/design-system.md) usa apenas espaços e textos sintéticos no host React/Native e canários de SSR. Não contém valores financeiros, transações, API ou persistência. O teste Chromium verifica ausência de storage e tráfego externo. Capturas sintéticas ficam ignoradas em .tools/us016-ui; somente o relatório fechado de gates/hashes/versões é arquivado. A nova execução US-014 deste incremento preserva os relatórios anteriores.

A [US-017](../development/runtime-configuration.md) usa configurações públicas e canários privados fictícios em memória. O host de demonstração oferece endpoints loopback sintéticos de disponibilidade e import-preview, sem importar arquivo ou acessar banco. A evidência contém apenas gates, datas, versões e hashes; payloads/canários não são arquivados. Nenhum dado pessoal ou segredo de produção participa do protocolo.

A [US-020](../development/postgresql-schema.md) usa infra/schema/fixtures.mjs com UUIDs fixos, descrições/identificadores explicitamente sintéticos e vetores i64. Dados e logins pertencem ao PostgreSQL descartável em tmpfs. A/B/outsider possuem autorização técnica por login e workspace, aplicada com RLS ativa; esse addon não é modelo de membros de produto. Somente o relatório fechado de gates/hashes é versionado. Senhas aleatórias, logs brutos e banco não são arquivados.

A [US-021](../development/sqlite-schema.md) usa FIN-SCHEMA-001 em infra/schema/us021-corpus.mjs, gerado como JSON/TS em storage-schema/fixtures/src. É corpus sintético com expected independentes, não seed de produto nem extrato autorizado. PostgreSQL, SQLite, SQLCipher Rust e Expo consomem os mesmos 33 casos. Relatórios preservam somente nomes de gates, booleans, versões/hashes e metadados de reboot. Bases/segredos próprios são removidos; APK e temporários sintéticos ficam ignorados.
