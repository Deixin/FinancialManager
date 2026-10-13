# Estado do projeto

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

1. Executar o próximo spike W0, US-002, conforme autorização e dependências.
2. Executar os demais spikes W0 e registrar as escolhas físicas nos ADRs.
3. Integrar os frameworks e fundações conforme as dependências das histórias.
4. Expandir CI com os testes financeiros, de integração e das plataformas.
