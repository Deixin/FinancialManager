# Suíte de invariantes PostgreSQL/SQLite — US-027

FIN-INVARIANTS-001 v1 executa o mesmo roteiro contra os serviços de revisão reais das duas engines, com migrations v2 e FIN-002 v1. O aceite da [US-027](../delivery/05-backlog.md) cobre transferências, rateios, cartão, saldo, reversão e exclusão. São 43 cenários compartilhados e 33 casos FIN-SCHEMA-001 reexecutados em cada banco. O [ADR-0038](../architecture/adr/0038-suite-invariantes-cross-engine.md) registra a decisão.

## Cobertura e oráculos

| Família do aceite | Verificações persistidas                                                                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transferências    | Edição das duas pernas, recusa de alteração parcial, reversão e 16 vetores de ida/volta com conservação patrimonial/econômica.                                                    |
| Rateios           | Reclassificação sem alterar consumo, soma incorreta, subcategoria alheia, oito divisões de ida/volta e magnitude de MIN_INT64 repartida em MAX_INT64 + 1.                         |
| Cartão            | Compra aumenta passivo/consumo, pagamento altera conta/dívida sem consumir novamente, exclusão/restauração da compra e reversão do pagamento.                                     |
| Saldo             | Referências de início/fim do dia, movimento anterior excluído, conta/cartão, patrimônio e resumo econômico/caixa por período; cancelamento exato acima de 2^53 e nos limites i64. |
| Reversão          | Nova versão restaura conteúdo anterior; revisão superada falha integralmente e histórico anterior permanece imutável.                                                             |
| Exclusão          | Exclusão lógica remove efeito financeiro; restauração o aplica uma vez. Base desatualizada não ressuscita compra nem grava histórico.                                             |

Depois de cada comando, inclusive rejeições e cada metade de uma ida/volta, a suíte relê as 12 tabelas por workspace. Compara snapshots lógicos A/B entre engines, versões, vínculos e revisões completas. Somente a ordem de chaves de objetos JSON é normalizada: arrays, strings monetárias, datas e conteúdo permanecem exatos. Revisão nova deve conter precisamente o agregado antes/depois e versão-base; anteriores não mudam. Rejeições e no-op preservam o snapshot inteiro.

O redutor infra/invariants/oracle.mjs calcula saldos, patrimônio e resumos com BigInt, sem importar Domain. As funções de produção sobre linhas relidas precisam concordar com ele e com nove checkpoints de valores literais. O redutor é limitado às referências/períodos do corpus, não é um segundo serviço financeiro. O workspace B testa saldo líquido exato; seus fluxos brutos excedem i64 e não são publicados como resumo de produto.

Os 24 vetores são limitados e reproduzíveis: 16 transferências, incluindo 9007199254740993, e oito divisões positivas de uma compra. Transferências conservam patrimônio/consumo; reclassificações conservam totais; a reversão restaura conteúdo/resultados. O corpus de schema separado testa constraints diretamente sob o usuário autorizado. Um caso adicional altera rateio válido, confirma o UPDATE e exige falha específica no COMMIT diferido, seguida de rollback sem efeitos.

IDs/relógio determinísticos existem apenas no instrumento sintético para comparar o histórico. Cada comando recebe faixa de IDs própria, inclusive quando rejeitado. Isso não troca as factories CSPRNG de produção nem homologa entropia. FIN-002 original foi preservado: a suíte acrescenta uma categoria e dois rateios sintéticos no workspace B.

## Reprodução e evidência

```sh
pnpm install --frozen-lockfile
pnpm invariants:test
pnpm invariants:clean
pnpm check
```

Docker local fornece PostgreSQL 18.6 fixado por digest, tmpfs, limites de recursos e porta loopback 43221. SQLite usa o binding Node real. Não execute simultaneamente protocolos US-021/022/024/025/026 que compartilham essa porta. Migração usa role dedicada; CRUD usa logins sem propriedade/BYPASSRLS, policies sintéticas limitadas aos workspaces e RLS/FORCE RLS de produto. Produto permanece default deny. Não são necessários credenciais ou dados reais.

O [relatório](../quality/evidence/us-027-invariants-2026-10-16.json) possui 50 gates: geração, migrations, dois corpus de schema, 43 cenários compartilhados, reabertura SQLite, logs e limpeza. Sucesso exige todos os gates, manifesto atual, versões, data e encerramento de recursos. O job cross-engine-invariants configura CI; execução remota deste incremento não foi observada. Sete testes Node verificam oráculos, fronteiras temporais, normalização, auditoria, vetores, roteiro SQLite integral e evidência.

Artefatos privados ficam em .tools/us027-invariants, ignorados. O runner remove banco/journals, senha, contêiner e rede próprios. clean recusa Docker remoto, symlinks, lock ativo e dono/imagem divergentes. Logs usam nomes de gates/códigos fixos; o relatório não arquiva snapshots, valores, descrições ou parâmetros. Relatórios anteriores permanecem históricos com hashes originais; novas execuções mantêm comparação estrita de fontes.

## Limites do aceite

As seis famílias PostgreSQL/SQLite da US-027 foram atendidas no núcleo. Não se encerram todas as invariantes ERD I-01 a I-18, policy engine, undo de import_batch, feed/outbox/tombstones/idempotência, documentos/CT-08/CT-16 completos, integração nativa/cofre ou iOS. Nenhuma dependência externa, migração ou comportamento financeiro de produção foi acrescentado. DP-01 a DP-04 permanecem registradas. Próxima história: US-030, entrada Desktop com Continuar sem conta.
