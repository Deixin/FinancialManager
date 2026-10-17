# Fixtures financeiras canônicas — US-025

FIN-002 v1 define dados financeiros sintéticos e totais esperados reutilizáveis em PostgreSQL e SQLite. A fonte é infra/fixtures/model.mjs; os artefatos gerados são packages/test-fixtures/fixtures/fin-002.json e o subpath @financial-manager/test-fixtures/canonical. O pacote é restrito a desenvolvimento/testes, sem dependência nova de produção. [ADR-0036](../architecture/adr/0036-fixtures-financeiras-canonicas.md).

## Contrato do dataset

format_version descreve o envelope; dataset_id/dataset_version identificam os dados e seus goldens. synthetic_only é true. seed contém 41 registros nas 12 tabelas atuais, com IDs válidos fixos, datas/instantes explícitos e dinheiro i64 em strings canônicas. expected contém saldos, resumos mensais, patrimônio e rateios escritos manualmente. Não calcule esses goldens durante a geração: uma mudança de comportamento deve ser avaliada contra os valores independentes e versionada quando intencional.

As duas engines recebem os mesmos registros lógicos. Ambos workspaces são CLOUD, representação aceita pelo PostgreSQL e pela réplica SQLite; isso não concede acesso offline nem substitui a política do cofre local. No workspace A há referências de início/fim do dia, receita/despesa, transferência, compra de cartão, dois pagamentos parciais, estorno, ajuste e exclusão lógica. O workspace B mantém extremos i64/2^53 separados, com golden de saldo e sem resumo de caixa cuja soma ultrapassaria o intervalo suportado.

document_search_vector prepara CT-08: itens, compra e vínculos de dois pagamentos possuem goldens independentes. O marcador VECTOR_ONLY_DOCUMENT_SCHEMA_PENDING deixa explícito que esses itens/vínculos não têm tabelas de documentos neste schema. As movimentações/rateios são persistidos nas duas engines; a execução de busca/conciliação pertence às histórias de documentos. FIN-001 e FIN-SCHEMA-001 continuam preservados, com seus papéis anteriores.

## Reprodução e uso

Com Node 24.19.0, pnpm 11.25.0 e Docker Linux local:

```sh
pnpm fixtures:generate
pnpm fixtures:check
pnpm fixtures:test
pnpm fixtures:clean
pnpm check
```

fixtures:check verifica geração sem escrever e participa de lint. O JSON é consumível por ferramentas de outras linguagens; o export TS é profundamente congelado. O loader infra/fixtures/loader.mjs é tooling para o dataset fixo, sem API de importação genérica. Use conexão exclusiva e um workspace por chamada; o contexto PostgreSQL é aplicado no mesmo client. Cada carga é atômica. Repetir seed recusa a duplicata e preserva os registros; não há overwrite, replay idempotente de produto ou limpeza de workspace alheio.

fixtures:test aplica migrations v2, carrega e lê todas as tabelas por workspace nas duas engines, compara snapshots e executa o domínio sobre os dados relidos contra os goldens. Verifica rollback após carga parcial, precisão, conta/cartão com saldo credor, repetição, RLS sem WHERE/forja de contexto e reabertura do arquivo SQLite. O [relatório sanitizado](../quality/evidence/us-025-fixtures-2026-10-16.json) exige 12 gates. O job canonical-fixtures repete o protocolo no Ubuntu e sempre tenta a limpeza própria.

O projeto Docker financial-manager-us025 usa porta loopback 43221 e tmpfs. Não execute simultaneamente os protocolos US-021/022/024 que compartilham essa porta. O provisionador FIN-SCHEMA-001 é reutilizado; seus registros antigos ocupam workspaces distintos e não entram nos snapshots/goldens FIN-002. Permissões adicionais são exclusivas das fixtures; RLS/FORCE RLS de produto permanece default deny. O SQLite deste ensaio é sintético, não um cofre de usuário.

Artefatos privados ficam em .tools/us025-fixtures. Banco, journals, senha, contêiner e rede próprios são descartados. clean recusa paths ligados, lock ativo, Docker remoto e recursos com dono/imagem divergentes. Não versione bancos, parâmetros, logs brutos ou snapshots financeiros. A evidência arquivada contém apenas gates, versões, datas, pendências e hashes de fontes.

O aceite US-025 é o dataset carregável nas duas engines com totais esperados versionados. Isso foi validado em PostgreSQL 18.6/SQLite 3.53.3 Node; não equivale a homologação Native/iOS, busca de documentos ou a suíte completa US-027. A próxima história é US-026, revisão/versionamento de registros financeiros. Nenhuma duração offline, retenção ou nome de papel foi decidido aqui.
