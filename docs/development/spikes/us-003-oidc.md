# US-003 — Protocolo local OIDC

## Escopo

Instrumento sintético para RF-01 e ADR-007, conforme [backlog](../../delivery/05-backlog.md) e [ADR-0020](../../architecture/adr/0020-spike-identidade-oidc-local.md). Testa um IdP real separado, BFF HTTPS e protocolo de client público PKCE. Não acessa cofres Desktop/Mobile nem usa contas pessoais.

Google/Apple dependem de um ambiente de desenvolvimento ainda não configurado. Browser do sistema, deep/app links e armazenamento nativo do refresh token precisam de homologação própria. Next.js não é integrado por este instrumento Node. A US-003 permanece em andamento.

## Pré-requisitos

- Node e pnpm nas versões fixadas no repositório; pnpm install --frozen-lockfile.
- Docker com containers Linux e Compose, iniciado no host.
- OpenSSL no PATH; US003_OPENSSL pode apontar para o executável local.
- Portas 43180, 43181, 43182 e 43185 livres em 127.0.0.1. O probe do client público recebe o redirect em um listener HTTP real em 43182/callback, dentro do processo Node de homologação.
- A primeira execução baixa imagens por digest e Chromium compatível com Playwright. Downloads e caches ficam fora dos fontes; o navegador é instalado em .tools/us003-oidc/browsers.

## Execução reproduzível

```sh
pnpm spike:oidc:test
pnpm check
```

O teste recria apenas o projeto Compose financial-manager-us003, gera realm/credenciais sintéticas, espera discovery, cria certificado local e executa Chromium headless. O teardown remove os containers/redes próprios, H2/e-mails em tmpfs e arquivos credentials.json, realm.json, localhost.key e localhost.pem de .tools/us003-oidc. Não altera containers de outras histórias. Em falha, o relatório contém somente etapa e localização de código segura; URLs com query, senhas e tokens nunca são copiados.

O relatório sanitizado fica em .tools/us003-oidc/report.json. O runner só declara aprovação após checar todos os campos e o teardown. Nenhum resultado privado do browser ou do provider deve ser versionado.

## Casos de homologação local

1. Autenticar a identidade sintética com e-mail inicialmente não verificado; BFF deve negar sessão até concluir o link entregue exclusivamente ao Mailpit.
2. Confirmar cookie HttpOnly/Secure/SameSite/Path, ausência de tokens na resposta/HTML e ausência de cookie legível, localStorage, sessionStorage e IndexedDB no BFF. UserInfo autenticado é chamado pelo servidor.
3. Rejeitar Origin indevido, CSRF incorreto e uso de GET em rotas de mutação, mantendo a sessão válida.
4. Renovar tokens no servidor sem expô-los ao browser e preservar issuer/subject.
5. Sair localmente e no IdP; cookie anterior deixa de autorizar e nova entrada exige credenciais.
6. Recuperar senha pelo formulário do IdP e link no Mailpit; manter a identidade e rejeitar a senha anterior. O BFF não recebe senha.
7. Obter tokens com client público sem secret e PKCE S256; rejeitar replay do code, verifier incorreto, nonce/state incorretos, destino divergente e parâmetro duplicado.
8. Alterar a assinatura do ID token recebido do provider no transporte do teste e exigir rejeição pelo client.
9. Confirmar rotação de refresh, rejeição do refresh anterior e revogação efetiva em sessão separada.
10. Rejeitar callback em outro browser, state indevido, replay e pendência expirada; sessão expirada não autoriza recursos.

O teste de expiração usa relógio injetado apenas no store do BFF; code grant, JWT, UserInfo, senha, e-mail, refresh e revogação dependem do Keycloak real.

## Uso manual opcional

```sh
pnpm spike:oidc:setup
pnpm spike:oidc:serve
# Em outro terminal, após encerrar o BFF:
pnpm spike:oidc:down
```

O BFF responde em https://127.0.0.1:43181 com certificado local de teste; não instale esse certificado no trust store de produção. O Mailpit está em http://127.0.0.1:43185. A fixture usa synthetic@us003.invalid e a senha aleatória gerada está exclusivamente no arquivo privado credentials.json, enquanto o setup permanece ativo. Nunca utilize senha, e-mail ou tokens reais neste instrumento. Serve não encerra os containers automaticamente; down remove o ambiente e os segredos próprios.

## Pendências para encerrar US-003

- Homologar Google e Apple no IdP de desenvolvimento explicitamente configurado; não usar igualdade de e-mail para vincular identidades.
- Integrar BFF ao Next.js e validar deployment HTTPS, sessão de servidor e políticas de origem/cookie no ambiente escolhido.
- Homologar browser externo, callback deep/app link, client público e secret store nos runtimes Desktop/Android/iOS.
- Validar cadastro, consentimento/vinculação com prova de ambas identidades, recovery dos provedores e encerramento de sessão conforme comportamento de cada provider.
- Escolher IdP gerenciado e registrar limites/custos; não confundir Keycloak local com essa decisão.

## Resultado

Homologação local aprovada em 2026-10-15, concluída às 01:54 UTC de 2026-10-16 (noite de 15/10 em America/Fortaleza). A [evidência sanitizada](../../quality/evidence/us-003-local-2026-10-15.json) registra o horário preciso, 15 verificações de ambiente/protocolo, versões efetivas e teardown confirmado. Chromium 156.0.8078.4 e Node 24.19.0; pnpm check aprovado com 31 testes. Os arquivos privados de credenciais, realm e certificado foram removidos e não há containers próprios restantes.

O conjunto positivo consulta Keycloak real; a falha de assinatura altera exclusivamente a resposta de ID token recebida nesse caso negativo. Para reter um callback antes do BFF, a automação encaminha o POST real do formulário ao IdP e retém sua resposta 302; não inventa códigos nem troca o token endpoint. Os callbacks do client público chegam a um listener real em loopback. O resultado continua restrito ao recorte local descrito acima.
