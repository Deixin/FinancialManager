# ADR-0020 — Instrumento local de identidade OIDC

- Data: 2026-10-15
- Status: Validado no recorte local; provedores sociais e runtimes de produto pendentes
- História: US-003; subsidia US-007
- Substitui: nenhum; preserva ADR-007 e não escolhe o IdP gerenciado de produção

## Contexto

O [backlog](../../delivery/05-backlog.md) exige login, logout, recuperação e callbacks com OIDC externo, BFF Web e PKCE native. O [PRD](../../product/01-prd.md), RF-01, exige e-mail verificado, Google e Apple; igualdade de e-mail não autoriza vincular identidades. Não há ambiente Google/Apple configurado. O usuário autorizou preparar a validação local, sem contas pessoais.

## Decisão experimental

O instrumento em apps/web/spikes/us-003 utiliza Node HTTPS para testar a fronteira BFF antes da integração Next.js. Não implementa o aplicativo Web de produto. openid-client 6.8.8 é uma dependência de produção do workspace Web, usada para discovery, PKCE S256, code grant, validação OIDC/JWKS, UserInfo, renovação e revogação; evita implementar OAuth ou criptografia própria. A verificação adicional de assinatura RS256 está habilitada. Playwright 1.64.1 é dependência de desenvolvimento para executar um navegador real, sem mocks do IdP ou do endpoint de tokens.

Keycloak 26.8.0, Mailpit 1.27.4 e Caddy 2.10.2 são ferramentas locais de homologação em Docker, fixadas por digest no Compose. Keycloak é um IdP separado do BFF; senha, verificação de e-mail e recuperação existem exclusivamente nele. Não há tabela de senha nem banco da aplicação neste instrumento. Identidades no BFF usam somente issuer e subject; e-mail não é chave de vinculação.

O realm é gerado com uma identidade sintética sob us003.invalid, senha e client secret aleatórios por execução, PKCE obrigatório nos dois clients e redirects exatos. Grants implícito, password e service account estão desabilitados. Registro público está desabilitado; este recorte não homologa cadastro. O client BFF é confidencial; o client público não possui secret. Google e Apple não são simulados como provedores homologados.

## Fronteiras e ameaças

| Fronteira         | Ameaça                                                  | Controle experimental e limite                                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser/BFF       | Roubo de tokens por JavaScript ou persistência indevida | Tokens apenas em memória no servidor; cookie opaco HttpOnly, Secure, SameSite=Lax, prefixo __Host e Path=/; sem localStorage, IndexedDB ou banco financeiro                                                                 |
| Sessão            | Fixação, CSRF e retenção indefinida                     | Rotação do identificador após autenticação; Origin exato e token CSRF nos POSTs; sessão de 15 minutos; stores limitados a 128 entradas                                                                                      |
| Callback          | Login CSRF, replay e troca de identidade                | State, nonce, PKCE S256, assinatura, issuer/audience/expiração pela biblioteca; pendência ligada à sessão do browser, TTL de 5 minutos, consumo antes do code grant; parâmetros duplicados e callback divergente rejeitados |
| Refresh/logout    | Corrida de rotação ou sessão abandonada                 | Refresh serializado por sessão; identidade permanece issuer/subject; falha de renovação remove sessão; logout remove sessão, revoga refresh e confirma encerramento no IdP                                                  |
| RP logout         | ID token exposto na URL do browser                      | End-session usa client_id e callback fixo, sem id_token_hint; confirmação no IdP quando necessária; state de logout ligado a cookie próprio de uso único                                                                    |
| Provider          | Desvio de discovery para outro destino                  | Issuer e endpoints restritos ao realm local; nenhuma chave de configuração da UI aceita URL arbitrária                                                                                                                      |
| Docker            | Envio real de e-mail ou exposição pública               | Keycloak/Mailpit apenas na rede internal; proxy com upstreams fixos publica somente 127.0.0.1; SMTP não é publicado; nenhum relay externo                                                                                   |
| Segredos de teste | Versionamento ou sobra depois de homologar              | Geração em .tools ignorado; banco e e-mails em tmpfs; teardown remove containers, redes e quatro arquivos próprios de credencial/certificado                                                                                |
| Logs/evidência    | Senhas, tokens, códigos e links de recuperação          | Sem access logs; runner informa etapas fixas; não imprime erros brutos de browser/IdP/biblioteca nem exporta HAR, trace ou estado autenticado                                                                               |

A rede internal do Docker não publicou portas de forma utilizável neste host. Um proxy Caddy com interfaces de entrada e interna fornece o acesso loopback, mantendo IdP e SMTP sem rede de saída. O binário Caddy da imagem possui file capability; NET_BIND_SERVICE é a única capability acrescentada ao proxy para permitir sua execução, além de cap_drop ALL e no-new-privileges. Não há daemon Docker ou pasta pessoal montados nos containers.

O BFF utiliza HTTPS com certificado efêmero local; a exceção de confiança pertence somente ao contexto do navegador de teste, sem alterar o trust store do Windows ou desabilitar validação TLS global. O IdP usa HTTP exclusivamente em loopback como exceção experimental explícita; o helper recusa qualquer outro issuer. Isso não define configuração de produção.

O probe do client público recebe o redirect em um listener HTTP real, vinculado exclusivamente a 127.0.0.1:43182, a partir do navegador de teste, e conclui PKCE em Node. Ele verifica o protocolo sem client secret. Não prova abertura do browser do sistema, deep/app link, vínculo de instalação, SecureStore/Credential Manager para refresh tokens ou lifecycle de Android/iOS/Tauri. Esses itens continuam pendentes. O redirect loopback não substitui silenciosamente o requisito de deep/app link do produto.

A homologação em Chromium encontrou uma interação entre Referrer-Policy no-referrer e formulários: o POST chegou com Origin null e foi corretamente rejeitado por CSRF. As páginas do BFF usam same-origin para preservar a origem do POST sem enviar referências ao IdP; o callback usa no-referrer. O teste de navegador cobre o formulário real, além das rejeições de Origin e CSRF indevidos.

## Consequências e validação

As sessões são voláteis e desaparecem ao reiniciar o BFF; não há cache distribuído, autorização por workspace, acesso offline, API financeira, integração Next.js ou implantação. O provider gerenciado SaaS, custos e conectores Google/Apple permanecem escolhas abertas. DP-01 a DP-03 não são alteradas.

O [protocolo US-003](../../development/spikes/us-003-oidc.md) separa os resultados locais das pendências. Nenhum teste local encerra a história inteira ou substitui a homologação iOS da US-002.

Homologação local aprovada em 2026-10-15, com [evidência sanitizada](../../quality/evidence/us-003-local-2026-10-15.json): 15 verificações de ambiente/protocolo em Chromium 156.0.8078.4, incluindo e-mail verificado, recuperação com rejeição da senha anterior, BFF/CSRF/refresh/logout, PKCE público, falhas negativas, rotação/revogação, vínculo/expiração/replay de callback e expiração da sessão. Teardown comprovou ausência dos containers próprios e dos quatro arquivos efêmeros. Node 24.19.0; pnpm check aprovado com 31 testes.

Fontes consultadas em 2026-10-15: [OIDC com openid-client](https://github.com/panva/openid-client/blob/main/examples/oidc.ts), [verificação de assinaturas](https://github.com/panva/openid-client/blob/main/docs/functions/enableNonRepudiationChecks.md), [Keycloak Docker](https://www.keycloak.org/getting-started/getting-started-docker), [importação de realms](https://www.keycloak.org/server/importExport), [Mailpit Docker](https://mailpit.axllent.org/docs/install/docker/) e [logging do Caddy](https://caddyserver.com/docs/caddyfile/options#log).
