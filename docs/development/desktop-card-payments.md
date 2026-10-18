# Cartões e pagamentos no Desktop — US-043

Movimentações oferece Cartões e pagamentos e Novo pagamento de cartão. No detalhe de uma conta de cartão, use Ver cartão e pagamentos ou Pagar cartão; compras manuais usam Adicionar movimentação nessa conta. A visão de cartões mostra compras/créditos disponíveis, dívida/crédito calculado e cobertura estimada. Não projeta parcelas ou juros futuros.

Pagamento recebe uma conta de origem ASSET, um CREDIT_CARD/LIABILITY, data, magnitude positiva BRL, nome e confirmação dos dois lados. Banco e dívida diminuem juntos; o pagamento usa DEBT_SETTLEMENT e não gera outro gasto. Pagamento parcial e crédito por valor excedente são representáveis. Fatura/período e conciliação de itens não estão disponíveis neste fluxo; pagamentos permanecem identificados como “Pagamento de cartão sem detalhamento”. Não inferimos vínculo por data/valor semelhante.

O detalhe do par permite edição, exclusão lógica/restauração e histórico de cada lado. Originais, tags, contraparte e classificações são preservados; rateio múltiplo com novo valor exige revisão própria. Grupos quebrados/anulados/importados e contas arquivadas ficam somente para consulta. Após resposta perdida, repita a mesma tentativa ou consulte o resultado: IDs/bases permanecem congelados e replay confirmado retorna conflito.

## Reprodução

```sh
pnpm install --frozen-lockfile
pnpm build
node infra/card-payments-desktop/browser.mjs
node infra/card-payments-desktop/native.mjs
pnpm check
```

Windows x64, WebView2, Rust 1.99 e Perl/OpenSSL são exigidos pelo protocolo nativo; Chromium usa Playwright. Arquivos/perfis/bancos/backups e credenciais próprios são sintéticos, em .tools/us043-desktop-card-payments/run-*. Limpeza verifica marker, caminho, chaves e políticas antes de remover arquivos. Não usa dados pessoais, cofre do usuário ou a VM Windows US-001.

Os 72 vetores são gerados pelo serviço compartilhado e confrontados com Rust. Onze testes SQLCipher cobrem grupo/par/revisões, dinheiro i64, contas/passivos incompatíveis, bases, rollback após o primeiro lado, concorrência, limites, PIN antes da chave, classificação e compra em setembro com pagamentos parciais em outubro. Um pagamento não altera a compra original nem gera outro consumo.

Chromium cobre 12 gates, incluindo confirmações, ambos os sinais negativos, dívida/crédito, compras existentes, ausência de detalhamento presumido, ACK perdido, conflito sem rebase, precisão, seleção de contas, legado, isolamento, bloqueio, acessibilidade, reflow e alto contraste. WebView2 usa IPC real com resposta perdida após commit; processo independente reabre dois grupos/quatro membros/dez revisões. Interrupção após o primeiro lado recupera o journal criptografado sem par parcial; após commit, replay não duplica. Backup restaura grafo/grupos/snapshots com novos IDs em outra instalação depois de remover a chave Windows de origem.

Evidências fechadas: [Chromium](../quality/evidence/us-043-desktop-card-payments-browser-2026-10-18.json) e [Windows](../quality/evidence/us-043-desktop-card-payments-windows-2026-10-18.json), somente após execução aprovada, limpeza e correspondência dos hashes dos fontes. A CI dedicada permite reprodução; execução remota não foi observada.

Resultado local em 2026-10-18: pnpm check aprovado com 380 testes Node e zero falhas/skips, formatação, lint, tipos e build. A suíte própria aprovou 11 testes Rust/72 vetores, 12 gates Chromium e 13 Windows. A regressão de crédito também cobre o menor valor i64, sem converter sua magnitude para um inteiro positivo fora da faixa. Todos os protocolos Desktop afetados passaram novamente; 19 cápsulas novas compõem 32 evidências atuais com recursos próprios encerrados. Fontes compartilhadas inalteradas mantêm seus protocolos anteriores; homologação humana e CI remota permanecem fora deste resultado local.

Não houve schema, dependência de produção ou formato de backup novo. Há 23 comandos específicos de produto; leitura exige snapshot completo, até 200 mil registros/32 MiB, e comandos até 1 MiB. Históricos legados desconhecidos são preservados sem interpretação. Consulte o [ADR-0055](../architecture/adr/0055-cartoes-e-pagamentos-no-desktop.md) e o [núcleo compartilhado](card-payments.md).

Próxima história: US-044, categorias padrão editáveis por workspace. Importação/conciliação de cartão, CT-06 integrado, cloud/outbox/feed/recibos, outras plataformas, classificação e paginação preservam seus gates. Homologações humanas seguem após integrar todo o sistema; sete originais e DP-01 a DP-04 permanecem intactos.
