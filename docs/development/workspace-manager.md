# Gerenciar espaços locais — US-036

No Desktop Windows, entre sem conta e escolha um espaço na lista. Cada item mostra nome, finalidade, Local e data de criação. O seletor dentro do espaço também mostra finalidade e permite criar outro ou gerenciar a lista. Não há limite comercial de quantidade; cada cofre continua independente e nenhum total é consolidado automaticamente.

Criar outro espaço abre um formulário limpo com o título Novo espaço local. Cancelar volta à lista relida do armazenamento. Se uma resposta se perder, repita a mesma solicitação ou verifique os espaços antes de iniciar outra: os campos ficam protegidos e o mesmo ID/payload é repetido. Um novo pedido deliberado recebe outro ID. Trocar de espaço remove a tela anterior enquanto abre o próximo e retorna à visão geral.

O filtro Nuvem informa que esse acesso exige conta e está indisponível nesta versão. Desktop anônimo cria somente Local; papéis, lista mista autenticada e estado de sincronização cloud seguem na US-095. A prévia em navegador continua sem persistência financeira. Não há novas dependências de produção, migrations ou comandos IPC; as 15 permissões existentes permanecem. [Decisão e ameaças](../architecture/adr/0047-multiplos-espacos-locais.md).

## Reprodução

```sh
pnpm install --frozen-lockfile
pnpm desktop:manager:check
pnpm desktop:manager:native
pnpm desktop:workspaces:check
pnpm desktop:workspaces:native
pnpm desktop:vault:check
pnpm desktop:lock:check
pnpm desktop:lock:native
pnpm desktop:backup:check
pnpm desktop:backup:native
pnpm desktop:restore:check
pnpm desktop:restore:native
pnpm check
```

Os requisitos nativos seguem o [cofre Desktop](desktop-vault.md): Windows x64, Rust 1.99.0/MSVC/SDK, Perl nativo e WebView2. A feature opcional manager-smoke inclui somente instrumentos de homologação; não é habilitada no produto. Os comandos da CI reproduzem os protocolos sem autenticar contas pessoais.

## Evidências e limites

[Nove gates Chromium](../quality/evidence/us-036-workspace-manager-browser-2026-10-17.json) usam bridge exclusivo de Playwright com 12 espaços, cancelamento e três criações, duas normais e outra com ACK perdido/repetição. Também verificam troca com IPC pendente, falhas de abertura/catálogo, bloqueio nativo sem blur, lista completa após restauração, axe, 320px/texto 200%, cores forçadas e ausência de storage/egress/erros. Isso não comprova persistência Windows.

[Onze gates Windows](../quality/evidence/us-036-workspace-manager-windows-2026-10-17.json) verificam fmt/Clippy/build locked, permissões estreitas e exclusão dos probes do default. Criam 13 cofres SQLCipher reais, repetem os 12 novos pedidos e reabrem todos em processo independente. FIN-002 preserva seu digest financeiro e ciphertext. Cinco checkpoints WebView2 exercitam filtro, finalidade, cancelamento, criação de dois espaços, troca e reentrada. Novo processo confirma os 15 cofres criados via produto. A quantidade exercitada é uma amostra; não se promete armazenamento infinito nem benchmark de milhares de cofres.

Os probes usam somente fixtures sintéticas e raízes/perfis próprios em .tools/us036-workspace-manager. Política e chaves Windows próprias são removidas e sua ausência verificada antes de excluir arquivos. Não se arquivam bancos, backups, nomes, caminhos privados ou credenciais. Os relatórios fechados incluem hashes das fontes, versões, gates, limpeza e pendências. Regressões atuais dos 16 relatórios anteriores têm sufixo us036, sem modificar as evidências históricas.

Homologações humanas serão realizadas após integrar todo o sistema, conforme [ADR-0044](../architecture/adr/0044-homologacao-humana-apos-integracao.md); diferido não significa aprovado. Assinatura, outras plataformas, entidades futuras/outbox e DP-01 a DP-04 mantêm seus escopos. Próxima história: US-040, CRUD de contas financeiras e saldo de referência.
