# US-014 — Fundação dos ambientes reproduzíveis

Local, CI, integration e staging usam o mesmo modelo Docker local, instâncias isoladas e somente dados sintéticos. O usuário escolheu esse destino para staging. [ADR-0027](../architecture/adr/0027-ambientes-docker-reproduziveis.md). A entrega configura dependências de desenvolvimento; não é a aplicação financeira ou a topologia SaaS completa.

## Preparação e comandos

Use Node 24.19.0, pnpm 11.25.0 e Docker com engine Linux/contexto local unix/npipe. No Windows, os testes foram executados com Docker Desktop. Não mudar para engine Windows para esses serviços. O Desktop SQLCipher mantém ferramentas e protocolo próprios.

```sh
pnpm install --frozen-lockfile
pnpm env:check
pnpm env:stack:check
pnpm env:stack:up --profile local
pnpm env:stack:verify --profile local
pnpm env:stack:down --profile local
pnpm env:stack:test
pnpm check
```

up/verify/down exigem perfil explícito. up reutiliza uma instância saudável, sem recriar seus segredos. verify confere recursos, TLS, OIDC, e-mail, banco e roles reais. down remove somente recursos e arquivos pertencentes àquela instância. test exige os quatro perfis livres, provoca falha de startup, valida isolamento/recriação e limpa todos os recursos que criou. Um ambiente já usado pelo desenvolvedor não é tomado pelo teste.

env:stack:check valida o manifesto/modelo sem Docker, segredos ou contêineres; integra pnpm lint. pnpm check testa configuração/segurança do runner e metadados da evidência, mas não inicia serviços. env:stack:test é o protocolo de infraestrutura real, também configurado em job CI Docker Linux separado. CI remota deste incremento permanece pendente.

## Endereços e configuração

| Perfil      | Identidade HTTPS | Mailpit HTTPS   | PostgreSQL loopback |
| ----------- | ---------------- | --------------- | ------------------- |
| local       | 127.0.0.1:44320  | 127.0.0.1:44321 | 127.0.0.1:44322     |
| ci          | 127.0.0.1:44330  | 127.0.0.1:44331 | 127.0.0.1:44332     |
| integration | 127.0.0.1:44340  | 127.0.0.1:44341 | 127.0.0.1:44342     |
| staging     | 127.0.0.1:44350  | 127.0.0.1:44351 | 127.0.0.1:44352     |

O issuer é https://127.0.0.1:PORTA/realms/fm-PERFIL. Há discovery/JWKS e cliente público PKCE com callback sintético exato, sem contas importadas. Isso não substitui o protocolo de login US-003 ou configura o IdP de produção.

profiles.json fixa versões/digests, política sintética e portas. O modelo gera Compose JSON em .tools/environments/PERFIL, junto ao estado de dono, realm e segredos. Não carregue .env automaticamente nem injete overrides Compose. DOCKER_HOST, DOCKER_CONTEXT e DOCKER_CONFIG definidos são recusados: selecione um contexto local com docker context use antes de executar. Não imprimir Compose/estado/arquivos privados em logs ou copiar senhas para o Git.

PostgreSQL usa banco fm_app e usuário fm_runtime; a senha está no arquivo runtime-password do perfil, lido pelo futuro adaptador de servidor. fm_bootstrap é exclusivo da inicialização. fm_identity tem banco separado. O schema environment_probe é só um marcador técnico, sem tabelas financeiras. Aplicações não recebem credencial de bootstrap para contornar permissões.

A confiança TLS é explícita por perfil: o runner lê ca.pem em sua pasta privada e mantém rejectUnauthorized habilitado. Não instala CA no sistema operacional. Um navegador sem essa confiança não é homologado por estes testes; evite desabilitar validação global de TLS. CA/segredos mudam após down + up.

## Isolamento, descarte e recuperação

Cada instância tem projeto/rede/dono próprios. Somente HTTPS e PostgreSQL são publicados em loopback. Identidade/e-mail ficam na rede internal; PostgreSQL tem bridge de entrada distinta da bridge HTTPS. As bridges de entrada não são um controle geral de egress. Conexões internas e PostgreSQL são locais sem TLS, exclusivamente para fixtures; não representam configuração cloud aprovada.

Dados ficam em tmpfs e são descartáveis, inclusive ao parar/recriar serviços. Não usar dumps, documentos, contas ou backups reais. Não usar a stack para guardar progresso financeiro. Nenhum signing secret, credencial de nuvem/loja ou dado de produção é solicitado. O Desktop exclusivamente local pode trabalhar sem esta stack.

Em falha de subida, execute down no mesmo perfil antes de tentar novamente. A limpeza valida o dono e preserva estado/segredos se o Docker não confirmar a remoção. Não usa prune ou exclusão recursiva. Lock de processo encerrado pode ser recuperado; processo ativo causa ENVIRONMENT_PROFILE_BUSY. Estado corrompido, arquivos desconhecidos ou junction/symlink causam recusa. Não remova diretórios arbitrários para resolver isso: revise somente os artefatos da instância conhecida. Limpe uma instância antes de editar seu modelo/configuração.

O protocolo inclui porta ocupada, subida repetida, recriação com novos segredos, senha de outro perfil recusada, CA de outro perfil recusada e descarte dos recursos criados. Não simula todas as formas de queda de energia ou indisponibilidade do daemon. Timeout de ferramenta conserva os metadados necessários; confirme que o processo anterior terminou antes de recuperar.

## Evidência e próximos gates

[Evidência sanitizada](../quality/evidence/us-014-environments-2026-10-16.json): quatro perfis, 12 gates por perfil e sete transversais, imagens/versões e hashes de fontes. O relatório local fica em .tools/environments-reports/latest.json, sem payloads/segredos. O validador rejeita campos adicionais, escopo remoto, falta de limpeza ou fontes divergentes.

A fundação prepara o restante da US-014 e as histórias de integração. Web/Next.js, BFF, API/NestJS, worker e armazenamento de objetos ainda precisam ser integrados à topologia; staging remoto e promoção de produção permanecem fora deste corte. Não houve deploy ou alteração dos prazos/papéis pendentes. CI, serviços nativos, cofres e invariantes financeiros dual-engine mantêm seus gates específicos.
