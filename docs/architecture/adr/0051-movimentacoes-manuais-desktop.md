# ADR-0051 — Movimentações manuais no cofre Desktop

Status: adotado no recorte Desktop local da US-041. Homologação humana após a integração completa, conforme ADR-0044. Não substitui decisões de sincronização, autenticação cloud ou importação.

## Decisão e contexto

MV-02/03/05 passam a usar duas operações Tauri específicas: read_local_movements e apply_local_manual_movement. Não recebem SQL, caminhos, chaves, ator ou snapshots para gravação arbitrária. O comando traz intenção e, para alterações, a base completa observada. O Rust recaptura a entrada, verifica espaço local, PIN, versão e contas atuais dentro de uma transação SQLCipher IMMEDIATE. O autor LOCAL_USER, horário e ID de revisão vêm do host. Estado, alocações, tags e revisão são confirmados juntos.

O modelo Rust puro replica o contrato do ADR-0050, com corpus sintético gerado pelo serviço compartilhado de produção. Essa duplicação permite validar no processo que possui as chaves sem confiar na WebView. Usar somente a validação JavaScript deixaria o IPC capaz de violar a política; abrir SQL genérico ampliaria a superfície de acesso. O corpus e testes SQLCipher verificam a equivalência e as consequências persistidas.

Entrada/gasto usam magnitude positiva e sinal derivado da natureza da conta. Ajuste tem delta assinado, motivo e confirmação próprios e não vira receita ou consumo. Edição preserva descrição original, contraparte e tags; uma alocação acompanha a magnitude, enquanto rateio múltiplo ou troca de tipo já classificado pede fluxo específico. Exclusão lógica e restauração preservam relações e histórico. Contas arquivadas, importações, documentos, sistemas e operações agrupadas não são reescritos pelo editor manual.

Cada gravação exige versão-base. Repetir uma criação já confirmada retorna conflito; não cria outro ID automaticamente. Após resposta perdida a UI preserva a intenção, permite repetir os mesmos dados ou consultar o resultado e exige nova revisão consciente. Não há recibo durável novo, rebase automático ou last-write-wins.

## Leitura, limites e privacidade

Uma leitura DEFERRED obtém contas, referências, transações e revisões no mesmo snapshot. Dinheiro e versões atravessam JSON em strings canônicas; o cálculo visual usa o Domain com BigInt. Exclusões permanecem consultáveis e saem do saldo. Históricos legados desconhecidos mantêm seus dados no cofre, mas enviam somente metadados e indicação de incompatibilidade à UI.

O limite da leitura é 200 mil registros agregados e 32 MiB serializados, com recusa integral e sem truncamento. Comandos ficam limitados a 1 MiB antes da busca da chave financeira. Paginação e catálogos maiores ficam pendentes. Estado de tela é transitório, removido ao bloquear ou trocar de espaço. Não há gravação financeira em storage do navegador nem envio externo.

Não há schema, dependência de produção ou formato de backup novo. A restauração existente preserva as revisões de formato 1, rebasa seus IDs em staging e cria outro workspace e chave Windows. Probes, falhas injetadas e scripts de instrumentação são opcionais e ficam fora do build padrão.

## Verificação e limites do aceite

Os comandos de reprodução, evidências locais e pendências estão no [guia Desktop](../../development/desktop-movements.md). São exigidos corpus compartilhado, testes SQLCipher, Chromium, WebView2, reabertura independente, término antes/depois do commit e backup/restauração sem a chave de origem. Nenhum teste automatizado representa homologação humana ou publicação assinada. US-042 integra transferências; classificação, tags, rateios e contrapartes têm histórias próprias. DP-01 a DP-04 permanecem pendentes.
