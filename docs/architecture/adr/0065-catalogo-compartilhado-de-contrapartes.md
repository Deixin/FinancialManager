# ADR-0065 — Catálogo compartilhado de contrapartes por workspace

- Estado: adotada para o cadastro compartilhado da US-047.
- Data: 2026-10-18.
- Referências: PRD RF-06/RF-16/RF-21; modelo de dados `counterparty`; US-047; ADR-0056/0058/0059.

## Contexto

A descrição original de uma movimentação precisa sobreviver à normalização de seu estabelecimento ou pessoa. O schema já possui `counterparty` e referências compostas por workspace, mas ainda não havia serviço de cadastro. A US-047 será integrada por incrementos: catálogo compartilhado, associação versionada e Desktop.

## Decisão

O domínio puro captura registros e comandos imutáveis; o coordenador autoriza leitura/gestão, verifica a autoridade LOCAL/CLOUD e calcula o plano dentro da transação. Adaptadores PostgreSQL e SQLite escrevem exclusivamente a tabela de seu proprietário `counterparties`. PostgreSQL exige papel sem privilégios de migração/superusuário/BYPASSRLS, RLS e lock consultivo por workspace; SQLite usa BEGIN IMMEDIATE, fila por instância e invalida a conexão após falha de rollback. Não compartilhar a mesma conexão SQLite entre instâncias concorrentes.

O registro leve contém nome de exibição de até 120 unidades UTF-16, identificador opcional em par tipo/valor, relacionamento opcional CUSTOMER/SUPPLIER/OTHER e estado ACTIVE/ARCHIVED. Tipos de identificador neste contrato: CPF, CNPJ e OTHER. CPF/CNPJ aceitam somente 11/14 dígitos, preservando zeros iniciais; trata-se de formato, sem comprovação de validade ou identidade. OTHER mantém texto de até 120 unidades. Não coletar endereço, folha ou campos adicionais.

Reutilizar significa selecionar explicitamente o ID no mesmo workspace. Homônimos e identificadores repetidos não causam fusão automática ou associação implícita. A busca ignora caixa e acentos e preserva o texto armazenado. O catálogo retorna ordem determinística por ID, filtros por estado/relacionamento e busca por nome/identificador; exceder 10.000 registros ou 4 Mi unidades UTF-16 do JSON falha explicitamente, sem truncamento.

CREATE exige UUIDv7 e estado ativo; repetição com mesmo ID e conteúdo é no-op, conteúdo diferente conflita. UPDATE exige identidade imutável e base completa atual. Arquivamento e reativação são alterações explícitas. Não há exclusão física. A comparação de conteúdo segue os catálogos anteriores: não é versão monotônica nem recibo durável e não detecta um ciclo que retorne ao mesmo conteúdo. Nenhum endpoint de nuvem é exposto antes de integrar esses gates.

O catálogo não escreve transações, revisões, nomes ajustados, descrições originais, regras ou vínculos de documentos. Alterar uma contraparte usada preserva seus IDs e o restante do grafo financeiro. Associação versionada de transações, inclusive grupos completos e respostas incertas, é o próximo incremento e usará o gravador de revisões existente. Correção pontual não ativa regra de importação; US-062/063 continuam independentes.

## Verificação e consequências

O protocolo executa os mesmos 12 cenários em PostgreSQL e SQLite reais, compara catálogos, reabre o banco local e verifica isolamento RLS, papel indevido, unidade aninhada, ator local sem identidade cloud, concorrência, rollback após escrita e preservação do grafo financeiro. Evidências armazenam gates, versões e hashes; dados e identificadores sintéticos não aparecem nos logs operacionais. Recursos próprios e credenciais temporárias são removidos.

Não há alteração de schema, migration, dependência de produção, formato de backup ou permissão Tauri. Web/Mobile, Desktop, auditoria/versionamento dos catálogos, feed/outbox e recibos duráveis permanecem pendentes. Homologações humanas continuam após integração completa, conforme ADR-0044 e autorização do usuário. Os sete documentos originais e DP-01 a DP-04 são preservados.
