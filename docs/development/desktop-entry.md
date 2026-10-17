# Entrada Desktop — US-030

A primeira aplicação Desktop React/Vite + Tauri entrega EN-01 com Continuar sem conta, Entrar e Criar conta. A opção local aparece primeiro, permanece habilitada sem rede e navega para o início de WS-01, identificado como Modo local/Primeiro espaço. Não pede e-mail, senha ou CPF/CNPJ, não cria usuário remoto e não chama API, telemetria ou configuração cloud. Retornar à entrada e repetir a escolha não cria dados ou identidades.

O aceite da US-030, chegar ao modo local sem identidade cloud, foi atendido neste recorte. A criação persistente do workspace pertence à US-031; a tela de destino informa essa indisponibilidade e não simula criação, saldo, cofre ou dashboard. RF-01/FL-01 completos até o primeiro painel ainda dependem das histórias seguintes. Login/cadastro aparecem desabilitados com explicação, pois autenticação de produto permanece indisponível; o spike OIDC não é usado como login real do aplicativo.

## Implementação

apps/desktop/src/entry-model.ts controla somente ENTRY/LOCAL_SETUP. O componente React renderiza a tela, observa online/offline para a mensagem cloud, preserva modo local após mudança de rede e move foco/título após navegação. O indicador navigator.onLine não prova disponibilidade de um servidor; ele não autoriza login ou altera dados. A entrada não gera IDs nem persiste a escolha. Reabrir começa em EN-01 enquanto seleção de espaços persistentes não está implementada.

Vite 8.3.4 é dependência de desenvolvimento para produzir os assets reais do frontend; react-dom 19.3.0 passa a dependência explícita do Desktop para montar React. A versão React já era usada no repositório. Tokens semânticos da US-016 fornecem cores/foco/família; CSS local usa tamanhos relativos, reflow e suporte a cores forçadas. Sem fontes externas, cookies, storage, IndexedDB ou service worker. Nenhuma dependência financeira, schema ou contrato monetário mudou.

O novo crate apps/desktop/src-tauri reutiliza as versões Tauri 2.12.3/tauri-build 2.7.2 já fixadas no spike, com lock próprio e Rust 1.99.0. Ele embute frontend-dist e não importa o schema/cofre experimental US-001. Produção não registra comandos IPC/plugins nem concede permissões à WebView; withGlobalTauri fica desativado. CSP limita scripts/styles/assets à origem local e conexão ao transporte IPC, sem permissões financeiras correspondentes. A migração dos comandos financeiros/cofre ocorre nos gates próprios, a partir da US-032.

O binário entry-smoke depende da feature explícita entry-smoke; seu único comando recebe relatório fechado de booleanos. O handler e a capability de teste são adicionados somente nesse binário. Dynamic ACL e serde/serde_json são habilitados apenas nessa feature; o binário financial-manager padrão não possui handler de teste. A fixture injeta offline e falhas de rede/storage antes de montar React, sem mudar a rede ou perfil pessoal do Windows.

## Executar e verificar

```sh
pnpm install --frozen-lockfile
pnpm desktop:preview
pnpm desktop:entry:check
pnpm desktop:entry:native
pnpm check
```

Preview compila e serve os assets em http://127.0.0.1:44361, com porta fixa e recusa de conflito. É visualização DOM do mesmo build; não substitui Tauri. O comando de navegador precisa do Chromium do Playwright. O comando native exige Windows x64, Rust 1.99.0, MSVC/SDK e WebView2; executa fmt, Clippy com warnings negados e builds locked de produto/teste, sem instalador ou publicação. Após esse build, apps/desktop/spikes/us-001/target/debug/financial-manager.exe abre a aplicação. O target compartilhado reaproveita apenas artefatos compilados; o código/configuração do spike não foi alterado.

O [relatório Chromium](../quality/evidence/us-030-entry-browser-2026-10-16.json) registra 12 gates: três escolhas/prominência, teclado/foco, destino local sem credenciais, repetição/retorno, offline, mudanças de rede, privacidade, axe nas duas telas, reflow/texto 200%, cores forçadas/alvos, boot novo offline e ausência de storage/egress/erros. O boot Chromium offline recebe assets locais pelo instrumento; não usa servidor cloud.

O [relatório Windows/WebView2](../quality/evidence/us-030-entry-windows-2026-10-16.json) registra nove gates: build/Clippy, ausência de privilégios de produção, assets embutidos, cloud indisponível offline, destino sem identidade, foco, retorno, ausência de rede/storage e remoção do perfil próprio. Offline/egress são injetados na WebView; não se afirma desligamento físico da rede do SO. Ambos os relatórios exigem todos os gates, fontes atuais, versões, data e recursos encerrados. Três testes Node cobrem transições, configuração de privilégios e evidência.

Artefatos ficam em .tools/us030-entry, ignorados. O perfil temporário da WebView é isolado e removido após o processo, com espera limitada para liberação de handles; a evidência não contém perfil, PID, dados financeiros ou identidade. Assets e executáveis ficam ignorados; apenas fontes/locks e relatórios sanitizados são versionados. O job desktop-entry foi configurado, sem afirmar execução remota deste incremento.

## Limites e decisões

US-031/032, autenticação cloud, assinatura/instalador/updater, revisão manual com leitor de tela e plataformas adicionais seguem pendentes. Não há promessa de cofre ativo ou criptografia nesta tela. A prova TypeScript/Vite não é usada como prova nativa: WebView2 foi executada separadamente. As evidências Native/iOS anteriores mantêm seus escopos. DP-01 a DP-04 e os sete originais permanecem preservados. Decisão: [ADR-0039](../architecture/adr/0039-entrada-desktop-anonima.md).

Fontes técnicas: [Vite](https://vite.dev/guide/) para assets/build e [capabilities Tauri](https://v2.tauri.app/security/capabilities/) para privilégio por janela. Os testes usam as versões efetivamente fixadas nos locks.
