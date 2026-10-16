# ADR-0027 — Ambientes sintéticos reproduzíveis em Docker

- Data: 2026-10-16
- Status: Adotado para a fundação da US-014 em Docker local; topologia de produto pendente
- Histórias: US-014; prepara integração/persistência e CI
- Substitui: nenhum; preserva os ambientes de spikes e os gates físicos

## Contexto e alternativas

A [US-014](../../delivery/05-backlog.md) pede ambientes local/CI/integration/staging reproduzíveis, sem dados reais fora do beta autorizado. O usuário escolheu explicitamente validar staging em Docker isolado nesta máquina. Os instrumentos W0 já possuem imagens homologadas, mas seus runners não configuram uma fundação comum. Web/BFF, API NestJS, worker e objetos de produto ainda não estão integrados.

Compartilhar banco, credenciais ou rede entre perfis facilita contaminação e torna limpeza arriscada. Copiar quatro arquivos Compose cria divergências. Foi escolhido um manifesto fechado e um único modelo gerador, com instâncias separadas por perfil/dono. Staging remoto ou AWS exigiria infraestrutura e concessões que não fazem parte da escolha atual; não é provisionado por este incremento.

## Decisão

infra/environments/profiles.json define somente local, ci, integration e staging, dados sintéticos e implantação docker-local. Portas são inteiras, distintas e publicadas em 127.0.0.1. O modelo gera Compose JSON privado por instância; versões e digests reutilizam PostgreSQL 18.6, Keycloak 26.8.0, Mailpit 1.27.4 e Caddy 2.10.2 dos spikes. Não se alteram as stacks US-003/004/005.

Cada perfil tem PostgreSQL, identidade, caixa de e-mail sintética e entrada HTTPS. Keycloak usa start com PostgreSQL, sem start-dev, sem usuário importado, password grant, client secret ou wildcard. O único cliente de teste é público/PKCE com callback exato, destinado à configuração futura; não entrega login de produto. Mailpit não configura relay externo. Esse provider local não escolhe o fornecedor SaaS.

A rede interna isola Keycloak/Mailpit do exterior e das demais instâncias. Caddy tem uma bridge de entrada; PostgreSQL tem outra bridge, exclusiva da entrada de banco. A segunda é necessária para o acesso de ferramentas no host via Docker Desktop. O banco escuta em porta publicada apenas no loopback, com credencial própria/SCRAM. Bridges de entrada não prometem bloquear egress; identidade/e-mail permanecem somente na rede internal. Ligações internas e a conexão PostgreSQL local não usam TLS: exceção restrita à máquina e fixtures, sem equivalência com trânsito cloud/produção.

Caddy fornece TLS com CA efêmera própria por perfil e default_sni para clientes IP sem SNI. O Node usa somente o certificado desse perfil, com validação habilitada; não muda confiança do Windows/Linux nem desabilita TLS globalmente. Uma CA errada é recusada. O binário Caddy requer NET_BIND_SERVICE no conjunto permitido, mesmo usando portas altas, por suas file capabilities. Os serviços removem as demais capabilities e usam no-new-privileges. PostgreSQL/Caddy usam UIDs explícitos e filesystem somente leitura; a identidade permite a otimização do runtime em sua camada descartável.

Dados de PostgreSQL, identidade, e-mail e CA ficam em tmpfs; não há volume de dados persistente. Parar/recriar pode apagar todo dado sintético. Não é um cofre SQLCipher, banco de produto, serviço de backup ou retenção. O modo Desktop LOCAL continua independente desta stack e de login cloud.

## Credenciais, estado e ciclo de vida

Senhas aleatórias de bootstrap, identidade e runtime são distintas por perfil e geração. São arquivos sob .tools/environments, ignorados pelo Git; o diretório é privado por chmod no Linux e ACL no Windows. Arquivos específicos são montados somente leitura para os UIDs de contêiner, sem senha no Compose, argv ou Config.Env. Keycloak lê a senha para seu processo interno; o administrador Docker continua dentro da fronteira de confiança. A CA privada permanece no contêiner, não no host.

O bootstrap SQL 0001-foundation.sql cria apenas roles, banco da identidade e uma tabela de marcador/versionamento da infraestrutura. Não cria schema financeiro. fm_runtime não é owner, superuser, criador de banco/roles nem BYPASSRLS; pode ler o marcador e não pode alterá-lo. fm_identity não pode conectar ao banco da aplicação. Migrations/roles de produto continuam nas histórias de persistência.

O runner aceita somente contexto Docker local unix/npipe com engine Linux. Recusa overrides DOCKER_HOST/CONTEXT/CONFIG e não herda variáveis Compose, cloud ou PostgreSQL. Usa arquivo de ambiente vazio e projeto explícito, evitando .env ambiente. Interpolação de dólar nos caminhos é escapada. Named volumes, mounts de Docker socket e serviços privilegiados não são usados.

Estado registra dono UUID antes de preparar segredos. Locks por perfil impedem operações concorrentes, e locks de processos encerrados podem ser recuperados sem matar processos. Subida repetida preserva uma instância existente; o teste exclusivo recusa tomá-la. Limpeza verifica labels de dono/perfil, modelo/checksum, diretórios sem junction/symlink e ausência de arquivos desconhecidos. Remove apenas arquivos conhecidos e diretório vazio, sem exclusão recursiva. Se a remoção Docker falhar, conserva estado/credenciais para recuperação. Metadados ilegíveis ou ausência de prova de dono fazem a operação falhar; não se afirma recuperação de qualquer corte de energia.

pg 8.23.1 foi acrescentado apenas como ferramenta de desenvolvimento na raiz, reutilizando a versão da API para diagnóstico real de conexão/roles. Não há nova dependência externa de produção. Erros operacionais usam códigos; saídas brutas de ferramentas/driver não são repassadas. Logs dos serviços são limitados e conferidos contra as senhas sintéticas.

## Validação e limites

O [protocolo](../../development/environments.md) testa os quatro perfis reais, credenciais/CA cruzadas, repetição, recriação, falha de startup por porta ocupada e teardown. A [evidência sanitizada](../../quality/evidence/us-014-environments-2026-10-16.json) registra imagens, versões, hashes de fonte e gates, sem senhas, URLs com credenciais ou conteúdo financeiro. Unitários cobrem seleção, configuração, caminhos, interferência ambiental, locks e integridade da evidência. A CI tem job Docker Linux próprio; quality não exige Docker.

Essa entrega configura a fundação de dependências. Não entrega Web/BFF/API/worker/S3 de produto, staging remoto, deploy, assinatura, dados reais ou aprovação de produção. O staging local autorizado não é declarado equivalente à topologia SaaS completa. DP-01 a DP-04 e G07 não foram resolvidos.

Fontes primárias: [modelo/projetos Compose](https://docs.docker.com/compose/intro/compose-application-model/), [precedência ambiental](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/), [serviços e redes](https://docs.docker.com/reference/compose-file/services/), [containers Keycloak](https://www.keycloak.org/server/containers) e [opções TLS Caddy](https://caddyserver.com/docs/caddyfile/options), consultadas em 2026-10-16.
