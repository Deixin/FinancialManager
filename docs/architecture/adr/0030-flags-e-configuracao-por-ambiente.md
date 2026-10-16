# ADR-0030 — Flags e configuração por ambiente

- Data: 2026-10-16
- Status: adotado na fundação; integração de produto pendente.
- História: US-017; depende da fundação US-014/016.
- Referências: [PRD](../../product/01-prd.md), [arquitetura](../04-technical-architecture.md), [aceite](../../delivery/05-backlog.md).
- Não substitui decisões de autorização, sincronização, telemetria, migração ou os gates G07/DP-01 a DP-04.

## Contexto e decisão

O beta precisa desativar funcionalidades incompletas sem manter forks. Adotamos @financial-manager/runtime-config 0.1.0, pacote puro sem bibliotecas externas, com snapshots públicos imutáveis e validação estrita de ambiente, versão, revisão e cinco flags booleanas. Os cinco templates versionados iniciam com todos os recursos opcionais desligados. Nenhuma configuração é obtida implicitamente de process.env, storage ou rede.

API/worker recebem explicitamente FM_ENVIRONMENT e FM_RUNTIME_CONFIG do host. Web/Desktop/Mobile usam o mesmo contrato público e adaptadores de apresentação; config continua sendo pacote de ferramentas de desenvolvimento. Domain permanece independente. Campos desconhecidos, tipos coercíveis, ambientes trocados e revisões inválidas são recusados com erro fixo. Não há targeting por identidade ou workspace.

O gate aceita substituição atômica em execução e revisão crescente. Reaplicar o mesmo conteúdo normalizado na mesma revisão é idempotente. Erro, conflito ou rollback desliga todas as flags, preserva a maior revisão recebida e exige revisão superior para recuperar. Essa proteção é em memória e não resiste a reinícios; não há promessa de assinatura, distribuição remota ou convergência entre processos.

O executor verifica disponibilidade, executa a autorização fornecida pelo host e verifica novamente a flag antes de entrar na operação. Somente true autoriza. Desligar a flag durante a autorização impede a entrada; transações já iniciadas continuam sob as próprias regras de atomicidade. Jobs devem passar pelo executor ao consumir a fila. Nenhum job/outbox é descartado ou marcado como concluído pelo gate.

Visão geral, movimentações, contas e configurações continuam disponíveis. Importações, documentos e relatórios podem ser omitidos da navegação, cartões, busca e modelo de rota. A operação correspondente também exige gate no lado que executa o trabalho. Cloud sync exige autoridade cloud e não se aplica ao Web; migração é limitada a Desktop/API/worker. Desktop local continua independente de login/nuvem. Flags não concedem capacidades nem trocam autoridade.

## Ameaças e controles

| Ameaça                                         | Controle e limite                                                                                                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Segredo incluído em configuração de cliente    | Contrato público fechado; somente duas chaves ambientais lidas; campos privados não são serializados. O host deve manter segredos em configuração separada.                |
| Cliente tenta habilitar operação indisponível  | Gate do servidor não lê flags do request; autorização continua separada. Validado em HTTP loopback real.                                                                   |
| Configuração inválida ou antiga mantém acesso  | Snapshot validado, revisão monotônica e fechamento em falhas; recuperação exige revisão superior na mesma instância.                                                       |
| Desligamento entre autorização e execução      | Segunda verificação antes de chamar o handler; não interrompe uma transação já iniciada.                                                                                   |
| UI antiga aponta para recurso desativado       | Modelos filtrados recusam rota indisponível; demonstração limpa rota/busca e conteúdo na atualização. Hosts de produto ainda precisam proteger seus roteadores e handlers. |
| Mudança por site externo na demonstração       | Listener loopback, Host e Origin exatos, POST JSON fechado/limitado, CSP same-origin e no-store. É controle de demonstração sintética, sem autenticação de produto.        |
| Flag altera privacidade ou políticas pendentes | Allowlist sem analytics, IA externa, Open Finance, lease offline, retenção, identidade ou credenciais. Nenhuma flag envia dados locais.                                    |

Não foi adicionada integração externa ou dependência externa de produção. O módulo não escreve logs; erros de configuração têm códigos fixos. Callbacks de operação mantêm seus próprios erros e precisam da política de scrub existente no host.

## Alternativas e consequências

Constantes de build exigiriam recompilar para cada mudança. Forks por ambiente divergiriam. Um SDK de fornecedor acrescentaria rede, credenciais e tratamento de identidade sem necessidade nesta fundação. A configuração explícita permite futuras fontes validadas, mantendo o mesmo gate; o transporte/autenticidade e persistência da revisão exigirão decisão e testes próprios.

O host é responsável por carregar e aplicar atualizações, sincronizar instâncias quando necessário e autorizar cada operação/workspace. As factories não instalam middleware NestJS, roteamento Next.js, IPC Tauri ou hosts Expo. O exemplo Native continua apenas tipado.

## Evidência

15 testes Node verificam defaults, objetos hostis, ambiente, snapshot, revisão, autorização, concorrência, fila e HTTP real. O [protocolo Chromium](../../quality/evidence/us-017-flags-2026-10-16.json) passou em oito gates, incluindo mesmo bundle, reload, falha e servidor; os [12 gates DOM](../../quality/evidence/us-016-dom-2026-10-16-us017.json) foram reexecutados. [Guia reproduzível](../../development/runtime-configuration.md). Relatórios anteriores são preservados como histórico, sem alegar correspondência com fontes atuais.
