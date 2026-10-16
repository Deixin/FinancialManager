# Política de fixtures

Use apenas dados sintéticos, identificados como fictícios. Nunca copie bases, extratos, notas fiscais, backups, CPF/CNPJ ou credenciais reais.

O pacote packages/test-fixtures está reservado para conjuntos compartilhados. Testes específicos de um pacote podem manter fixtures próximas ao teste. Arquivos CSV, XLSX, XML e PDF não são bloqueados globalmente pelo Git porque também podem conter exemplos sintéticos legítimos; revise seu conteúdo antes de adicionar.

| Família prevista | Casos relevantes                                             |
| ---------------- | ------------------------------------------------------------ |
| FIN              | INT64, arredondamento, saldo assinado, cartões e liquidação  |
| IMP              | Encoding, layouts, duplicatas, staging, commit e reversão    |
| DOC              | XML fiscal sintético, itens, busca e conciliação N:N         |
| SYNC             | Revisões, conflitos, tombstones, outbox e convergência       |
| ACL              | Workspaces distintos, papéis, escopos de conta e capacidades |
| LIFE             | Backup, restauração, migração, arquivamento e purga          |

As famílias são um catálogo de cobertura; os experimentos US-001 a US-006 possuem fixtures sintéticas próprias, sem encerrar as famílias de produto. A US-006 gera OFX/CSV e corpus hostil em memória a partir de infra/importers/fixtures.mjs, grava apenas temporários em .tools e os remove após a homologação. Nenhum extrato pessoal ou banco de dados é versionado. O .gitignore impede arquivos bancários e backups conhecidos; uma eventual exceção para fixture deve ser específica, documentada e revisada. Dados locais de desenvolvimento ficam em private ou local-data, ambos ignorados.
