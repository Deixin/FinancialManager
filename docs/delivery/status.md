# Estado do projeto

## W0 — US-003 em andamento — 2026-10-15

Foi implementado o instrumento local OIDC em apps/web/spikes/us-003, com Keycloak separado em Docker, verificação/recuperação de e-mail no Mailpit, BFF Node HTTPS com sessão opaca e client público PKCE. O [protocolo](../development/spikes/us-003-oidc.md) e o [ADR-0020](../architecture/adr/0020-spike-identidade-oidc-local.md) delimitam os resultados e as ameaças. O usuário confirmou que não há ambiente Google/Apple configurado e autorizou a validação local com identidade sintética.

pnpm check aprovado com 31 testes. A [homologação local de navegador](../quality/evidence/us-003-local-2026-10-15.json) passou em Chromium 156.0.8078.4 com 15 verificações de ambiente/protocolo: isolamento Docker, e-mail, recovery, BFF/cookies/CSRF, renovação/logout, PKCE, falhas negativas, rotação/revogação e vínculo/expiração/replay de callback/sessão. Containers próprios, H2/e-mails temporários e arquivos efêmeros foram removidos; não houve uso de contas reais.

Google/Apple, integração Next.js e runtimes nativos com browser externo/deep link/secret store permanecem pendentes; US-003 não está concluída. A homologação iOS da US-002 também continua pendente. Nenhuma política offline, papel ou prazo de retenção das DP-01 a DP-03 foi alterado.

## W0 — US-002 em andamento — 2026-10-15

Foi implementado o instrumento Expo em apps/mobile/spikes/us-002, com SQLCipher por config plugin, chaves por workspace no SecureStore e contrato experimental de INT64 como strings decimais canônicas. O [protocolo](../development/spikes/us-002-mobile-vault.md) distingue unitários, typecheck, build e execução nativa; o [ADR-0019](../architecture/adr/0019-spike-cofre-mobile.md) justifica as dependências e registra ameaças.

pnpm check aprovado com 25 testes; typecheck Expo e build Android nativo aprovados. A [homologação Android](../quality/evidence/us-002-android-2026-10-15.json) passou em emulador AOSP Android 16/API 36 x86_64, com SQLCipher 4.17.0 community. Foram verificadas três fases: preparação, reabertura após reinício completo (boot_count 2 → 3) e limpeza das bases/chaves próprias. Modo avião, Wi-Fi e dados móveis foram conferidos antes/depois do reboot. O emulador foi encerrado após a execução.

O ambiente atual é Windows; o roteiro iOS está preparado para Mac, sem presumir acesso a Xcode ou credenciais. A homologação iOS permanece pendente e a história não está concluída. O instrumento não implementa login, autorização cloud, sincronização ou concessão de acesso offline. DP-01 a DP-03 continuam abertas. As adaptações necessárias de build/empacotamento e a divergência do verificador de compatibilidade Expo estão registradas no ADR-0019; o resultado Android não aprova a stack de produção.

## W0 — US-001 concluída como spike — 2026-10-13

Foi implementado o primeiro spike em apps/desktop/spikes/us-001: Tauri, SQLCipher, Windows Credential Manager, envelope Argon2id/AES-256-GCM, prévia e restauração em staging com nova chave e novo workspace LOCAL. O [ADR-0017](../architecture/adr/0017-spike-cofre-desktop.md) registra as escolhas experimentais e ameaças. O [protocolo da US-001](../development/spikes/us-001-desktop-vault.md) preserva os critérios de saída.

Evidência local:

- pnpm env:check --desktop: aprovado em Windows 11 x64, build 26200; Node 24.19.0 e pnpm 11.25.0.
- Rust 1.99.0, Cargo 1.99.0, target x86_64-pc-windows-msvc e componente C++ detectados.
- WebView2 Runtime 154.0.4258.62 detectado; programa Rust temporário compilado, vinculado e executado com sucesso.
- pnpm check: aprovado, incluindo 19 testes das regras do repositório, diagnóstico e integridade temporal da evidência, typecheck e build dos módulos TypeScript.
- pnpm spike:desktop:check: fmt, Clippy sem avisos, 13 testes Rust, build Tauri e smoke real WebView/IPC aprovados. O engine reportou SQLCipher 4.14.0 community; o relatório local fica ignorado pelo Git.
- Testes de recuperação usam processos separados, removem cofre/chave de origem, interrompem o processo em dois checkpoints e confirmam limpeza e preservação byte a byte do cofre existente.
- Kit reproduzível e [roteiro para outro perfil/máquina](../development/spikes/us-001-homologation.md) preparados; não contêm segredos ou dados reais.
- Homologação host → VM Windows 11 independente: aprovada, com remoção do cofre/chave de origem, falhas negativas, dois checkpoints de interrupção, prévia, novo workspace, fixture exata e preservação do existente. Após reiniciar o Windows, chaves recuperadas pelo Credential Manager e smoke real Tauri/WebView aprovados. Fixtures/credenciais próprias removidas e contêiner parado.
- [Evidência sanitizada](../quality/evidence/us-001-windows-vm-2026-10-13.json): guest Windows 10.0.26200.0, SQLCipher 4.14.0 community, hashes dos executáveis/imagem, resultado produzido após a reinicialização. Infraestrutura e ameaças no [ADR-0018](../architecture/adr/0018-homologacao-desktop-vm-docker.md).

US-001 concluída no escopo experimental do protocolo: a VM possui instalação Windows, perfil e Credential Manager independentes do host. Não se trata de dois diretórios no mesmo perfil. O resultado não entrega o produto financeiro, schema/formato finais, instalador assinado, homologação em hardware físico diferente ou teste de queda de energia. A CI nativa foi configurada e ainda não foi executada remotamente. US-002 a US-007 e a adoção final das decisões físicas continuam pendentes; DP-01 a DP-03 permanecem abertas.

## Bootstrap — 2026-10-12

Foram organizados a documentação e os conceitos, criados os workspaces e preparados os arquivos Git, as ferramentas compartilhadas e a CI.

- US-010: estrutura inicial, compilação isolada dos módulos e verificação de dependências. As aplicações ainda não têm seus frameworks integrados.
- US-011: ferramentas e gates iniciais. A cobertura de comportamento do produto será implementada junto às histórias.
- W0, US-001 a US-007: pendentes no bootstrap de 2026-10-12; a conclusão posterior da US-001 está registrada acima.
- W1–W6: implementação do produto pendente.

O roteiro continua sendo o [plano original](06-implementation-plan.md). Antes das implementações afetadas, resolva as [divergências documentais](../architecture/decisions-pending.md) e registre evidências dos spikes.

## Próximos passos previstos

1. Executar a homologação iOS da US-002 em Mac/Xcode; Android aprovado em 2026-10-15. Manter a história em andamento até a evidência iOS.
2. Executar os demais spikes W0 e registrar as escolhas físicas nos ADRs.
   A US-003 possui instrumento local; concluir a homologação de identidade com os conectores e runtimes pendentes antes de declará-la encerrada.
3. Integrar os frameworks e fundações conforme as dependências das histórias.
4. Expandir CI com os testes financeiros, de integração e das plataformas.
