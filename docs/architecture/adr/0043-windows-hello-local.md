# ADR-0043 — Windows Hello como alternativa de desbloqueio local

Status: adapter implementado; disponibilidade real consultada, testes de fronteira automatizados; autenticação interativa pelo usuário pendente.

Data: 2026-10-17. História: US-033. Complementa e substitui somente a indisponibilidade fixa de biometria e o conjunto de oito comandos do [ADR-0042](0042-bloqueio-local-por-pin.md). [Protocolo](../../development/local-privacy.md).

## Contexto e contrato Windows

O backlog exige PIN/biometria quando suportado. A versão anterior entregava PIN e informava biometria indisponível sem consultar o sistema. Isso não constitui avaliação do suporte do equipamento. A API real deste host retornou Available; isso pode representar PIN do Windows, rosto ou digital, sem identificar qual mecanismo existe ou foi usado.

Usar UserConsentVerifier.CheckAvailabilityAsync para disponibilidade e a interface desktop IUserConsentVerifierInterop.RequestVerificationForWindowAsync com HWND da janela invocadora. A [documentação da classe](https://learn.microsoft.com/en-us/uwp/api/windows.security.credentials.ui.userconsentverifier) exige interop no desktop; a [API Win32](https://learn.microsoft.com/en-us/windows/win32/api/userconsentverifierinterop/nf-userconsentverifierinterop-iuserconsentverifierinterop-requestverificationforwindowasync) admite PIN, Hello e leitor de digital. Somente Verified concede a prova nativa. A interface informa Windows Hello (rosto, digital ou PIN do Windows), sem prometer biometria exclusiva.

Adicionar windows 0.62.2 e windows-future 0.3.2 como dependências diretas Windows, já presentes no lock transitivo: projeções oficiais, interop e tipo IAsyncOperation. Não introduzir serviço externo, SDK de biometria, armazenamento de imagem/template ou captura do PIN Windows. O worker inicializa/balanceia WinRT MTA, verifica suporte à própria interface desktop e traduz resultados para códigos fechados.

## Política e migração

Hello é desativado por padrão e exige PIN do aplicativo previamente configurado. Ativar exige PIN atual mais consentimento real do Windows; desativar exige PIN atual e permanece possível quando Hello está indisponível. Ambos deixam a sessão bloqueada. PIN continua alternativa e é sempre exigido para alterar/desativar a política PIN; Hello não o redefine. Alterar/desativar PIN revoga também o opt-in Hello. Espera após cinco erros vale para ambos os caminhos; o Windows controla suas próprias tentativas nativas.

Após confirmação de ativação, migrar somente o registro da credencial de privacidade v1 para v2, acrescentando hello booleano. Salt/verificador e ID da instalação são preservados. Registros v1 continuam válidos com Hello desativado; v2 exige campo explícito e PIN quando hello=true. Versão desconhecida/formato inconsistente falham fechados. A versão antiga do aplicativo recusa v2, sem desativar a proteção. Escrita/readback ambíguos mantêm bloqueio e a recarga não abre a sessão. Namespace/marcador existentes continuam; não há migration ou rekey do cofre financeiro.

## Ameaças e liberação

Renderer não pode enviar resultado de verificação, janela, chave ou token. Dois comandos estreitos (configure_local_hello, unlock_local_hello) recebem somente PIN do aplicativo/opt-in quando necessário; o HWND vem do host. Nenhuma permissão genérica foi adicionada. Core só libera depois da resposta nativa, opt-in válido, geração atual e foco retornado à janela.

Consentimento tem no máximo uma operação em andamento e ocorre sem mutex de instalação, conexão SQLCipher ou chave financeira retidos. Bloqueio explícito, saída, outra autenticação PIN ou mudança de política invalidam a geração. Cancelamento, indisponibilidade, falha e resposta velha preservam bloqueio e ciphertext. Pedido já iniciado no Windows pode continuar até o usuário fechar o diálogo, mas uma resposta invalidada não abre a sessão.

O diálogo nativo também retira o foco. Antes de solicitá-lo, Rust fecha a sessão e React remove dados/campos. Durante ele, blur não solicita outro bloqueio explícito que invalidaria a própria confirmação. O evento nativo continua marcando a sessão fechada; nenhuma chave pode ser lida durante a espera. A conclusão exige foco novamente, geração válida e confirmação do Windows. Fora desse intervalo, perda de foco bloqueia como antes. Foco perdido ao entregar a resposta não concede acesso financeiro.

O perfil Windows/secret store continua fronteira confiável; consentimento não sela criptograficamente as chaves a hardware nem protege contra código arbitrário/admin no mesmo perfil comprometido. Não alegar detecção de sensor, autenticação exclusivamente biométrica, resistência a mudança administrativa de credenciais ou recuperação de backup.

## Verificação e pendências

Sete testes Rust adicionais verificam opt-in/PIN, migração v1/v2 e falhas antes/depois da escrita, resultados negativos, foco, espera, revogação e corrida com bloqueio/mudança de política. Doubles estão só nos testes Rust. Chromium usa bridge sintética exclusiva do instrumento; não homologa biometria. Protocolo Windows consulta disponibilidade real sem solicitar identidade; WebView2 continua cobrindo o PIN de produto.

Pacote humano sintético separado usa o adapter real, cofres e credenciais temporários e registra apenas contagens de respostas nativas e preservação do estado. Não foi executada uma autenticação em nome do usuário. O gate interativo permanece pendente até observar consentimento, cancelamento, desbloqueio e alternativa PIN com revisão humana. Relatórios v1 preservam o escopo PIN histórico; v2 distingue Hello implementado de homologação física pendente.

US-033 não é declarada integralmente homologada com base em disponibilidade ou mocks. US-034 é o próximo trabalho independente de produto. Outras plataformas, distribuição, backup/restore, G07-VAULT global e DP-01 a DP-04 permanecem nos próprios gates; sete documentos originais preservados.
