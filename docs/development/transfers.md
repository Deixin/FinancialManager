# Transferências atômicas — núcleo US-042

Validação local concluída: 54 gates reais nos dois engines e pnpm check com 351 testes, zero falhas/skips. As evidências registram fontes, versões e limpeza. A integração Desktop de transferência permanece pendente.

O núcleo compartilhado cria, edita, exclui e restaura transferências entre duas contas de ativo. O grupo, os dois lançamentos e suas revisões são confirmados juntos. A saída é negativa e a entrada positiva, com mesma magnitude/data e economic_kind TRANSFER. A operação preserva o total consolidado e não cria consumo ou receita. Contas de passivo/pagamento de cartão pertencem à US-043.

Use createTransferService com createSqliteRevisionService ou createPostgresRevisionService. Importe os subpaths transfers de domain e finance-ports. CREATE recebe id do grupo, source_entry_id, target_entry_id, source_account, target_account, financial_date, amount_minor positivo, display_name e original_description nullable. Os três IDs novos devem ser UUIDv7 distintos. Contas contêm os seis campos canônicos de autorização/natureza; workspace e ator vêm da composição de host.

Componha manual e transferências sobre o mesmo coordenador de revisões quando usarem uma conexão SQLite. Não compartilhe essa conexão entre coordenadores concorrentes. Feche o adapter com close para drenar operações antes de fechar a conexão; createTransferService preserva esse ciclo de vida.

EDIT recebe base com group_id/source/target (RevisionState completas), as duas contas e novos data/valor/nome. DELETE/RESTORE recebem apenas essa base. Ambos os lados preservam original, tags e contraparte; uma alocação pode acompanhar o valor, enquanto rateio múltiplo pede revisão. Bases incompletas/forjadas, origem não manual, grupo quebrado, conta arquivada ou escopo parcial são recusados. Resultados usam seus IDs; não dependa da posição no vetor para identificar os lados.

Exclusão e restauração mudam os dois membros. O grupo estrutural continua ACTIVE; versões e snapshots registram as alterações dos lançamentos. BROKEN/VOIDED não são reparados automaticamente. Após erro de resposta, consulte o estado: repetir uma intenção confirmada retorna conflito e não cria outro grupo ou outra movimentação. Não há novo recibo durável ou last-write-wins.

## Reprodução

```sh
pnpm install --frozen-lockfile
pnpm build
node infra/transfers/run.mjs
node infra/transfers/clean.mjs
pnpm check
```

O protocolo usa PostgreSQL 18.6 e SQLite Node reais, RLS sem bypass, fixtures FIN-002 e dados adicionais explicitamente sintéticos. A porta 43221 é compartilhada com schema/repositories/revisões/invariantes/contas/manual: execute esses protocolos sequencialmente. Projeto Docker financial-manager-us042-transfers e raiz .tools/us042-transfers são próprios; containers, rede, credenciais, banco e journals são removidos e verificados. A VM Windows US-001 não é usada.

Doze cenários por engine verificam criação, conservação e exclusão de consumo, edição entre contas, exclusão/restauração, ACK perdido, bases forjadas, escopo parcial, grupos incompletos/quebrados, contas modificadas/arquivadas, alocações/tags, falha na segunda revisão, concorrência, limites i64 e preservação do corpus original. As mesmas versões/conteúdos de snapshots são comparadas entre engines. Há regressões de revisões, LOCAL sem identidade cloud, reabertura e limpeza. A suíte Node repete os cenários SQLite com as constraints reais.

[Evidência fechada](../quality/evidence/us-042-transfer-core-2026-10-18.json) e [ADR-0052](../architecture/adr/0052-transferencias-compartilhadas-atomicas.md). O relatório contém gates, versões, hashes e pendências; só deve ser arquivado após execução aprovada e limpeza.

## Próximo incremento

A US-042 permanece em andamento até a integração Desktop de transferência com Rust/Tauri e interface. Não houve schema, dependência de produção, endpoint, permissão IPC ou formato de backup novo. Cloud, Web/Mobile, outbox/feed/recibos, distribuição assinada e homologação humana continuam nos próprios gates. CI foi configurada em workflow isolado, sem execução remota observada. Os sete originais e DP-01 a DP-04 permanecem preservados.
