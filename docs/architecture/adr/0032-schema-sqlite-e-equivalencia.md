# ADR-0032 — Schema SQLite e equivalência persistida

- Data: 2026-10-16.
- Status: fundação validada em SQLite/PostgreSQL e SQLCipher Windows/Android; adoção no cofre de produto e iOS pendentes.
- História: US-021. Não encerra US-022 a US-027, US-032, US-100/101 ou todos os gates G07.
- Referências: [modelo §12/14/17](../03-data-model.md), [arquitetura](../04-technical-architecture.md), [US-020/ADR-0031](0031-schema-inicial-postgresql.md).

## Decisão

Adotamos @financial-manager/storage-schema 0.1.0 para compartilhar SQL portátil, checksum, migração inicial e normalização de nomes entre os adaptadores locais. Não há biblioteca externa de produção nova. Domain permanece puro; somente Desktop/Mobile podem depender do novo pacote. API de migração é ferramenta interna e exige uma conexão já aberta/configurada pelo host. O subpath synthetic-probe contém somente o corpus de homologação, sem integração ao fluxo de produto.

A fonte da migração é infra/schema/sqlite-model.mjs. O gerador mantém SQL legível versionado, export TypeScript e corpus JSON/TS idênticos em conteúdo. schema:sqlite:check recusa divergências e integra lint/check. O schema contém as mesmas 12 entidades financeiras da US-020, com PKs TEXT UUID canônicas, FKs compostas por workspace, enums/checks e índices. Tabelas são STRICT. SQLite admite autoridade LOCAL ou réplica CLOUD; PostgreSQL continua autoridade CLOUD. Não criamos identidade remota para o modo local.

Valores finais usam INTEGER i64. Os binds monetários do corpus são strings canônicas, as leituras financeiras são explicitamente TEXT e o adapter Node converte BigInt em string. Contratos/ports de produto continuam responsáveis por rejeitar Number monetário antes do bind: o banco não recupera precisão perdida no chamador. UUIDs são vetores estáveis; a geração continua na US-023.

Datas usam TEXT YYYY-MM-DD com validação de calendário por normalização explícita. Instantes usam TEXT UTC fixo de milissegundos, calendário válido e hora/minuto/segundo limitados; offsets, infinity e microssegundos não são representações aceitas. PostgreSQL preserva o instante e normaliza offsets, enquanto o contrato HTTP permanece UTC canônico. Os casos comparados usam a forma canônica comum.

## Rateios no commit sem float

SQLite não dispõe da constraint trigger diferível usada na US-020. Implementamos um guard por movimentação, com FK diferível para uma âncora válida e FK cíclica que exige a existência do guard. Triggers atualizam sua validade a cada alteração. O próprio guard rejeita valor diferente do calculado e a âncora aceita somente 1. Alterações intermediárias podem ficar incompletas; um total final inválido impede COMMIT e o adapter faz rollback.

Uma view soma parcelas positivas em dois componentes inteiros de base 2^32. O componente inferior gera carry; o superior satura acima do maior módulo válido, sem converter dinheiro para REAL. A comparação com valores negativos usa quociente/resto negados, preservando INT64_MIN sem abs(i64). Cada passo fica dentro de i64. Zero parcelas representa movimentação sem categoria; uma classificação com parcelas precisa fechar por inteiro. O teste também tenta forjar/remover o guard e inserir uma âncora inválida.

BEGIN IMMEDIATE serializa escritores no SQLite. O ensaio usa duas conexões reais ao mesmo arquivo: o segundo escritor encontra SQLITE_BUSY enquanto a primeira transação mantém o lock, e entra depois do rollback. Retry/idempotência e serviço de revisão continuam em suas histórias. O custo de rateios extensos ainda precisa da suíte de carga; 33 casos não são benchmark de produção.

## Nomes e fronteiras

SQLite recebe normalized_name do port usando NFKC, espaços e lowercase Unicode; o índice parcial mantém unicidade ativa por workspace. O texto original permanece intacto. PostgreSQL deriva sua coluna no banco; os vetores homologados, incluindo português, produzem a mesma chave. Não há extensão/UDF nativa ou promessa de equivalência universal entre versões Unicode/locale. Expandir o corpus e fixar a política completa de normalização continua necessário antes do beta. O port de produto deve sempre derivar a chave, sem aceitar normalized_name arbitrário do cliente.

SQLite não implementa RLS. O arquivo SQLCipher é privado do core/adaptador e as operações de produto devem partir do workspace autorizado, com comandos estreitos. FKs impedem referências cruzadas, mas não constituem autorização de leitura. O teste PostgreSQL usa logins distintos e a fronteira RLS da US-020 com permissões sintéticas explícitas, sem CRUD financeiro por bootstrap. A policy engine e o acesso por conta continuam pendentes.

## Ameaças e limites de adoção

| Ameaça                                 | Controle e limite                                                                                                                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversão monetária inexata            | INTEGER/strings, limites i64, soma por componentes inteiros e corpus comparado.                                                                                                           |
| Total incompleto ou guard forjado      | Triggers de consistência, âncora CHECK e FKs diferíveis; COMMIT inválido e tentativa de adulteração testados.                                                                             |
| Referência cruzada                     | UUID/FKs compostas, subcategoria ligada à categoria e testes negativos no mesmo corpus.                                                                                                   |
| História reescrita                     | Revisão com versão única e triggers UPDATE/DELETE proibidos; soft delete preserva revisão. Serviço de revisão automática permanece separado.                                              |
| Migração interrompida/divergente       | Transação inicial/checksum, teste de falha após DDL e reaplicação. Falha devolve código fixo; host deve descartar conexão com rollback falho.                                             |
| Extração do arquivo local              | SQLCipher real nos bindings existentes; ausência de header em claro, chave errada/ausente recusada e reabertura testadas. Chaves fora dos relatórios.                                     |
| Alteração do ensaio US-002             | Android usa app ID próprio e propriedade Gradle explícita; main padrão continua US-002. Dados/chaves da US-021 são independentes.                                                         |
| Restore com schema hostil ou downgrade | A adoção no cofre de produto exige versão própria do validador, migrações e backup/restore, incluindo fingerprint do schema. O validador antigo não foi usado como aceite do novo schema. |

O instrumento Desktop reutiliza o binding rusqlite/SQLCipher homologado, em arquivo temporário com chave de memória. Não revalida sozinho o Credential Manager ou a migração de um cofre de usuário. Android usa SQLCipher/SecureStore reais, recupera a chave após reboot offline e limpa seus dados/chave próprios. iOS continua sem execução neste host Windows. G07-TIME avançou nos três motores e nos bindings Windows/Android; G07-VAULT e o recorte iOS mantêm seus gates. DP-01 a DP-04, signing e release permanecem inalterados.

## Evidência

O mesmo FIN-SCHEMA-001 passou em [PostgreSQL/SQLite](../../quality/evidence/us-021-dual-engine-2026-10-16.json), [SQLCipher Windows](../../quality/evidence/us-021-desktop-2026-10-16.json) e [SQLCipher Android](../../quality/evidence/us-021-android-2026-10-16.json): 33 casos em cada runtime. A equivalência é dos casos homologados e não encerra a suíte ampla US-027. [Guia reproduzível](../../development/sqlite-schema.md).

Referências consultadas: [SQLite STRICT](https://www.sqlite.org/stricttables.html), [FKs diferíveis](https://www.sqlite.org/foreignkeys.html), [CTEs](https://www.sqlite.org/lang_with.html), [pragmas por conexão](https://www.sqlite.org/pragma.html), [Expo SQLite/SQLCipher](https://docs.expo.dev/versions/latest/sdk/sqlite/).
