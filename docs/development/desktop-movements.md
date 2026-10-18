# Movimentações manuais no Desktop — US-041

Validação local concluída: pnpm check com 343 testes sem falhas/skips; dez testes Rust, 80 vetores, 11 gates Chromium e 13 Windows. As evidências fechadas abaixo contêm versões, fontes e limpeza verificados; homologação humana continua após a integração completa.

O Desktop local integra entradas e gastos, edição, exclusão reversível e histórico ao cofre SQLCipher. Em Movimentações, filtre conta e período e consulte registros excluídos. Em Contas e cartões, o detalhe oferece atalhos para movimentações e para ajuste identificado, sempre com motivo e confirmação. O saldo continua estimado enquanto a cobertura do histórico não for comprovada.

As regras do [ADR-0050](../architecture/adr/0050-politica-de-movimentacoes-manuais.md) são verificadas novamente no Rust conforme [ADR-0051](../architecture/adr/0051-movimentacoes-manuais-desktop.md). A edição preserva a descrição original e os vínculos. Importações, documentos e operações agrupadas têm consulta, mas usam seus próprios fluxos de alteração. Ajustes podem ser excluídos/restaurados; para substituir um ajuste, registre outra intenção explícita após revisar o histórico. A UI não calcula ajustes automaticamente a partir de divergências.

Após erro de resposta, repita a mesma tentativa ou use Consultar resultado e atualizar. Uma tentativa confirmada pode retornar conflito na repetição. Consulte o estado antes de iniciar outra alteração; o aplicativo não gera outra movimentação automaticamente.

## Reprodução local

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm desktop:movements:check
pnpm desktop:movements:native
pnpm check
```

O protocolo nativo exige Windows x64, WebView2, Rust 1.99, Perl para OpenSSL e o target compartilhado do Desktop. O protocolo Chromium usa Playwright. Ambos usam apenas fixtures sintéticas. A instrumentação, perfis, bancos, backups e credenciais ficam em .tools/us041-desktop-movements/run-*; a limpeza exige marker, validação de caminho e remoção/verificação das chaves e políticas antes dos arquivos. Não usa dados do usuário nem a VM Windows do spike US-001.

O corpus de 80 vetores é produzido pelo serviço compartilhado e confrontado com o plano Rust. A suíte SQLCipher verifica precisão i64, histórico, mudança de conta, exclusão/restauração, conflitos, bloqueio antes da chave, rollback e limites. Chromium cobre interface, resposta perdida, isolamento, bloqueio tardio, acessibilidade, reflow e privacidade. WebView2 usa os comandos nativos, incluindo uma resposta perdida depois da confirmação; outro processo reabre e confere o saldo de cada conta. Os testes de término verificam journal criptografado sem estado parcial e repetição após commit sem duplicação. Backup/restauração cria outra instalação com IDs novos, remove a chave de origem e compara o grafo e os snapshots rebasados.

Relatórios fechados: [Chromium](../quality/evidence/us-041-desktop-movements-browser-2026-10-18.json) e [Windows](../quality/evidence/us-041-desktop-movements-windows-2026-10-18.json). Só devem ser arquivados após execução aprovada e limpeza, com hashes dos fontes efetivamente executados. CI está configurada; execução remota não é evidência deste incremento.

## Limites e próximos passos

Leituras recusam mais de 200 mil registros agregados ou 32 MiB; comandos acima de 1 MiB são recusados antes de buscar a chave financeira. Não se mostram totais parciais. Histórico legado desconhecido aparece como preservado e não interpretado. Paginação, UI de classificação/tags/rateio/contrapartes, Web/Mobile, feed/outbox cloud, recibos duráveis e release assinado mantêm seus gates. Não houve alteração de schema, dependência de produção ou formato de backup.

O próximo incremento é a US-042, transferência atômica entre contas. Homologações humanas ficam após integração completa por instrução do usuário, sem aprovação antecipada. Os sete documentos originais e DP-01 a DP-04 permanecem intactos.

As cápsulas Desktop desta página registram a conclusão local dos itens de interface e ajuste que constavam pendentes nas evidências da fundação US-040/US-041.
