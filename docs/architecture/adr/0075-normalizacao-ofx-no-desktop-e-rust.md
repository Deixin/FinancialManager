# ADR-0075 — Normalização OFX no Desktop e Rust

Estado: aceito. Data: 2026-10-25. História: US-052, sobre `c7b37029cc065500ba9980ca5f7a8eb29b483436`. Complementa ADR-0072/0074, RF-10/11 e arquitetura §15.

## Escopo e término

Integrar a normalização OFX à seleção/leitura protegida existente, com paridade integral do contrato `fm-ofx/1.0.0` em Rust e prévia paginada no Desktop. O término exige corpus compartilhado contra o host, limites i64/Unicode/encoding, testes SQLCipher de isolamento/bloqueio/conta/lote e preservação do ledger, fluxo real WebView2, Chromium/acessibilidade/privacidade, regressões escolhidas pelo catálogo e `pnpm check`.

Não persistir itens ou fontes nesta etapa. Staging/revisão, regras, deduplicação e confirmação financeira permanecem em seus incrementos; a prévia não permite confirmar ou ignorar linhas. O cabeçalho PREPARING já existente permanece sem efeitos. Backup/restauração conservam formato e dados atuais.

## Decisão

Manter as 36 permissões e o comando fechado `local_import_file`, sem caminhos/bytes/destino declarado pela WebView. O host deriva workspace, conta, BRL e natureza de saldo a partir do lote e da conta ativa autorizados. Revalidar esse destino e o contexto após a leitura/normalização. Seleção continua opaca, temporária e consumível; bloqueio, troca e cancelamento descartam resultados tardios.

Ao validar OFX, o host aplica a barreira, normaliza e calcula os hashes sobre o mesmo snapshot limitado. Acrescentar `normalization` somente à resposta OFX; CSV conserva o contrato anterior. O trabalho roda fora da thread de interface, com prazo cooperativo e checkpoints existentes. Bytes/texto e campos temporários de origem são zeroizados; somente dados estruturados de prévia atravessam o IPC.

Rust reproduz o modelo intermediário compartilhado, inclusive sinais ASSET/LIABILITY, datas sem deslocar o dia, tipo original, entidades decodificadas uma vez, linhas INVALID e avisos. Dinheiro usa i128 intermediário e i64 final em strings canônicas. Nenhuma normalização infere consumo, transferência ou liquidação a confirmar. Não há novas dependências de produção.

A WebView valida estrutura, destino, hash, versão, limites, erros/avisos e caminhos de proveniência antes de expor a prévia; não confia em metadados soltos. A resposta tem no máximo dez mil itens, com strings limitadas e limite adicional de 64 Mi unidades UTF-16 no envelope de normalização. A UI renderiza vinte itens por página e conserva todos os itens/avisos em memória enquanto desbloqueada, sem storage ou rede. Dados somem ao bloquear/sair/cancelar; não há renderização de HTML recebido.

## Verificação e limites

Ampliar os protocolos existentes da central sem remover gates ou reescrever relatórios históricos. Confrontar o resultado completo dos casos determinísticos do corpus compartilhado (incluindo dez mil registros) entre TypeScript e Rust. Casos com relógio falso do JS têm cobertura de prazo no protocolo compartilhado e nos testes nativos de Budget; cancelamento é verificado nos dois ambientes. O seletor WebView2 permanece sintético; comando, leitura, privacidade, parser e interface são reais.

Sem schema, permissões, dependências, RLS ou mudanças no protocolo de backup/restauração. DP-01 a DP-04, demais plataformas e homologação humana posterior permanecem pendentes.
