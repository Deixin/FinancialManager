# ADR-0036 — Fixtures financeiras canônicas

Data: 2026-10-16. História: US-025. Status: dataset e carga PostgreSQL/SQLite validados no protocolo local.

Complementa CT-06/07/08/16, RF-05 a RF-08, RF-20 a RF-24 e os ADRs 0025/0032/0033/0035. Não substitui os corpora históricos nem resolve DP-01 a DP-04.

## Decisão e alternativas

FIN-002 v1 é um dataset integralmente sintético com 41 registros, dois workspaces e as 12 tabelas financeiras existentes. A fonte determinística infra/fixtures/model.mjs gera um JSON portátil e um export TS profundamente imutável em test-fixtures/canonical. Os totais esperados são literais escritos na fonte, independentes dos algoritmos usados para verificá-los. A geração não usa relógio, entropia, rede ou dados locais pessoais. A versão do dataset é distinta da versão de schema; alterações de significado ou goldens exigem nova versão de dataset e preservação das evidências históricas.

FIN-001 permanece como fixture pura de domínio, incluindo staging/deleted; FIN-SCHEMA-001 conserva os casos históricos de constraints/runtimes. Reutilizar esses corpora sem distinção confundiria contratos: FIN-001 usa IDs conceituais e estados de projeção, enquanto FIN-SCHEMA-001 inclui comandos de rejeição e mutações de ensaio. Copiar goldens calculados pelo próprio domínio tornaria o teste circular. Não criamos outra biblioteca de produção ou schema financeiro.

O loader de desenvolvimento é separado dos repositories de produto. Aceita somente o dataset fixo, engines e workspaces conhecidos, usa valores parametrizados e uma transação por workspace. Não faz upsert, truncamento ou overwrite. Uma carga repetida é recusada e conserva os dados; erro no meio da carga faz rollback integral. A diferença física de normalized_name e boolean é tratada explicitamente: PostgreSQL gera o nome e armazena boolean; SQLite recebe a normalização e usa 0/1. Snapshots canônicos convertem inteiros/UUID/datas/instantes sem passar dinheiro por Number.

## Casos e limites

O workspace A possui banco, poupança e cartão: receita/gasto, compra em setembro, dois pagamentos parciais em outubro, estorno, transferência em duas pernas, ajuste sem receita, exclusão lógica e referências de início/fim do dia. Goldens cobrem sete saldos por conta/data, dois resumos mensais, dois patrimônios e duas somas de rateio. O workspace B separa extremos i64 e valores acima de 2^53; seu saldo final é representável. Não há golden de resumo de caixa desse workspace porque as somas brutas dos extremos excederiam i64. Precisão/overflow ampliados são parte da US-027.

O vetor CT-08 contém itens fictícios, compra e dois vínculos de pagamentos, com total de documento, itens correspondentes e pagamentos escritos separadamente. Ele está marcado VECTOR_ONLY_DOCUMENT_SCHEMA_PENDING e não é inserido como documento no núcleo financeiro. As transações/rateios correspondentes são persistidos; o schema de documentos, busca e conciliação será implementado nas histórias consumidoras. Esse vetor prepara os testes dessas histórias; não declara CT-08 executado no produto. Tampouco a comparação PostgreSQL/SQLite homologa UI dos três clientes, acessibilidade ou toda a US-027/CT-16.

## Segurança e evidência

O runner cria apenas o projeto Docker financial-manager-us025, PostgreSQL pinado por digest e SQLite sintético ignorado. Usa o provisionador já homologado, migrations v2 e logins A/B sem owner/BYPASSRLS. O bootstrap administra roles e a tabela protegida de acesso da fixture; não executa CRUD financeiro. A carga usa os logins autorizados e RLS ativa. SET LOCAL de outro workspace não concede acesso, e escrita cruzada falha por WITH CHECK. Não há policy permissiva/grant novo no schema de produto.

Dados, snapshots comparados e parâmetros ficam somente em memória ou bancos temporários. Os relatórios têm contrato fechado com gates, versões e hashes de fontes; não contêm valores, linhas, IDs aleatórios, senhas ou hashes financeiros. Logs de erro mostram somente etapa/código técnico; os testes usam canários. O loader não tem endpoint HTTP/IPC nem flag de seed de produção. Ele é ferramenta interna para workspaces fixos e banco descartável, sem autenticação fictícia incorporada ao produto. clean recusa Docker remoto, caminhos ligados, execução ativa e dono/imagem divergentes.

O [protocolo](../../development/canonical-fixtures.md) e a [evidência](../../quality/evidence/us-025-fixtures-2026-10-16.json) exigem 12 gates, incluindo geração, migrations, rollback, snapshots iguais, goldens, precisão/referências, carga repetida, RLS, vetor de documentos, reabertura e logs/limpeza. Nove testes Node acompanham o incremento. A nova execução dos 22 gates de repositories conserva o relatório anterior sem reescrever hashes; somente o relatório novo deve corresponder às fontes atuais. CI configurada, execução remota deste incremento pendente.
