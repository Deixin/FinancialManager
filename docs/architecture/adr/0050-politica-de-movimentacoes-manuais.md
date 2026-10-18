# ADR-0050 — Política compartilhada de movimentações manuais

Status: fundação da US-041, integração Desktop pendente. Data: 2026-10-18. Complementa ADR-0037 e ADR-0049, RF-06/07 e MV-02/03/05. Não modifica schema v2, formato 1 dos snapshots de revisão, backup ou os sete originais. DP-01 a DP-04 permanecem abertas.

## Decisão

Adicionar domain/manual-movements e finance-ports/manual-movements como subpaths públicos. O primeiro captura comandos fechados e produz RevisionChange; o segundo consome um adapter de revisões confiável. CREATE/EDIT recebem um descritor de conta com seis campos, data financeira, valor positivo canônico, Entrada/Gasto e nome. CREATE aceita descrição original opcional. DELETE/RESTORE recebem a base completa observada. ADJUST é separado, recebe delta assinado no saldo exibido e motivo obrigatório, gravando origem MANUAL e economic_kind ADJUSTMENT com identificação no nome/descrição original.

Em ativos, entrada aumenta o saldo e gasto reduz; em passivos, entrada reduz a dívida e gasto aumenta. Valores, versões e deltas permanecem strings i64 e o cálculo usa BigInt. Ajuste não vira receita/despesa. Não há consolidação multimoeda, transferência ou pagamento agrupado por esse serviço.

EDIT preserva descrição original, tags, contraparte e classificação. Uma classificação única acompanha a mudança de magnitude na mesma revisão. Rateio múltiplo com magnitude diferente ou mudança de tipo econômico já classificado exige revisão específica; não limpar ou redistribuir valores implicitamente. Metadados legados inalterados são preservados; novos nomes/descrições têm limite de 2000 unidades UTF-16 e controle de caracteres. O motivo de ajuste tem esse limite. Observações de parcela continuam preservadas. Campo de observação livre de lançamento e gestão de classificações/tags/contrapartes pertencem às integrações seguintes; não criar armazenamento paralelo ou prometer esses campos na UI atual.

## Autorização e atomicidade

RevisionService acrescenta applyGuarded, uma extensão interna de host. Captura/autorização continuam antes de storage, e workspaceMode, escopo, locks e versões permanecem no coordenador existente. O guard recebe somente plano e contas atuais, sem conexão/SQL ou callback fornecido pelo JSON. Executa antes das gravações, dentro da mesma transação. Os adapters PostgreSQL/SQLite continuam responsáveis por fila, rollback, close e empréstimo de conexão/pool.

O guard manual compara a base inteira com before, além da versão. Não confiar em relações embutidas numa base fabricada de mesma versão. Confere o descritor contra os campos atuais e exige contas de origem/destino ativas, inclusive na restauração. Projeções confiáveis podem trazer metadados extras, normalizados somente para essa comparação; o comando recebido continua fechado. Origem importada/documento/sistema e grupos compostos não são reescritos pelo editor manual. Um lançamento excluído exige RESTORE explícito antes de EDIT.

Toda alteração relevante cria snapshot imutável e incrementa versão junto com dados/rateios/tags. Exclusão é lógica; restauração mantém referências que continuam válidas pelas FK existentes. Não recriar vínculos ausentes por aproximação. Documentos/conciliações ainda não implementados precisam de validação própria antes da integração. Base obsoleta, guard rejeitado ou falha de revisão preserva o grafo confirmado. Repetir intenção antiga retorna VERSION_CONFLICT e exige consultar o resultado; não há recibo durável, novo ID automático ou last-write-wins.

## Ameaças e validação

Tratar sinal incompatível, conta/autoridade forjada, base adulterada, edição em conta arquivada, perda de ACK, alteração parcial de rateio e erro privado como caminhos relevantes. Captura imutável, descritor atual, base/versionamento, authorize/RLS existentes, transação/rollback e erros fixos reduzem esses riscos. Não há endpoint cloud ou IPC novo; a composição precisa de autorização real antes de expor transports. Feed, outbox, recibos e tombstones continuam pendentes de suas histórias.

O protocolo FIN-002 roda os 28 gates de revisões e 26 específicos de manual, com estado/histórico nas duas engines, i64 mínimo/máximo/acima de 2^53, exclusão/restauração, perda de ACK, base forjada, concorrência, contas arquivadas, rateio único/múltiplo, falha após escrita, identidade local anônima, reabertura e limpeza. Goldens originais são preservados. Uma projeção PostgreSQL com metadados adicionais foi recusada indevidamente no primeiro teste; normalizar os seis campos confiáveis corrigiu a divergência e o teste foi mantido. CI usa workflow isolado com permissões de leitura e somente dados sintéticos.

Este incremento não encerra a US-041 de produto. O próximo conecta comandos estreitos e telas MV ao SQLCipher Desktop, incluindo revisão do efeito em saldo, transporte limitado, dados atrasados/bloqueio e ajuste explícito em CT-03. Homologações humanas continuam diferidas conforme ADR-0044, sem aprovação antecipada.
