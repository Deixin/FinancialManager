# ADR-0047 — Múltiplos espaços locais

Status: adotado para a US-036 no Desktop Windows; homologação humana diferida conforme [ADR-0044](0044-homologacao-humana-apos-integracao.md).

Data: 2026-10-17. Referências: RF-03, WS-01/02/03, US-036, [cofre local](0040-workspace-local-anonimo.md), [restauração](0046-restauracao-como-novo-workspace.md) e [protocolo](../../development/workspace-manager.md).

## Decisão e escopo

Reutilizar list_local_workspaces, create_local_workspace e open_local_workspace de produto. Não acrescentar banco de catálogo, migration, dependência de produção ou permissão IPC. As 15 permissões específicas existentes permanecem. Cada espaço continua com diretório, cofre SQLCipher, identidade e chave Windows próprios; não há limite de plano, conta cloud obrigatória ou consolidação financeira automática.

Acrescentar ações de criar outro espaço e gerenciar no seletor, com nome, finalidade e Local em todos os itens. WS-02 começa com formulário novo e linguagem de novo espaço. Lista e seletor apresentam todos os registros disponíveis, sem corte de quantidade. O filtro Nuvem explica que acesso cloud exige conta e está indisponível nesta versão. Desktop anônimo continua somente Local; autenticação, lista mista, papéis e sincronização cloud pertencem à US-095 e suas integrações. Não criar registros cloud sintéticos no produto para aparentar essa entrega.

Carregar o catálogo nativo ao entrar, inclusive quando a restauração informa o espaço inicial. Conferir se esse ID pertence ao catálogo antes de abrir. Trocar espaço remove a árvore anterior antes do IPC e reinicia a rota; resultados e configurações do espaço anterior não permanecem sob o novo contexto. Falha de catálogo não vira primeiro acesso nem permite criar a partir de uma lista desconhecida. Falha nativa LOCAL_LOCKED também remove nomes/catálogo e retorna ao bloqueio, sem depender exclusivamente de blur no DOM.

Cada nova intenção de criação recebe UUIDv7 independente. Capturar nome/finalidade/ID juntos e manter a solicitação imutável até resolver seu resultado. Perda de resposta pode ocorrer depois da persistência: repetir usa o mesmo payload e não duplica. Campos ficam indisponíveis até repetir ou verificar a lista; cancelar criação relê o catálogo autoritativo, sem apagar um espaço possivelmente já publicado. Rejeição de validação anterior à gravação libera a correção do formulário. Bloqueio/saída continuam descartando a UI; não há estado financeiro em storage do navegador.

## Ameaças, alternativas e consequências

O risco principal é mostrar metadados ou reutilizar contexto do espaço anterior. Limpeza imediata da árvore, resposta validada pelo gateway, enum LOCAL fechado e catálogo recarregado limitam essa confusão. Navegador não é fronteira de autorização: Rust continua validando identidade e sessão antes de ler cofres, sem receber caminhos ou SQL. PIN/Hello opcionais e as restrições de staging da restauração continuam vigentes.

Um índice persistente duplicaria metadados e criaria migração/reconciliação desnecessárias; foi descartado. Gerar outro UUID a cada retry duplicaria espaços após ACK perdido; reaproveitar formulário entre intenções poderia conflitar com o recibo anterior. Inventar um limite comercial contrariaria o aceite. A ausência de limite não promete capacidade infinita: disco, memória e custo de abrir o catálogo ainda são limites físicos. Paginação/índice otimizado exigirão medição e decisão própria se necessários.

Probes e comandos de conclusão são exclusivos da feature manager-smoke. O binário padrão é verificado sem marcadores desse instrumento. Testes usam somente FIN-002 e diretórios/perfis/credenciais identificados como sintéticos, nunca dados pessoais. Evidências arquivam gates e hashes fechados, sem nomes, caminhos privados, chaves ou linhas financeiras. Limpeza deve ser comprovada antes do sucesso.

## Verificação e pendências

O protocolo Chromium cobre criação, cancelamento, ACK perdido, troca aguardando IPC, falhas de abertura/lista, bloqueio nativo sem blur, seletor completo após restauração, axe/reflow/cores forçadas e ausência de storage/egress. O protocolo Windows cria 13 cofres, repete criações idempotentes e reabre todos em outro processo; WebView2 cria mais dois e outro processo confirma os 15, preservando digest financeiro e ciphertext da origem FIN-002. Essa amostra finita e a ausência de cap no código não são benchmark de catálogos arbitrariamente grandes.

As evidências atuais e comandos estão no guia. Os testes Rust anteriores permanecem como regressão; a história não acrescenta testes vazios para inflar a contagem. Homologação humana integrada, Hello/seletor reais, assinatura, outras plataformas, entidades futuras/outbox e DP-01 a DP-04 preservam seus gates. Os sete documentos originais não são alterados. Próxima história: US-040, contas financeiras e saldo de referência.
