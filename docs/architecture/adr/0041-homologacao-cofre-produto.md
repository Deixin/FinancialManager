# ADR-0041 — Homologação do cofre de produto e recuperação nativa

Status: adotado e validado para o aceite US-032 em Windows x64; G07-VAULT global permanece parcial.

Data: 2026-10-17. História: US-032. Referências: RF-32, RNF-03, arquitetura §05, ADR-0024/0032/0033/0040 e [protocolo](../../development/desktop-vault.md).

## Contexto

A US-031 antecipou SQLCipher/chave Windows para persistir workspaces sem conta cloud. A prova inicial cobriu criação interrompida antes da publicação, mas não atualização de banco financeiro existente nem rollback de journal quente. US-032 exige recusa sem chave correta e ausência do segredo em texto.

## Decisão

Validar o core atual com falhas reais e fixture financeira no escopo da instalação local. Preservar a política de abertura/compatibilidade/publicação de identidade do ADR-0040; versão observada e PRAGMAs de homologação não viram novos critérios de recusa de cofres existentes. Nenhuma migration ou dependência de produção muda.

Adicionar oito testes Rust e feature opcional vault-smoke com rusqlite/trace, módulo e binário vault-probe. O default permanece sem essa feature/handlers de teste, com três permissões de produto. Testes de secret store usam doubles determinísticos; subprocessos usam Windows Credential Manager real em instalação temporária própria.

O migrador não recebe hooks de produção. Trace de teste encerra a conexão real após DDL, após histórico e antes do COMMIT. Reabertura exige rollback para v1 antes de nova tentativa. A comparação abrange todas as colunas das 12 tabelas financeiras do workspace A do FIN-002 v1, com i64 como strings. Upgrade chega a v2 sem mudar esse estado. Cache spill produz journal DELETE quente; examinam-se os arquivos antes da recuperação e verifica-se rollback completo depois.

## Alternativas e consequências

Abrir apenas um banco vazio não demonstraria preservação em falhas. Reutilizar o instrumento do spike não provaria core/schema do produto. Novas exigências de compatibilidade ao abrir bancos existentes ampliariam risco sem necessidade para este aceite. A instrumentação opcional testa a implementação vigente sem alterar seu funcionamento normal.

São 11 gates nativos, oito testes Rust novos e três Node para evidência, além da reexecução dos seis Rust/15 gates Windows e oito Chromium de workspaces. Relatório sanitizado exige fontes atuais e limpeza integral; relatórios anteriores permanecem históricos sem reescrever hashes. CI Windows configurada, sem afirmar execução remota observada.

## Ameaças e limites

Perda de chave/store indisponível não pode regenerar ou sobrescrever banco publicado. Falha de persistência/limpeza deve permitir recuperação; adulteração de arquivo/schema/histórico deve falhar sem novas escritas de migração. Testes comparam bytes ou estado completo conforme o caso. Scan procura chave bruta/hexadecimal e conteúdo sintético conhecido, inclusive no journal quente. Dados financeiros/SQL/segredos não são logados ou expostos à WebView.

Instrumento prepara somente raízes novas e exige marcador sintético para operar/limpar. Remove credenciais próprias antes dos arquivos e verifica o resultado. Não cobre usuário Windows/admin comprometido nem corte físico de energia. G07-VAULT mantém backup_manifest/restore em outra instalação, outbox, assinatura/distribuição e plataformas adicionais pendentes. US-033 adicionará PIN/biometria opcionais; US-034/035 implementarão backup/restore. Não substitui os demais ADRs nem resolve DP-01 a DP-04.
