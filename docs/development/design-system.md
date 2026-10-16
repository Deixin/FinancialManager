# Design tokens e shells — US-016

Referências: [RNF-12 e navegação](../product/01-prd.md), [estados e fluxos](../product/02-screens-flows.md), [US-016](../delivery/05-backlog.md) e [ADR-0029](../architecture/adr/0029-design-tokens-e-shells.md).

## Executar o exemplo DOM

```powershell
pnpm install --frozen-lockfile
pnpm ui:serve
```

Abra http://127.0.0.1:44360. O exemplo React oferece Desktop local/cloud, Web cloud, sete seções P0, troca de espaço, busca de seções e seis estados. Os seletores de estado e disponibilidade são ferramentas de demonstração. Todos os contextos são sintéticos; não há banco, login, armazenamento do navegador ou dados financeiros. Ctrl+C encerra o host. Ele compila o bundle em memória, serve recursos conhecidos e endpoints same-origin sintéticos da [US-017](runtime-configuration.md), valida Host/Origin e usa CSP/no-store. Não é servidor de produto ou deploy.

## Contrato compartilhado

packages/design-tokens versão 0.1.0 contém tokens imutáveis de cor/estado, tipografia, espaçamento, raio, alvo, foco, layout e movimento. Não importa React, DOM, Node ou React Native. A fonte numérica é comum; cssVariables converte tamanhos para rem e o Native usa unidades lógicas com escala de fonte habilitada. Fontes são do sistema, sem download externo. Tema claro inicial; tema escuro permanece fora deste incremento.

O pacote também exporta o modelo puro de apresentação createShellModel, tipos e catálogos. Ele valida combinações de plataforma, autoridade e estado, copia apenas campos declarados e congela o resultado. Não consulta dados, calcula dinheiro, autentica ou autoriza. IDs de espaço são opacos para a camada visual. O código não cria identificadores de recursos financeiros.

A US-017 acrescenta sections ao modelo e factories por aplicativo que filtram seções conforme configuração pública validada. A rota selecionada deve estar disponível; os consumidores devem limpar rota/busca na atualização. Nenhuma regra de feature flag foi inserida no domínio ou no pacote visual. A demonstração aplica esse fluxo ao desligar seções opcionais; o servidor sintético também aplica o gate à operação.

| Estado    | Comportamento                                                     |
| --------- | ----------------------------------------------------------------- |
| ready     | Conteúdo disponível                                               |
| loading   | Conteúdo anterior oculto; main ocupado e aviso de carregamento    |
| empty     | Ausência de registros explícita, sem total zero inventado         |
| error     | Conteúdo anterior oculto; repetição quando o host fornece onRetry |
| partial   | Aviso de escopo parcial e conteúdo autorizado                     |
| forbidden | Aviso de acesso restrito e conteúdo financeiro oculto             |

Desktop local não recebe estado de sincronização: mostra “Local · Somente neste dispositivo” e não exige identidade/rede. Cloud pode informar atualizado, pendente, offline ou conflito. Web/Mobile recusam autoridade local. Apresentação de offline não concede lease nem resolve DP-01. O chamador fornece workspace/lista já autorizados; esconder conteúdo não substitui controles de backend/RLS.

## Adaptadores DOM

packages/ui-dom exporta AppShell e ContentNotice; importe também @financial-manager/ui-dom/styles.css no host. WebShell e DesktopShell, exportados pelos respectivos apps, verificam a plataforma e compartilham o componente. O modelo, rota, estado, espaços e callbacks são controlados pelo host. children contém o conteúdo da seção; footer fica reservado a utilidades persistentes, como os controles da galeria.

Troca de espaço precisa atualizar modelo, rota, filtros e dados de forma coerente antes de ready. O exemplo faz isso em uma atualização React e limpa a busca; o slot de conteúdo usa chave por espaço para reiniciar estado de componentes filhos. O host de produto continua responsável por cancelar requests antigos e validar o escopo das respostas.

Há landmarks, seletor rotulado, navegação por botões padrão, aria-current, link para pular navegação, foco no título após navegação/troca de espaço e após recuperar erro. Avisos atualizam uma região polite fora do main ocupado. Busca de exemplo restaura foco ao fechar. Sem animação, altura fixa de texto ou ícones como único rótulo. CSS contempla forced-colors, reflow e foco visível; sidebar é recolocada acima do conteúdo em telas estreitas.

## Adaptador Native

apps/mobile/src/native-shell.tsx exporta NativeShell com View/Text/Pressable/ScrollView e os mesmos tokens/modelo. O exemplo em native-shell-example.tsx está disponível para montagem no host Expo com tratamento de safe area. Não alteramos a entrada do experimento US-002, nem exportamos componentes Native pelo index consumido pelos testes Node de contratos.

O layout prioriza Início, Movimentos e Mais, com seletor cloud, seções adicionais, rótulos, papéis/estado acessíveis, região live no Android, texto escalável sem limite de linhas e alvos de no mínimo 48 unidades. A compilação/tipagem passou; ainda falta executar o exemplo em Android/iOS, teclado nativo, TalkBack/VoiceOver e telas/fontes ampliadas. Não há alegação de conformidade nativa com base no teste Chromium.

## Testes e evidência

```powershell
# Chromium precisa ser instalado uma vez; o caminho é configurável.
$env:PLAYWRIGHT_BROWSERS_PATH = '.tools/us016-ui/browsers'
pnpm exec playwright install chromium
pnpm ui:check
pnpm check
```

12 testes Node verificam tokens/versionamento, imutabilidade, contraste, escala, combinações de contexto, estados, snapshot e escape de texto no SSR. Mais três verificam a [evidência do navegador](../quality/evidence/us-016-dom-2026-10-16.json), incluindo hashes, gates, limpeza e limites de escopo.

O protocolo Chromium passou em 12 gates: sem login no local, landmarks, teclado/skip/foco, estados e região de status, Axe nos seis estados, retry, troca de espaço/busca, Web cloud, reflow 320/375/768 com nome longo, fonte a 200%, forced-colors e ausência de storage/tráfego externo/erros de script. A ampliação verificada altera o tamanho da fonte raiz, não é uma prova de todos os modos de zoom do navegador. A execução local reutilizou a instalação Chromium correspondente ao Playwright fixado. Relatório e capturas sintéticas temporários ficam em .tools/us016-ui; somente o JSON sanitizado é arquivado. Browser e listener de testes são encerrados.

Axe sem violações e medições de contraste não equivalem à conformidade WCAG completa. A avaliação humana com tecnologias assistivas e os fluxos financeiros reais continuam pendentes, assim como integração Next.js/Vite/Tauri, roteamento/deep links, telas financeiras, dados e autorização. O novo job ui-shell executa o protocolo DOM em Ubuntu; quality mantém unitários/tipos em Windows/Linux. Execução remota deste incremento pendente.
