# ADR-0029 — Tokens puros e shells distintos DOM/Native

- Data: 2026-10-16
- Status: Fundação DOM validada; Native tipado, homologação pendente
- Histórias: US-016; prepara telas e acessibilidade dos clientes
- Substitui: nenhum; concretiza arquitetura §03, RNF-12 e navegação P0

## Contexto e alternativas

A [US-016](../../delivery/05-backlog.md) exige tipografia/espaçamento/estado versionados e exemplos acessíveis. O [PRD](../../product/01-prd.md) usa WCAG 2.2 AA como referência e exige Desktop local sem login. O [mapa de telas](../../product/02-screens-flows.md) distingue contexto cloud/local e estados de ausência, falha e escopo. Os conceitos visuais orientam cor/composição, sem autorizar IA, originais retidos ou dados fictícios apresentados como reais.

Compartilhar componentes DOM com Native infringiria a fronteira do repositório. Um shell HTML fora do React duplicaria a composição prevista para Web/Desktop. Bibliotecas visuais completas e fonte externa aumentariam dependências e decisões antes dos clientes. Escolhemos tokens/modelo puros, React DOM compartilhado por Web/Desktop e componentes React Native próprios.

## Decisão

design-tokens e ui-dom passam à versão interna 0.1.0. Tokens são profundamente imutáveis, com tamanhos numéricos, cor/estado, tipografia, espaçamento, foco, alvos e movimento sem animação. DOM deriva variáveis CSS em rem; Native mantém fonte escalável. Contrato de apresentação tipado e imutável fica junto aos tokens, sem domínio, dados, autorização ou I/O. Web/Mobile recusam Local; Local não usa estado de sync.

AppShell React fornece slots controlados, seletor, navegação, landmarks, foco e estados explícitos. WebShell/DesktopShell verificam a plataforma. NativeShell usa primitives nativas e o mesmo contrato, sem depender de ui-dom. Nenhuma mudança permite ui-dom no Mobile ou Node/React no domínio. Tokens não têm dependência de produção.

React 19.3.0, já fixado no Mobile, é reutilizado como dependência de produção de ui-dom/Web/Desktop para compor os shells. Novas relações internas: ui-dom → design-tokens, Web/Desktop → ui-dom e Mobile → design-tokens, todas já permitidas pela matriz. React DOM 19.3.0 é somente desenvolvimento do host de exemplo. esbuild 0.28.2 empacota a demonstração e @axe-core/playwright 4.14.0 avalia acessibilidade; tipos React/React DOM são de desenvolvimento. O postinstall do esbuild permanece explicitamente negado no pnpm: usa-se o binário fixado da dependência opcional da plataforma. Não se habilitam builds arbitrários.

pnpm ui:serve expõe somente o exemplo sintético em loopback, com assets compilados em memória, paths fechados, Host validado, CSP/no-store e sem fonte/imagem/CDN/API externa. A exceção style-src unsafe-inline é restrita ao host de demonstração para variáveis estáticas React; não define CSP de produto. Não há persistência no navegador, credenciais, bancos ou telemetria. A entrada nativa US-002 permanece intacta.

## Ameaças e limites

| Fronteira            | Risco                                        | Controle e pendência                                                                                  |
| -------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Texto de espaço → UI | HTML/script injetado                         | React text nodes; sem HTML arbitrário; SSR com fixture hostil                                         |
| Troca de espaço      | Filtros/conteúdo do espaço anterior          | Exemplo reseta rota/busca, slots por chave; host de produto deverá cancelar requests e validar escopo |
| Estado visual        | Erro/sem permissão parecer saldo zero        | Avisos distintos e children ocultos; UI não substitui autorização                                     |
| Local/cloud          | Exigir login ou chamar local de sincronizado | Modelo distingue autoridade; Local não aceita sync, Web/Mobile não aceitam Local                      |
| Teclado/visão        | Foco perdido, contraste ou reflow            | Tokens medidos, botões padrão, skip/foco/status e protocolo real DOM; leitor de tela/manual pendente  |
| Host de exemplo      | Exposição de arquivos/dados ou egress        | Loopback, mapa fechado, CSP e fixtures sintéticas; não é servidor de produto                          |

## Verificação

12 testes Node cobrem tokens/contraste/contexto/SSR, e três cobrem hashes e gates da evidência. Chromium real passou em 12 gates com Axe nos seis estados, teclado/foco, busca/troca de espaço, reflow, fonte raiz a 200%, forced-colors e ausência de storage/tráfego externo/erros. [Evidência sanitizada](../../quality/evidence/us-016-dom-2026-10-16.json), [guia](../../development/design-system.md). Capturas são sintéticas e ficam ignoradas; browser/listener encerram no teardown.

pnpm check aprovado localmente com 187 testes Node, tipos DOM/Native/host, lint/fronteiras, formatação, geração de contratos, configuração e build. Os quatro perfis Docker foram revalidados após as mudanças de dependências/CI, com limpeza e [nova evidência](../../quality/evidence/us-014-environments-2026-10-16-us016.json); relatórios anteriores preservados. CI remota deste incremento ainda não executada.

O resultado não declara conformidade WCAG completa, leitor de tela validado, execução Native ou integração Next.js/Vite/Tauri. NativeShell/NativeShellExample foram compilados e tipados; Android/iOS, TalkBack/VoiceOver, teclado/safe area e escalas reais continuam pendentes. Não há telas financeiras, autorização, dados de produto ou deploy. DP-01 a DP-04/G07 permanecem nos seus escopos.

Fontes primárias consultadas em 2026-10-16: [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [acessibilidade React Native](https://reactnative.dev/docs/accessibility), [React createRoot](https://react.dev/reference/react-dom/client/createRoot), [esbuild](https://esbuild.github.io/getting-started/) e [pnpm allowBuilds](https://pnpm.io/settings/build#allowbuilds).
