# ADR-0067 — Contrapartes no Desktop

Estado: aceito para o Desktop local. Data: 2026-10-18. História: US-047.

## Contexto

Os ADRs 0065 e 0066 implementam o cadastro compartilhado e a associação versionada. A US-047 exige reutilizar uma contraparte sem perder a descrição recebida. O Desktop local deve operar sem identidade cloud, mantendo persistência e chaves atrás do Rust.

## Decisão

Acrescentar três comandos específicos: `read_local_counterparties`, `apply_local_counterparty_change` e `apply_local_counterparty_association`. O host passa a ter 32 permissões de produto. Todos usam os guards existentes de workspace local, bloqueio, chave e restauração preparada; a gravação confere bloqueio novamente antes do commit.

O catálogo usa a tabela existente. CREATE com o mesmo ID/conteúdo é repetível; UPDATE exige a base completa. Arquivamento e reativação preservam referências. Homônimos e identificadores iguais permanecem registros separados. CPF/CNPJ têm validação de formato, sem afirmação de autenticidade. Campos nullable são obrigatórios no JSON. Não há migration ou dependência nova.

A leitura opcional de movimentações captura catálogo, contas, transações e histórico na mesma transação SQLCipher e recusa cobertura incompleta. A associação consulta apenas ID/workspace/estado das referências finais na transação imediata de escrita. KEEP/CLEAR/SET muda somente `counterparty_id`; o planejador e o gravador de revisões existentes cuidam de versão, histórico e atomicidade. Transferência e pagamento de cartão exigem os dois membros, com KEEP no parceiro e sem revisão artificial.

O frontend usa a política compartilhada para capturar intenções e conferir ACKs. Uma resposta incerta congela base, seleção e IDs. Repetição exata de associação já gravada retorna conflito de versão; consulta explícita permite revisar. Não se infere regra de importação, merge por nome ou rebase automático. Respostas tardias após saída, troca de workspace ou bloqueio são descartadas.

## Verificação e limites

O corpus sintético compara planos/erros do Rust com 27 casos cadastrais e 29 casos de associação gerados pelos serviços compartilhados. Os protocolos exercitam Chromium, Tauri/WebView2, SQLCipher real, rollback, término de processos, reabertura e backup restaurado em instalação distinta sem a chave de origem. Consulte [a integração e suas evidências](../../development/desktop-counterparties.md).

Versionamento/auditoria do catálogo e recibos duráveis permanecem pendentes antes da integração cloud. UPDATE cadastral compara conteúdo, portanto não detecta ABA. A interface financeira já conserva a descrição original e mostra antes/depois do vínculo no histórico; o nome exibido é o cadastro atual, não um snapshot histórico do nome. Cloud/Mobile, sincronização e regras futuras de importação conservam seus próprios gates. Homologações humanas continuam após integração completa, conforme ADR-0044. DP-01 a DP-04 permanecem inalteradas.
