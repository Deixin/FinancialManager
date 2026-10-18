# US-047 — Contrapartes no Desktop

O Desktop local integra o [cadastro compartilhado](counterparties.md) e a [associação versionada](counterparty-associations.md). Decisão: [ADR-0067](../architecture/adr/0067-contrapartes-no-desktop.md).

## Uso

Em Configurações → Gerenciar contrapartes, crie e edite nome, identificador opcional, relacionamento e estado ativo/arquivado. Busque por nome ou identificador, ignorando acentos e caixa, e filtre por estado/relacionamento. Cada cadastro mostra seu ID; nomes e identificadores iguais não provocam união automática. CPF exige 11 dígitos e CNPJ 14, com zeros iniciais preservados; a checagem é de formato.

Em Movimentações, abra um detalhe e use Editar contraparte. Conserve, remova ou escolha um cadastro ativo; a associação arquivada existente pode ser mantida ou removida. A operação preserva valor, conta, data, natureza, parcelas/notas, tags, nome de exibição, origem e descrição original. O outro membro de transferência/pagamento é conferido junto e permanece inalterado. O histórico mostra versões e antes/depois do vínculo. A reversão financeira existente continua protegida contra edições posteriores.

Após erro de confirmação, a tentativa fica congelada. Repetir usa a base e IDs capturados. A consulta explícita recarrega o estado antes de nova edição. Uma associação já confirmada retorna conflito na repetição da base antiga; CREATE cadastral idêntico pode retornar sem alteração. Nenhuma correção cria regra para futuras importações.

## Fronteira e persistência

São 32 comandos de produto, incluindo três comandos novos, sem SQL ou filesystem genéricos. Rust valida novamente o payload. Leitura completa do catálogo tem limite de 10 mil itens/4 Mi unidades UTF-16; lotes de associação têm 1–256 membros e limite de 4 Mi no JSON, com limite adicional em bytes no IPC. Leituras para edição incluem movimentações e catálogo no mesmo snapshot, recusando referências ausentes e cobertura excessiva. Erros operacionais expõem apenas códigos seguros.

O catálogo usa `counterparty`. A associação consulta projeção mínima na mesma transação que grava estado e `transaction_revision`; todos os planos/grupos são validados antes da gravação. No-op não cria revisão. PIN, perda de foco, restauração preparada e isolamento usam as proteções locais existentes. Não há identidade cloud obrigatória, migration ou dependência nova.

## Validação reproduzível

Execute `pnpm build`, `node infra/counterparties-desktop/generate.mjs --check`, `node infra/counterparties-desktop/browser.mjs`, `node infra/counterparties-desktop/native.mjs` e `pnpm check`. O protocolo nativo exige Windows x64, WebView2, Rust e Perl para SQLCipher. Execute produtores nativos sequencialmente, pois compartilham o target Cargo.

O corpus tem 56 casos sintéticos: 27 de catálogo e 29 de associação. Os testes usam CPF sintético explicitamente identificado e nenhum dado pessoal. O protocolo nativo valida o binário de produto sem probes, WebView2 real, Credential Manager, cofre SQLCipher, falhas antes/depois do commit, reabertura e restauração em outra instalação sem a chave original. O protocolo Chromium cobre cadastro, busca, homônimos, arquivamento, grupos, ACK perdido/inválido, descarte de respostas tardias, acessibilidade e ausência de armazenamento/egresso.

As cápsulas produzidas ficam em `.tools/us047-desktop-counterparties`, com hashes exatos das fontes e encerramento dos recursos. As evidências versionadas de [Chromium](../quality/evidence/us-047-desktop-counterparties-browser-2026-10-18.json) e [Windows](../quality/evidence/us-047-desktop-counterparties-windows-2026-10-18.json) registram os checks efetivamente executados, as fontes e a limpeza dos recursos. Resultado final: `pnpm check` aprovado, com 491 testes Node, sem falhas ou skips; formatação, lint, fronteiras, geração, tipos e build aprovados. As 15 suítes Chromium e os 16 protocolos Windows passaram. Foram renovadas 29 evidências Desktop e criadas duas desta história; a auditoria cobre 50 relatórios atuais e 534 hashes únicos, com 19 relatórios não afetados preservados. Os sete documentos originais permanecem byte a byte idênticos.

Homologação humana e CI remota não são presumidas pela execução local.

## Pendências

Antes de cloud: versão/auditoria cadastral, autorização paginada, outbox/feed e recibos duráveis. O cadastro atual não detecta ABA; o histórico do vínculo não congela nomes cadastrais. Regras de futuras importações pertencem às US-062/063. Próximo incremento de produto: US-050, central de importações e histórico de lotes, respeitando staging e confirmação atômica.
