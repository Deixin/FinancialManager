# Contas locais e conferência — US-040 Desktop

No Desktop Windows, entre sem conta, abra um espaço e escolha Contas e cartões. A lista separa disponibilidades de cartões/dívidas e permite mostrar arquivadas. Todos os saldos permanecem estimados enquanto a cobertura do histórico não for comprovada. Saldo até a data usa data financeira; Última leitura informa quando o cofre foi consultado. Não há consolidação automática entre espaços.

Nova conta pede nome, instituição opcional, tipo/natureza e BRL. Você pode informar referência ou começar sem ela. Para a referência, use valor em reais como 1000,00 sem separador de milhares, data e posição explícita de início/fim do dia. Cartão/dívida simples usam natureza passiva; crédito pode ter valor negativo. Investimento/dívida simples não calculam rentabilidade, amortização ou juros futuros.

O detalhe oferece editar nome/instituição, arquivar/reativar, histórico de referências e conferência de saldo observado. Arquivar conserva dados. Tipo/natureza/moeda permanecem de criação neste corte. Nomes antigos podem ser preservados sem truncamento; novos valores seguem o limite atual. Adicionar outro ponto preserva os anteriores; substituir exige selecionar a referência e confirmar a intenção, conservando a anterior como Substituída. Conferir não grava ajuste, receita ou despesa; ajustes identificados serão integrados com as movimentações US-041.

Se uma resposta se perder, os campos ficam protegidos: repita a mesma alteração ou recarregue antes de iniciar outra. Base obsoleta exige reler e revisar. Troca de espaço e bloqueio removem a tela financeira, incluindo respostas pendentes. Com PIN ativo, desbloqueie novamente antes de consultar dados. A prévia em navegador não mantém cofre ou financeiro offline.

[Decisão e ameaças](../architecture/adr/0049-contas-no-desktop-sqlcipher.md), [base compartilhada](financial-accounts.md). Não há nova dependência, migration ou formato de backup. O produto tem 17 comandos específicos, sem acesso genérico a SQL, arquivos ou chaves pela WebView. Snapshots maiores que 200000 registros ou 32 MiB e comandos maiores que 1 MiB são recusados explicitamente; nunca se exibe um total truncado.

## Reprodução

```sh
pnpm install --frozen-lockfile
pnpm build
node infra/accounts-desktop/generate.mjs --check
pnpm desktop:accounts:check
pnpm desktop:accounts:native
node infra/accounts/run.mjs
pnpm check
```

Pré-requisitos seguem o [cofre Desktop](desktop-vault.md): Windows x64, Rust 1.99.0/MSVC/SDK, Perl nativo, WebView2 e dependências fixadas. Os scripts Chromium/WebView2 usam somente FIN-002 e recursos SYNTHETIC. Nenhum cofre pessoal, VM da US-001 ou conta de provedor cloud é usado. A feature accounts-smoke e seus bins/hook/diálogos de teste ficam fora do default.

## Evidências e limites

[12 gates Chromium](../quality/evidence/us-040-desktop-accounts-browser-2026-10-17.json) cobrem modo nativo, saldos e sinais, formulário/data/posição, precisão, conferência sem escrita, edição/conflito, arquivamento, referência histórica, repetição após ACK perdido, troca com resposta pendente, bloqueio/blur, axe/reflow/cores forçadas e ausência de storage/egress/erros. O bridge é exclusivo do teste e não comprova persistência Windows.

[14 gates Windows](../quality/evidence/us-040-desktop-accounts-windows-2026-10-17.json) incluem dez testes Rust, 62 vetores de paridade com Domain, build/Clippy/permissões, snapshot FIN-002, seis checkpoints WebView2 reais, reabertura em outro processo, interrupção com journal criptografado, ACK perdido e backup/restauração dos novos dados em outra instalação após apagar a chave de origem. Oráculo independente compara o grafo inteiro, com IDs do novo espaço normalizados e referências antigas preservadas.

Os protocolos guardam somente relatórios fechados com hashes, versões, gates e pendências. Snapshots, backups, bancos e credenciais sintéticos temporários são removidos/verificados antes do sucesso. Regressões afetadas foram reexecutadas; relatórios atuais usam sufixo us040-desktop e os anteriores permanecem históricos. O formato manager v2 registra as 17 permissões, mantendo v1 como histórico.

A regressão nativa encontrou uma corrida ao cancelar uma prévia: o botão de restaurar reaparecia antes de concluir a limpeza e um clique imediato era ignorado. As ações de backup/restauração agora aguardam a operação pendente terminar. O teste Chromium segura a resposta de cancelamento para verificar essa janela; o fluxo WebView2 repete a restauração depois do cancelamento.

Homologações humanas de Hello/seletor/leitor de tela e do fluxo integrado continuam diferidas para após integrar todo o sistema, conforme ADR-0044; nenhuma aprovação humana é inferida. Escrita cloud, outbox/linhagem/auditoria, ajustes identificados, snapshots maiores, outras plataformas e release assinado mantêm seus gates. Próximo incremento: US-041, movimentação manual com histórico.
