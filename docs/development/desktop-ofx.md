# US-052 — Normalização OFX no Desktop

Contrato: [ADR-0075](../architecture/adr/0075-normalizacao-ofx-no-desktop-e-rust.md), sobre o [núcleo compartilhado](ofx-parser.md).

Na Central de importações, prepare um lote com conta ativa, abra seus detalhes e escolha **Selecionar arquivo para validar**. Selecione o OFX no Windows, desbloqueie novamente quando houver PIN e escolha **OFX** e o encoding usado na exportação. **Validar arquivo** apresenta formato, tamanho, moeda, período informado e a prévia normalizada.

A prévia tem vinte itens por página. Mostra descrição original, nome proposto, data, valor conforme a conta, tipo e identificador na origem, erros e avisos. Em cartão, valor positivo aumenta a dívida; negativo a reduz. Proveniência apresenta hash/leitor/versão e localizador estrutural. Transferências/pagamentos e FITIDs ausentes/repetidos exigem revisão posterior; não são deduplicados, descartados ou classificados automaticamente.

Linhas inválidas permanecem na prévia, com campos não interpretáveis e motivos explícitos. Incompatibilidade de moeda/tipo da conta, erro da instituição ou estrutura ambígua rejeitam o arquivo inteiro. Não há confirmação financeira nesta tela. Nenhuma fonte, item, efeito, referência de saldo ou arquivo original é persistido; o cabeçalho PREPARING anterior permanece no histórico. Staging/revisão/deduplicação e commit financeiro pertencem aos incrementos seguintes.

O host deriva o destino do lote e da conta autorizados, lê um snapshot com limites e executa o parser Rust fora da thread de interface. Nome/caminho e bytes não são fornecidos pela WebView. Seleção expira e é consumida; o destino/contexto é revalidado após a normalização. Bloquear, trocar de workspace, cancelar ou sair elimina a prévia e respostas tardias. CSV conserva sua inspeção estrutural; sua normalização é a US-053.

## Validação reproduzível

```text
node infra/validation/cli.mjs plan
node infra/validation/cli.mjs run
```

Os scopes `us050-desktop-imports-browser` e `us050-desktop-imports-windows` são ampliados, mantendo seus checks anteriores. O protocolo executa o corpus completo determinístico TypeScript/Rust, incluindo dez mil itens, BOM/Windows-1252, Unicode/UTF-16 e prioridades de erros. Relógios falsos JS permanecem no protocolo compartilhado; Budget/deadline e cancelamento possuem testes nativos. Os seis testes OFX SQLCipher verificam conta arquivada após seleção, bloqueio, escopo, rejeição, cancelamento e preservação do ledger/cofre/original.

Chromium cobre paginação, acessibilidade, tela estreita, ACK inválido, cancelamento tardio e privacidade/storage/egress. WebView2 usa a interface, IPC, leitura e parser reais com seletor sintético. O protocolo preserva backup/restauração sem credenciais de origem e limpeza dos recursos de teste. Não execute dois produtores Cargo simultaneamente ou altere fontes/dist durante a fila.

Homologação humana do diálogo Windows, bancos reais, Windows Hello e demais plataformas continua pendente conforme ADR-0044. Não há dependências de produção, permissões, schema, criptografia ou formato de backup novos. Os 36 comandos de produção permanecem específicos.

## Resultado local

Em 2026-10-25, a rodada oficial reexecutou os 33 protocolos Desktop afetados, reutilizou 21 e aprovou `pnpm check` com 538 testes, sem falhas ou skips. O catálogo mantém 54 protocolos atuais. O [relatório Windows](../quality/evidence/runs/c44c04b3e6a25e23c33a5f6e37551f1967173891e0002ff3800106d47ceae777.json) aprova onze gates: conserva os sete testes SQLCipher e 102 vetores da central, os sete testes e 357 vetores defensivos de arquivos, e acrescenta seis testes OFX e 77 vetores completos de paridade. Aprova também os cinco cenários OFX em WebView2 real, restauração sem credenciais de origem e encerramento dos recursos sintéticos. O [relatório Chromium](../quality/evidence/runs/85ca99af378fd57002912ab9c01d5be2ecb70fa992af7e7a9a3b10fc9f8dc931.json) aprova dez gates, com paginação, linha inválida, proveniência, acessibilidade/reflow, rejeição de ACK incompatível, cancelamento tardio e privacidade. Os relatórios anteriores e os sete documentos originais permanecem preservados.
