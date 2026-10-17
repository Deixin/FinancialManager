# Restaurar backup local — US-035

A [US-036](workspace-manager.md) amplia o fluxo com criação de outros espaços, finalidade no seletor, lista completa após restauração e reentrada e troca de contexto segura. Os protocolos atuais das histórias anteriores foram arquivados com sufixo us036; os registros abaixo preservam suas entregas históricas.

Na lista de espaços locais do Desktop Windows, escolha Restaurar backup. Selecione o arquivo .fmbackup no Windows. Com PIN ativo, desbloqueie novamente por PIN/Hello e informe a senha original do pacote. Confira a prévia e reconheça a criação de um novo espaço local antes de confirmar. O aplicativo não guarda a senha; PIN/Hello não a recuperam. A prévia não publica um espaço e não altera nenhum espaço existente.

A prévia contém nome de origem, data do backup, nome resultante e contagens das 12 tabelas financeiras disponíveis. Schema/integridade/contagens de todas as 15 tabelas são verificados no Rust. O nome recebe o sufixo restaurado; IDs do espaço e de recursos, geração e chave Windows são novos. Valores, vínculos e histórico são preservados. A cópia não reconecta cloud, não substitui outro espaço e não inclui originais de documentos. Consulta/edição financeira completa e entidades ainda não implementadas mantêm suas próximas histórias.

Somente FMBK0034 v1/schema v2 da US-034 é aceito nesta versão; FMUS001 do spike é incompatível. Limites e criptografia continuam os do [backup](local-backup.md). Primeiro validar formato/autenticação/checksum; depois criar staging já SQLCipher, migrar o novo cofre e copiar sob FK/triggers habilitados. Não há SQLite/JSON financeiro em claro no disco, nem segredo em arquivo de recibo. Senha/chaves/conexões são descartadas antes de apresentar a prévia. [Decisões e ameaças](../architecture/adr/0046-restauracao-como-novo-workspace.md).

Bloquear, perder foco, mudar proteção, cancelar ou reiniciar invalida a prévia e limpa staging/chave próprios. Uma publicação já concluída não é apagada por uma falha posterior. Repetir a confirmação da mesma prévia/ID reabre o mesmo novo espaço, inclusive depois de reiniciar o processo. Se a resposta se perder e a UI já não tiver o ID, confira a lista antes de selecionar o backup de novo. Outro pedido deliberado é outra cópia independente. Não há sobrescrita ou promessa de power loss em todo filesystem.

## Reprodução

```sh
pnpm install --frozen-lockfile
pnpm desktop:restore:check
pnpm desktop:restore:native
pnpm desktop:backup:check
pnpm desktop:backup:native
pnpm desktop:workspaces:check
pnpm desktop:workspaces:native
pnpm desktop:vault:check
pnpm desktop:lock:check
pnpm desktop:lock:native
pnpm check
```

Pré-requisitos seguem [cofre Desktop](desktop-vault.md): Windows x64, Rust 1.99.0/MSVC/SDK, Perl Windows e WebView2. Sem Tauri, a prévia de navegador não apresenta restauração nem mantém cofre offline. O default exclui instrumentos, caminhos forçados, hooks e credenciais sintéticas. restore-smoke é uma feature opcional de testes; não concede filesystem/SQL/diálogo genérico. Produto possui 15 permissões específicas.

## Evidências e escopo

[Oito gates Chromium](../quality/evidence/us-035-restore-browser-2026-10-17.json) verificam modo nativo, PIN/segredo, campo limpo após erro, prévia e reconhecimento, novo espaço, cancelamento/resposta atrasada, perda de ACK sem duplicação, axe, reflow 320px/texto 200%, cores forçadas e ausência de storage/egress/erros. Bridge é exclusiva de Playwright e não comprova persistência ou seletor real.

[17 gates Windows](../quality/evidence/us-035-restore-windows-2026-10-17.json) incluem 14 testes Rust, build/Clippy, instalação distinta com remoção da chave Windows original após exportar, comparação do grafo financeiro completo, prévia/cancelamento, senha errada/adulteração, replay entre processos e três interrupções. Seis checkpoints WebView2 exercitam IPC de produto e seletor Rust sintético; o cofre publicado pela UI é reaberto e comparado independentemente. Não se declara interação humana com IFileOpenDialog homologada por esse double.

FIN-002 é explicitamente sintético. Cada protocolo cria raízes/perfis/credenciais próprios em .tools/us035-restore. Remoção/verificação de política e chaves precedem a exclusão de diretórios/perfis marcados; evidência não passa sem limpeza confirmada. Relatórios fechados versionam gates, versões, pendências, data e hashes, sem senha, chave, nomes, caminhos privados ou registros. Probes não imprimem causas SQL ou payloads. As evidências anteriores são preservadas; relatórios atuais usam sufixo us035, privacidade v4 e backup v2, sem reescrever os históricos.

Homologações humanas de Hello/seletor e do fluxo integrado permanecem diferidas para após integrar todo o sistema conforme [ADR-0044](../architecture/adr/0044-homologacao-humana-apos-integracao.md), sem bloquear desenvolvimento ou marcar aprovação. Assinatura, outras plataformas, power loss, entidades futuras/outbox, G07-VAULT ampliado e DP-01 a DP-04 mantêm seus gates. Próximo incremento: US-036, gestão de múltiplos espaços locais.
