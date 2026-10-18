# Transferências no Desktop — US-042

Movimentações oferece Nova transferência, Ver transferências e Ver transferência completa no detalhe de um dos lados. A operação usa duas contas de ativo do espaço local, mesma data e valor positivo BRL. A saída e a entrada são confirmadas juntas, com confirmação explícita. Transferência não é receita ou consumo; cartões e dívidas terão fluxo próprio na US-043.

O detalhe mostra os dois lados, versões, descrições originais, saldos estimados e histórico de cada lançamento. Editar muda o par; exclusão/restauração também exige confirmação conjunta. Tags, contraparte e classificações são preservadas. Uma alocação acompanha a magnitude; rateio múltiplo pode exigir revisão própria. Grupos incompletos/anulados/importados e contas arquivadas ficam somente para consulta neste fluxo.

Após falha de resposta, use Repetir a mesma tentativa ou Consultar resultado e atualizar. A intenção preserva IDs e bases; repetição confirmada retorna conflito e não cria outro par. Nenhuma base é atualizada automaticamente. A data e as referências determinam quando cada saldo considera a operação, mantendo indicação de cobertura estimada.

## Reprodução

```sh
pnpm install --frozen-lockfile
pnpm build
node infra/transfers-desktop/browser.mjs
node infra/transfers-desktop/native.mjs
pnpm check
```

Windows x64, WebView2, Rust 1.99 e Perl para OpenSSL são exigidos pelo protocolo nativo; Chromium usa Playwright. Fixtures, perfis, bancos, backups e credenciais são sintéticos e ficam em .tools/us042-desktop-transfers/run-*. Limpeza exige marker, validação de caminho e remoção/verificação das chaves/políticas antes dos arquivos. Não usa cofre pessoal, dados do usuário ou VM Windows US-001.

Os 69 vetores são gerados pelo serviço compartilhado e confrontados com Rust. Dez testes SQLCipher cobrem grupo/par/revisões, valores grandes, edição, exclusão/restauração, falha após o primeiro lado, rollback, bases obsoletas/forjadas, metadados quebrados, classificação, PIN, limites e concorrência. O conjunto é executado como testes de biblioteca para evitar builds de executáveis que não participam dessa suíte.

Chromium cobre confirmação, conservação de saldo, troca de contas, histórico, ACK perdido, conflito sem rebase, precisão, seleção de ativos, legado, isolamento, bloqueio tardio, acessibilidade, reflow, alto contraste e ausência de storage/egresso. WebView2 usa os comandos reais, com falha de transporte após o primeiro commit; processo independente confere dois grupos/quatro membros/dez revisões. Interrupção após salvar o primeiro lado deixa journal criptografado e recuperação integral; interrupção após commit produz conflito na repetição. Backup/restauração cria outra instalação, remove a chave de origem e compara grafo, grupos e snapshots rebasados.

Evidências fechadas: [Chromium](../quality/evidence/us-042-desktop-transfers-browser-2026-10-18.json) e [Windows](../quality/evidence/us-042-desktop-transfers-windows-2026-10-18.json). Devem ser arquivadas somente após execução aprovada, limpeza e verificação dos hashes dos fontes. Os protocolos das histórias anteriores preservam seu escopo; a composição local de transferência é atestada nestas cápsulas.

Resultado local em 2026-10-18: pnpm check aprovado, com 360 testes Node e zero falhas/skips, formatação, lint, tipos e build. A suíte própria aprovou dez testes Rust/69 vetores, 11 gates Chromium e 13 Windows. As regressões afetadas passaram; 22 cápsulas novas compõem o conjunto de 29 evidências atuais, com hashes das fontes e recursos sintéticos encerrados. CI remota e homologação humana não fazem parte dessa execução local.

## Limites e próximos passos

Há 21 comandos específicos de produto, incluindo read_local_transfers/apply_local_transfer. Leitura exige correspondência entre grupos e os membros do mesmo snapshot. Limites integrais são 200 mil registros/32 MiB e 1 MiB por comando, sem truncamento. Históricos legados desconhecidos continuam preservados e não interpretados. Não houve migration, dependência de produção ou novo formato de backup.

O coordenador compartilhado também passou a recusar projeções parciais de membros existentes, conforme [ADR-0053](../architecture/adr/0053-transferencias-no-desktop-sqlcipher.md). Grupos novos sem membros continuam compatíveis com a inserção atômica dos dois lados.

Próximo incremento: US-043, pagamento de cartão sem duplicar consumo. Homologações humanas continuam após integração completa por instrução do usuário. Cloud/outbox/feed/recibos, Web/Mobile, paginação, editores de classificação e release assinado mantêm seus gates. CI remota não foi observada neste incremento. Sete originais e DP-01 a DP-04 permanecem intactos.
