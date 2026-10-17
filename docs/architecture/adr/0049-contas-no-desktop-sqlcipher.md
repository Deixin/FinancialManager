# ADR-0049 — Contas no Desktop SQLCipher

Status: integração local da US-040; homologações humanas diferidas conforme [ADR-0044](0044-homologacao-humana-apos-integracao.md). Os resultados automatizados e limites ficam no [guia](../../development/desktop-accounts.md).

Data: 2026-10-17. Complementa [ADR-0048](0048-operacoes-compartilhadas-de-contas.md), RF-05/07 e CT-01/02/03/05. Não modifica os sete documentos originais, schema v2, formato de backup ou DP-01 a DP-04.

## Fronteira nativa

Adicionar somente read_local_accounts e apply_local_account_change, totalizando 17 permissões específicas. O primeiro recebe workspaceId; o segundo recebe workspaceId e comando fechado CREATE/UPDATE/REFERENCE. Nenhum recebe caminho, SQL, chave, principal cloud, flag de cobertura de histórico ou instrução de importação. Ambos passam pelo LocalState protegido; a instalação confere identidade LOCAL, schema/integridade, chave Windows e namespace físico antes de acessar dados.

Rust não confia na validação da WebView. account_model é puro, sem IO, chave, framework ou SQL, e aplica a mesma captura/plano de metadados/referências do Domain TypeScript. Os 62 vetores sintéticos são gerados a partir do Domain de produção e comparados semanticamente com o plano Rust. Incluem limite UTF-16 de nomes, Unicode/trim, campos desconhecidos/nulos obrigatórios, enums, UUIDs, datas, valores i64 canônicos, metadados legados, conflitos, arquivamento, repetição e referências históricas. Não há nova biblioteca de produção. Essa duplicação limitada é explícita; não se declara execução de TypeScript dentro do Rust.

Dinheiro é validado como i64 no nativo e serializado somente como string canônica. O cálculo financeiro continua exclusivamente no Domain compartilhado: o Rust devolve dados estruturados de um snapshot, e a apresentação usa calculateAccountBalance/selectBalanceReference. Nenhuma soma SQLite, conversão float ou inferência de consumo foi adicionada ao adapter. Os sete goldens originais verificam a projeção Desktop; a instalação Windows também verifica os goldens do workspace FIN-002 A disponíveis naquele cofre.

## Persistência, sessão e respostas

O adapter SQLCipher usa SQL estático parametrizado, filtros de workspace/conta e FK/triggers existentes. CREATE e sua referência, UPDATE e substituição de referência são transações IMMEDIATE. Uma substituição mantém o registro anterior como SUPERSEDED. Erro depois da mudança de status, inclusive colisão de chave, faz rollback integral. Atualizar metadados exige base explícita; tipo/natureza/moeda permanecem de criação, conforme ADR-0048. Não há exclusão física, versão monotônica, recibo de transporte ou auditoria/outbox de conta novos.

Antes de commit, verificar perda de acesso quando o PIN está ativo; o controlador também confere a sessão depois da operação. Um bloqueio posterior à publicação pode impedir a resposta, sem apagar o que já foi registrado. A UI mantém o comando e seus IDs imutáveis após resultado ambíguo, exige repetir o mesmo pedido ou reler o estado e descarta respostas depois de sair do componente. Trocar espaço remove a árvore financeira antes de abrir o seguinte e reinicia a rota. PIN/blur/saída removem campos, avisos e nomes da tela; isso não promete apagar forensicamente strings do heap JavaScript de um dispositivo comprometido.

Ler contas, referências e movimentos confirmados sem descrições/documentos na mesma transação DEFERRED produz um snapshot consistente. A conexão/chave nativa fecha ao concluir; a WebView conserva somente a cópia volátil do componente. Não há localStorage, IndexedDB, cache financeiro persistente ou egress. read_at informa a leitura do cofre, não uma data de auditoria de edição inexistente no schema.

O snapshot recusa mais de 200000 registros de contas/referências/movimentos e mais de 32 MiB serializados; comandos recusam mais de 1 MiB. Não há truncamento de dados ou total parcial. São limites de transporte/memória deste corte, sem limite comercial de workspaces. Paginação de snapshots maiores é trabalho posterior. O teste de limite popula SQLCipher real com 200001 contas sintéticas e exige erro, sem devolver um saldo parcial.

## Experiência local

Contas e cartões separa disponibilidades de passivos; não consolida moedas ou espaços. Criação oferece tipos do MVP, natureza compatível e BRL. Referência é opcional; quando presente, exige data e escolha explícita de início/fim do dia. Dívida positiva e crédito negativo preservam a convenção de sinal. O parser BRL usa BigInt e aceita 1000,00 sem separador de milhares; formatação também não usa float.

Editar nome/instituição, arquivar/reativar e revisar histórico não apagam movimentos. Valores novos/alterados têm limites atuais; metadados legados inalterados são preservados literalmente. Adicionar outro ponto e substituir uma referência são opções distintas; a confirmação explica recalcular o saldo sem gerar receita/despesa. Conferir saldo observado mostra diferença exata e contagem/período considerados, sem gravar movimentação. Ajustes identificados pertencem à US-041.

Cobertura permanece UNKNOWN no Desktop deste incremento, sem aceitar uma declaração de completude do cliente. A UI apresenta estimado/incompleto, inclusive quando falta referência ou a referência é futura. Overflow de uma conta mostra indisponibilidade explícita do saldo, preservando acesso aos seus metadados e às demais contas; nunca vira zero ou total truncado. Telas recebem valores via gateway estrito; regras financeiras não ficam nos componentes.

## Evidências e pendências

O protocolo Chromium cobre fluxo de formulário, precisão, conferência sem escrita, stale base, arquivamento, histórico, ACK perdido, troca com resposta pendente, bloqueio/blur, axe, reflow e cores forçadas. O protocolo Windows executa dez testes Rust e 62 vetores, usa WebView2/IPC reais, reabre dados em outro processo e encerra subprocessos antes/depois do commit. O checkpoint anterior força cache_flush para exercitar journal SQLCipher real. Hooks e selecionadores sintéticos pertencem exclusivamente à feature accounts-smoke, ausente do default.

O backup de um espaço com contas/referências criadas pela UI é restaurado em outra instalação após remover a chave Windows de origem. Oráculo independente compara o grafo completo, normalizando apenas identidades/metadados do novo workspace; valores, instituição, timestamps de recursos e referências SUPERSEDED permanecem. Todas as credenciais/perfis/arquivos utilizados são próprios e sintéticos, com remoção verificada antes do sucesso.

Perda de ACK no WebView2 é injetada no handler exclusivo do instrumento: ele executa LocalState de produto, devolve erro após o primeiro commit de CREATE e exige payload serializado idêntico com resultado no-op na repetição. O handler/capability de produção permanece direto e é conferido separadamente. A função invoke do Tauri é imutável; tentar substituí-la em JavaScript não exercitava a falha e o protocolo recusou sucesso até corrigir o instrumento. Chromium injeta a falha no bridge sintético.

Aceite local de contas/referências é separado de movimentações US-041, ajuste identificado, outbox/auditoria/linhagem, escrita cloud, Web/Mobile e distribuição assinada. Não se declara MVP completo ou homologação humana do fluxo integrado. Consentimento Hello, seletor real, leitor de tela manual, outras plataformas e performance de snapshots maiores mantêm seus gates.
