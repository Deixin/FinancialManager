# ADR-0072 — Validação defensiva no Desktop e Rust

Estado: aceito. Data: 2026-10-21. História: US-051; PRD RF-10 e arquitetura §15. Complementa a barreira compartilhada do [ADR-0071](0071-validacao-defensiva-compartilhada-de-arquivos.md).

## Decisão e critérios de término

Integrar seleção nativa, leitura limitada e inspeção Rust ao lote IMPORT/PREPARING em conta ativa de um workspace local. O incremento termina com paridade entre scanners, testes de autorização/bloqueio/cancelamento, execução da interface em Chromium/WebView2, regressões selecionadas pelo catálogo e `pnpm check`. Não inclui normalização, staging de lançamentos, revisão ou confirmação financeira (US-052–057).

Um comando específico, `local_import_file`, admite somente SELECT, VALIDATE e CANCEL com campos fechados. São 36 permissões de produto, sem API genérica de filesystem. O Windows escolhe o caminho; a WebView recebe apenas um UUID opaco da seleção. O token pertence ao workspace/lote, expira após cinco minutos e é consumido na validação. Cancelamento por workspace não invalida seleção de outro workspace. Troca de workspace, bloqueio explícito, saída e blur comum invalidam o contexto e descartam respostas tardias. Nova seleção substitui a anterior.

O diálogo nativo fecha o acesso financeiro antes de mostrar o seletor. Com PIN ativo, o usuário precisa desbloquear novamente antes da leitura. Somente o token e IDs permanecem no coordenador de interface; caminhos ficam no host. A preparação de desbloqueio PIN/Hello continua fechando o acesso e invalidando jobs antigos, preservando apenas a seleção opaca e temporária do seletor próprio. Prompts próprios de seleção/Hello não são interpretados como permissão para ler ou mostrar dados enquanto a sessão está bloqueada. Configuração de privacidade e bloqueio explícito cancelam a seleção.

VALIDATE confirma workspace, lote e conta antes de consumir o token e depois da inspeção. O trabalho de disco/decodificação/scanner/hash ocorre fora da thread de interface, com checkpoints de cancelamento e prazo de 30 segundos. A leitura verifica arquivo regular, tamanho antes da alocação e limite durante a leitura; lê no máximo 16 MiB mais um byte de detecção. No Windows, abre com compartilhamento somente de leitura e sem seguir reparse point final; caminhos UNC/dispositivos são recusados. O caminho não vem do cliente. O arquivo escolhido é do usuário e não é alterado ou copiado para staging.

Rust aplica os limites e subconjuntos CSV/OFX da política compartilhada, incluindo contagem UTF-16, encoding explícito, fechamento SGML restrito, referências XML fixas e recusa de DTD/XXE/conteúdo ativo. MIME não é fornecido pelo seletor Windows: aplica-se o mesmo tratamento defensivo de MIME vazio, com inspeção de extensão, bytes e estrutura. Não se aceita MIME declarado pela WebView. Unicode Cf é gerado a partir do Node fixado; não há dependência de produção nova.

Metadados com surrogates UTF-16 isolados são recusados antes da leitura: TypeScript aplica a mesma restrição de strings Unicode representáveis que o transporte JSON/Rust já exige. O corpus inclui rejeição de nome/MIME inválidos e nomes astral no limite de 255 unidades UTF-16. Os testes antigos de workspace continuam executando seus seis cenários, acrescidos dos dois testes puros de prazo/expiração; o gate histórico conserva o nome e agora exige oito sucessos.

Bytes e texto decodificado são zeroizados ao terminar. A resposta contém nome simples, SHA-256 e metadados estruturais, vinculados ao workspace/lote/seleção; não contém conteúdo ou caminho. A interface valida o ACK, usa texto escapado pelo React e elimina o resultado ao bloquear/cancelar. Erros têm códigos e mensagens fixos sem payload. ZIP/XLSX/XLSM, PDF e XML fiscal continuam recusados até seus leitores limitados.

## Verificação e limites

O protocolo de central Desktop existente é ampliado sem retirar gates anteriores: testes SQLCipher de seleção/bloqueio/isolamento/IO, prazo/expiração, vetores TypeScript/Rust incluindo os 256 bytes Windows-1252, e WebView2 com o comando real. O seletor do instrumento WebView2 é um provider sintético; o diálogo Windows de produção é compilado e permanece sujeito à homologação humana posterior. Chromium cobre o fluxo PIN, rejeição, cancelamento com resposta tardia, acessibilidade, reflow e ausência de storage/egress. Os relatórios anteriores permanecem imutáveis.

Atualizar a lista de permissões em `infra/vault/native.mjs` aciona os guardas comuns conservadores do catálogo: neste incremento, a fila seleciona os 54 protocolos. Não se reduz essa seleção. Não muda schema, dinheiro, revisões, criptografia, backup/restauração ou dependências de produção. O original não é incorporado a backups; o ledger não recebe fontes/itens/efeitos por esta validação. Homologações humanas seguem diferidas; DP-01 a DP-04 e gates cloud/Mobile permanecem pendentes.
