# ADR-0039 — Entrada Desktop sem identidade cloud

Status: adotado; EN-01 → início local de WS-01 validado em Chromium e Windows/WebView2.

Data: 2026-10-16. História: US-030. Referências: RF-01, EN-01, FL-01, ADR-0016/0029/0030 e arquitetura §05.

## Contexto

O Desktop precisa iniciar sem rede/cadastro. Até US-027 havia módulos TypeScript e exemplos DOM, com host nativo isolado no spike US-001. Isso não fornecia entrada de produto nem autorizava adotar o cofre experimental como persistência financeira.

## Decisão

Criar entrada React no apps/desktop, build Vite e host Tauri separados do spike. Continuar sem conta é a ação principal e muda somente a rota volátil para o início de WS-01 local. Entrar/Criar conta permanecem visíveis e desabilitados, com estado offline ou indisponibilidade de nuvem explícitos. Criação de espaço fica na US-031; não há usuário remoto anônimo, ID de rastreamento ou persistência da escolha.

Adicionar react-dom 19.3.0 como dependência do Desktop para montar React já adotado. Adicionar Vite 8.3.4 como ferramenta de desenvolvimento/build, com versão fixada e compatível com Node 24.19.0 do repositório. Novo crate fixa Tauri 2.12.3 e tauri-build 2.7.2 já usados no spike; não inclui SQLCipher ou secret store antes do gate de integração. Nenhum schema/contrato financeiro mudou.

Produção embute assets, não usa devUrl, não registra handler/plugin e concede zero permissões. CSP mantém scripts/assets locais, sem unsafe-inline/eval ou wildcard. O transporte IPC permitido pela CSP não concede comandos. Um binário de smoke separado, requerido por feature explícita, adiciona somente seu handler/capability de relatório fechado. Dynamic ACL fica restrita à feature de teste. Instalação/assinatura/updater não são ativados sem seus gates e credenciais.

## Alternativas e consequências

Manter apenas exemplo Chromium não validaria o host Desktop. Reusar o spike como aplicação confundiria dados sintéticos, schema experimental e produto. Habilitar login do spike ou simular criação de espaço ocultaria integrações pendentes. O slice atual torna EN-01 executável nas duas camadas e conserva US-031/032 como próximos passos independentes.

Há 12 gates Chromium e nove Windows/WebView2, além de três testes Node. Reflow, foco, axe, modo local offline, reabertura, rede/storage bloqueados e limpeza são comprovados no recorte descrito no [guia](../../development/desktop-entry.md). Offline nativo é sinal/egress injetado, sem alterar a rede do SO. Não se declara RF-01/FL-01 completo até painel, cofre seguro ativo, login cloud ou release assinado.

## Ameaças e limites

Confusão de modo é mitigada pela identificação Local e indisponibilidade cloud explícita. Egress involuntário e identidade anônima são cobertos por ausência de adapters/IDs e testes sem requests remotos/storage. XSS não recebe SQL, FS, shell ou segredo: não há permissões/handlers de produção. Handler de homologação não integra o binário padrão; perfil isolado e relatório fechado reduzem vazamento do teste. O preview é loopback e somente assets; não é origem cloud nem servidor financeiro.

Relógio, sessão cloud ou retorno à entrada não são autoridades financeiras. Workspace/cofre/autorização persistentes continuam nos gates correspondentes. DP-01 a DP-04 não são resolvidas por esta decisão; nenhum ADR anterior foi substituído. Referências técnicas: [Vite](https://vite.dev/guide/) e [Tauri capabilities](https://v2.tauri.app/security/capabilities/).
