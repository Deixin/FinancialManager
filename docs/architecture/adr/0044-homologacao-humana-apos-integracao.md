# ADR-0044 — Homologação humana após a integração completa

Status: adotado por instrução explícita do usuário em 2026-10-17.

## Decisão

O usuário autorizou continuar o desenvolvimento sem aguardar confirmações de homologação humana e determinou que elas serão realizadas após a integração de todo o sistema. Essa instrução substitui a necessidade de obter agora a confirmação interativa que ficou pendente na US-033/Windows Hello e orienta as próximas histórias.

Continuar implementação, testes automatizados, documentação e os commits/push já autorizados para dev. Não solicitar aprovação humana por incremento para essas homologações. A decisão não concede autorização para deploy, assinatura com credenciais de produção, serviços externos ou mudanças de requisitos conflitantes.

## Registro e gates

Separar desenvolvimento/validação automatizada de homologação humana. Registrar cada teste humano como **diferido para pós-integração**, sem marcar executado/aprovado, remover a rastreabilidade ou transformar mocks/disponibilidade em autenticação física. Continuam obrigatórios pnpm check, testes nativos pertinentes, controles de segurança e evidências das verificações que forem executadas.

US-033: caminho PIN e automação validados; adapter Hello implementado e disponibilidade consultada. Consentimento, cancelamento, desbloqueio e alternativa PIN com revisão humana permanecem diferidos. Não há confirmação de execução/aprovação pelo usuário. Essa pendência não bloqueia iniciar US-034 e demais trabalhos de integração.

US-034: o diálogo nativo de destino terá sua interação humana revista nessa mesma fase. A automação usa destino sintético somente no binário de teste, mantendo o adapter real de produto e a distinção nas evidências. Restauração de produto continua em US-035.

Antes de declarar homologação integral/MVP, consolidar o roteiro do sistema integrado, atualizar os pacotes contra o código final e executar/registrar os cenários humanos pendentes. Não há data inventada ou aprovação antecipada de release. Evidências históricas preservam seus hashes e as pendências registradas no momento.

DP-01 a DP-04, os sete documentos originais e os requisitos de produto permanecem preservados. Esta decisão altera a sequência da homologação humana, sem declarar funcionalidade não implementada como concluída.
