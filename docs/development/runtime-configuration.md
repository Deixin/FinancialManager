# Flags e configuração por ambiente — US-017

[Aceite](../delivery/05-backlog.md): funcionalidades incompletas podem ser desativadas sem fork de código. [ADR-0030](../architecture/adr/0030-flags-e-configuracao-por-ambiente.md) registra decisões, ameaças e limites.

## Contrato público

@financial-manager/runtime-config 0.1.0 não depende de framework, Node, DOM, rede ou bibliotecas externas. O host fornece a configuração; o pacote valida, congela e aplica os snapshots.

```json
{
  "format_version": 1,
  "environment": "local",
  "revision": 1,
  "features": {
    "importReview": false,
    "documentReview": false,
    "reports": false,
    "cloudSync": false,
    "workspaceMigration": false
  }
}
```

Ambientes aceitos: local, ci, integration, staging, production, sempre comparados ao ambiente esperado pelo host. Revisão é um inteiro de 0 a 2147483647; revisão zero só aceita flags desligadas. Flags omitidas tornam-se false. Campos desconhecidos, strings no lugar de booleanos, versões distintas e acessores/herança são recusados. decodeConfiguration limita JSON a 8192 caracteres. disabledConfiguration cria defaults sem rede/login.

| Flag               | Disponibilidade quando true                              |
| ------------------ | -------------------------------------------------------- |
| importReview       | Seção e operação de revisão de importação                |
| documentReview     | Seção e operação de revisão de documentos                |
| reports            | Seção e operação de relatórios                           |
| cloudSync          | Autoridade cloud em Desktop/Mobile/API/worker; nunca Web |
| workspaceMigration | Desktop/API/worker, respeitando o fluxo de migração      |

Somente Desktop admite autoridade local. Flags não mudam permissões, lease, autoridade, cobrança, consentimento, telemetria ou regras financeiras. Nenhuma flag habilita IA externa/Open Finance. Os handlers de produto ainda serão integrados nas histórias correspondentes.

## Carregar e atualizar

infra/config/profiles contém cinco templates, todos desativados por segurança enquanto as funcionalidades estão incompletas. São exemplos públicos versionados, sem endpoints ou credenciais. pnpm config:check valida os templates e integra pnpm lint/check. Não são carregados implicitamente nem alteram os serviços Docker.

configurationFromEnvironment recebe um mapa explícito e lê apenas FM_ENVIRONMENT e FM_RUNTIME_CONFIG. A primeira chave, quando presente, deve coincidir com o ambiente esperado. A segunda contém o JSON completo; ausente produz defaults. NODE_ENV, NEXT_PUBLIC e outras variáveis não ativam funções. Não serialize process.env para clientes. Segredos continuam na configuração privada do host.

```typescript
import { createApiFeatures } from '@financial-manager/api';

// No entrypoint confiável do servidor; ambiente definido pelo deployment.
const features = createApiFeatures('staging', process.env);

// Fonte confiável de operação fornece um objeto público com revisão superior.
features.replace(nextValidatedPublicConfiguration);

await features.execute(
  'importReview',
  () => authorizeWorkspaceAndImport(request),
  () => importService.review(request),
);
```

O exemplo mostra o ponto de integração; serviços/request/atualizador pertencem ao host e não são entregues pelo pacote. createWorkerFeatures fixa contexto worker/cloud; o job deve consultar o executor ao iniciar o consumo, preservando o job se indisponível. Desktop pode usar createFeatureGate com contexto desktop/local sem identidade cloud. Não use valores de request para configurar o gate servidor ou informar a autorização.

replace aceita revisão crescente e mesma revisão/conteúdo normalizado como repetição idempotente. Configuração inválida, antiga ou conflitante lança RUNTIME_CONFIGURATION_INVALID e desliga todas as funções opcionais. A maior revisão permanece e a recuperação exige revisão superior. Nenhum valor de entrada é incorporado ao erro. Essa memória não persiste entre processos/reinícios.

execute rejeita FEATURE_UNAVAILABLE antes de autorizar se desligada. Autorizar precisa retornar exatamente true; caso contrário FEATURE_ACCESS_DENIED. Há nova consulta à flag após o await de autorização. Desligar não cancela operação já iniciada, limpa outbox, confirma job ou altera erro financeiro. Atomicidade, idempotência e autorização transacional continuam nas próprias camadas.

createWebShellModel/createDesktopShellModel/createMobileShellModel recebem configuração validada e geram apenas as seções habilitadas. Rota opcional desativada é recusada pelo modelo. O host deve redirecionar para overview, limpar filtros/busca e proteger handlers/deep links. Os quatro recursos básicos permanecem disponíveis.

## Demonstração e validação

```powershell
pnpm install --frozen-lockfile
pnpm config:check
pnpm ui:serve
# Em outro terminal, com Chromium Playwright instalado:
pnpm ui:check
pnpm check
```

Em http://127.0.0.1:44360, “Disponibilidade do exemplo” alterna todas as seções sintéticas ou somente recursos básicos em execução. Navegação, cartões, busca e rota são atualizados juntos. O servidor de exemplo aceita apenas as duas escolhas fechadas e incrementa a revisão; a operação import-preview é sintética e passa pelo mesmo gate de servidor. O bundle não é recompilado nessa troca. GET runtime-config.json é público/no-store; POST demo-availability e demo-actions/import-preview exigem Origin exato e JSON. Não há dados financeiros, banco, cookies, storage ou tráfego externo.

A configuração inicial dessa demonstração habilita três seções sintéticas. Isso não habilita os templates de produto nem conclui implementações de importação/documentos/relatórios. NativeShellExample oferece controle equivalente em memória, com defaults desativados, sem runtime Native homologado.

15 testes Node cobrem parsing, defaults/ambientes, getters/Proxy, allowlist ambiental, revisões, filas, negação de autorização, desligamento durante await e preservação de trabalho iniciado. Um listener HTTP real verifica que o cliente não habilita flags e que autorização continua necessária.

O [relatório Chromium](../quality/evidence/us-017-flags-2026-10-16.json) comprova oito gates: seção/operação habilitadas; remoção/limpeza de UI; bloqueio de operação; configuração pública/no-store e bundle idêntico; reload/recuperação com revisão superior; rejeição de origem externa; fechamento após falha; Axe no estado limitado e ausência de storage/tráfego externo/erro. Os [12 gates US-016](../quality/evidence/us-016-dom-2026-10-16-us017.json) também foram reexecutados. Relatórios temporários ficam em .tools/us017-flags e .tools/us016-ui; os arquivos arquivados contêm somente gates, datas, versões e hashes. Listeners/browsers de testes são encerrados.

Não há provedor remoto, polling, assinatura, persistência de revisão, targeting ou propagação entre instâncias. A integração Next.js/NestJS/Tauri/Expo e de handlers reais continua pendente. Flags são disponibilidade funcional e exigem autorização independente em cada operação. Execução CI remota e homologação Native/leitores de tela não são inferidas dos testes locais.
