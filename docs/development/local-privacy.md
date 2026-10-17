# Bloqueio local opcional — US-033

Atualização de sequência: o usuário determinou que homologações humanas serão realizadas após integrar todo o sistema. O [ADR-0044](../architecture/adr/0044-homologacao-humana-apos-integracao.md) autoriza continuar sem essas confirmações por história; os cenários interativos abaixo permanecem diferidos, sem aprovação registrada. US-034/035 acrescentam criação/restauração de backup, totalizando 15 comandos; evidência de privacidade v4 distingue o conjunto atual dos formatos históricos v1/v2/v3. [Backup de produto](local-backup.md).

No Desktop Windows, Privacidade local permite ativar, alterar ou desativar um PIN de 6 a 12 dígitos para os espaços locais desta instalação. O padrão permanece desativado. PIN não é conta cloud, PIN do Windows, chave SQLCipher ou senha do backup. A tela explica a política antes de ativar, inclusive a ausência de redefinição do PIN nesta versão. [ADR-0042](../architecture/adr/0042-bloqueio-local-por-pin.md).

## Política e fluxo

Com PIN ativo, o aplicativo bloqueia ao reiniciar o processo, voltar à entrada, perder o foco da janela ou acionar Bloquear agora. A tela bloqueada não exibe nomes de espaços ou conteúdo financeiro. Desbloquear volta à lista; alterar/desativar exige o PIN atual mesmo numa sessão já aberta. A proteção vale para a instalação inteira, sem alterar a fronteira de autorização/cobrança dos workspaces.

Toda reentrada/retentativa solicita bloqueio no core antes de mostrar espaços, inclusive quando o pedido de saída anterior não chegou ao host. O instrumento simula essa perda de pedido; a reentrada ainda exige PIN.

Após cinco erros há espera de 30 segundos, persistida no Windows secret store. Reiniciar não zera contagem/espera. O contador na UI é apenas apresentação; o Rust decide se uma tentativa pode ocorrer. Relógio regredindo mantém a recusa até a hora válida, sem alterar dados. PIN incorreto não apaga ou recria o cofre. Não há redefinição por e-mail, identidade anônima ou exclusão do banco. Backup de produto está disponível na US-034; restauração está disponível na US-035. PIN não recupera esses pacotes.

Windows Hello agora é alternativa opcional ao desbloqueio por PIN do aplicativo. Consulta-se a disponibilidade real do perfil e da interface desktop; o host retornou Available. Esse resultado pode representar rosto, digital ou PIN do Windows, sem comprovar sensor ou autenticação biométrica. Ativar exige PIN atual mais confirmação nativa do Windows. Desativar exige PIN atual e funciona mesmo com Hello indisponível; ambas as ações deixam o aplicativo bloqueado. Alterar/desativar PIN revoga Hello. Há alternativa pelo PIN do aplicativo, sem redefinição por Hello. [ADR-0043](../architecture/adr/0043-windows-hello-local.md). A homologação interativa continua pendente.

## Liberação de chaves no Rust

LocalState serializa o acesso e consulta LocalLock antes de criar/listar/abrir espaços. Bloqueado, falha antes de consultar/gravar chaves financeiras. Cada operação continua fechando sua conexão SQLCipher e descartando o material de chave; a sessão guarda somente o estado da proteção. Nenhuma chave é rederivada do PIN ou rotacionada ao mudar a política.

O evento nativo Focused(false) marca bloqueio atomicamente, sem esperar um KDF ou uma operação de IO terminar. A próxima entrada e a saída de operações sensíveis conferem o estado. Uma operação já iniciada pode concluir sua transação atômica, mas sua resposta é descartada se o bloqueio ocorrer durante ela. A UI remove imediatamente a árvore financeira, limpa campos e invalida respostas antigas por geração, inclusive desbloqueio atrasado. Seu sinal blur complementa o evento nativo; autorização não depende de esconder componentes.

O contrato de produto possui 15 comandos estreitos: os três de workspaces, local_lock_status, lock_local_session, unlock_local_session, configure_local_pin, disable_local_pin, configure_local_hello, unlock_local_hello, create_local_backup, select_local_backup, preview_local_restore, confirm_local_restore e cancel_local_restore. Não há SQL, filesystem, reset de PIN, chave, hash ou resultado biométrico genérico em IPC. Inputs PIN negam campos extras; respostas de privacidade contêm somente enabled, locked, retry_after_seconds, hello_enabled e hello_availability. A gateway valida forma e resultado esperado, sanitiza erros e não usa storage WebView.

Hello usa UserConsentVerifier.CheckAvailabilityAsync e IUserConsentVerifierInterop.RequestVerificationForWindowAsync com HWND obtido pelo Tauri, em worker WinRT MTA. Apenas Verified pode liberar, depois de conferir opt-in, geração e foco da janela. A UI remove dados antes do diálogo; a sessão permanece fechada e sem chave/conexão retidas durante a espera. O blur causado pelo diálogo não invalida sua própria confirmação: o evento nativo continua fechando a sessão, e a conclusão requer retorno ao primeiro plano. Bloqueio explícito, saída ou nova autenticação/política invalidam respostas pendentes. Cancelar verificação invalida o pedido; um diálogo já iniciado pode continuar até ser fechado no Windows. No máximo um pedido Hello fica em andamento. Falha, cancelamento ou indisponibilidade preservam cofre fechado, com PIN como alternativa.

## Persistência da política

Argon2id v19 usa 64 MiB, três passes, paralelismo 1, salt aleatório de 16 bytes e verificador de 32 bytes. ctutils compara o verificador sem curto-circuito. Argon2 0.6.0 reutiliza o pin já provado no spike; ctutils 0.4.3 é dependência direta necessária para a comparação. Não há criptografia caseira ou serviço externo novo. PINs recebidos e buffers nativos derivados usam descarte com zeroize; isso não promete apagar todas as cópias transitórias do framework/JavaScript.

Verificador, salt, contagem e espera ficam no Windows Credential Manager em com.miudos.financial-manager.desktop.privacy.v1, por ID de instalação. A credencial não contém chave SQLCipher nem PIN em texto e é lida novamente para verificar escrita. Falha ambígua fecha a sessão; uma nova verificação pode recarregar somente a política, mantendo PIN ativo bloqueado. Formato/instalação/campos inválidos são recusados. Ativar Hello migra o registro v1 para v2 com booleano explícito, preservando salt/verificador/instalação; v1 continua com Hello desativado, e versões desconhecidas são recusadas. Binário antigo recusa v2. A migração da política não altera schema, chaves ou ciphertext financeiros.

O marcador não secreto .local-privacy-v1 torna a ausência posterior da credencial uma falha fechada. Na primeira ativação, persiste-se política desativada recuperável, publica-se o marcador por arquivo temporário/rename, depois grava-se e verifica-se a política PIN. Só então a ativação é confirmada. Interrupção antes da gravação PIN preserva a política anterior; após a gravação, a reabertura exige PIN. Fragmento temporário de marcador conhecido pode ser recuperado. Desativar guarda política desativada explícita, conservando o marcador; perda de credencial não vira desativação silenciosa.

Esta é uma camada de privacidade dentro do aplicativo. SQLCipher e proteção do perfil Windows continuam protegendo a chave aleatória. Não resiste a código arbitrário/admin operando como o mesmo usuário Windows comprometido, nem fornece um novo segredo de recuperação. Backup já passa pela mesma barreira de sessão; futuras operações financeiras e exportações também deverão usá-la.

## Reprodução e evidências

```sh
pnpm install --frozen-lockfile
pnpm desktop:lock:check
pnpm desktop:lock:native
pnpm desktop:workspaces:check
pnpm desktop:workspaces:native
pnpm desktop:vault:check
pnpm check
```

Pré-requisitos nativos seguem o [cofre](desktop-vault.md): Windows x64, Rust 1.99.0, MSVC/SDK e Perl para OpenSSL. A prévia em navegador não configura PIN nem simula persistência de produto. A feature lock-smoke habilita os instrumentos e dynamic ACL; lock-probe/lock-smoke/hello-manual não entram no binário padrão. Seus únicos dados são fixtures sintéticas. A CI Windows inclui ambos os protocolos; execução remota não foi observada. windows 0.62.2 e windows-future 0.3.2, já transitivos no lock, tornam-se dependências diretas para projeções oficiais WinRT/interop e o tipo da operação assíncrona.

Os [11 gates Chromium](../quality/evidence/us-033-lock-browser-2026-10-17-us035.json) cobrem padrão opcional/política, ativação/troca/desativação, limpeza dos campos, retorno/reentrada, cinco erros/contador, resposta atrasada após blur, axe, texto 200%/reflow/cores forçadas e ausência de storage/egress/erros. Hello acrescenta opt-in, política de PIN Windows, prompt/blur, cancelamento/falha, indisponibilidade, alternativa PIN, desativação e resposta atrasada após cancelamento explícito. Bridge/relógio controlados são exclusivos do instrumento; não comprovam autenticação Windows ou biométrica.

Os [17 gates Windows](../quality/evidence/us-033-lock-windows-2026-10-17-us035.json) executam 17 testes Rust, Clippy/build locked, consulta nativa real de disponibilidade sem diálogo, Credential Manager entre processos, comandos bloqueados, PIN incorreto, reinício, troca/desativação, duas interrupções durante configuração e seis checkpoints PIN na WebView2 real. São comparados ciphertext byte a byte e o digest de todas as colunas das 12 tabelas do FIN-002 A. Os sete testes Hello usam doubles no port Rust para migração v1/v2, falhas de escrita/consentimento, espera, foco, revogação e resposta após bloqueio/mudança de política; nenhuma prova aceita vem do renderer. Não há rekey ou alteração financeira. Testes concorrentes comprovam que perder foco/bloquear descarta resposta e impede novas leituras de chave. Falhas/missing/record adulterado do store são injetados em doubles, sem alterar o secret store do usuário.

Os instrumentos usam raízes novas marcadas em .tools/us033-lock. Removem e verificam ausência da credencial de política e das chaves financeiras antes de excluir arquivos/perfis próprios. Relatórios fechados guardam apenas gates, versões/disponibilidade, pendências, data e hashes, sem PIN/verificador, IDs de credencial, snapshots, paths privados ou dados financeiros. Cinco testes Node verificam contratos/erros e evidência. Relatórios US-033 v1 preservam hashes e o escopo PIN de oito permissões; v2 preserva dez permissões, testes Hello e o gate interativo explícito pendente; v3 preserva 11 permissões; v4 exige 15 e mantém homologações humanas diferidas para após integração. Workspaces formato 2 já usa conjunto estreito atual; formato 1 preserva as três permissões históricas.

## Pacote para validação humana

Depois do build Desktop, execute `node infra/local-lock/hello-package.mjs`. O pacote em .tools/us033-lock/hello-package contém LEIA-ME.txt, executar.ps1, dois binários opcionais e manifesto de hashes. Não abre diálogo automaticamente durante a preparação. Rode executar.ps1 e siga o roteiro: desbloqueio com PIN sintético, ativação Hello com PIN atual e confirmação do Windows, cancelamento nativo, confirmação para desbloquear, bloqueio e alternativa PIN. Não compartilhe PIN Windows, rosto ou digital com o agente e não altere opções de entrada do Windows para o teste.

O executor cria instalação/cofre/perfil próprios e limpa credenciais e arquivos ao fechar. Se for encerrado à força, o roteiro inclui CleanupOnly para a raiz marcada. O JSON registra apenas contagens de respostas nativas e preservação do ciphertext/FIN-002. Resultado requer revisão humana do fluxo visual; contagem de Verified sozinha não declara desbloqueio ou biometria física homologados. Não se declara sensor específico, mecanismo usado ou autenticação exclusiva por biometria.

Aceite do caminho PIN atendido em Windows x64. Adapter Hello implementado e disponibilidade avaliada; homologação interativa permanece diferida para após a integração completa, conforme ADR-0044. Outras plataformas, distribuição assinada, integração financeira ampliada, outbox/sync e G07-VAULT global mantêm seus gates. US-034 integra a criação do backup .fmbackup autenticado e versionado; US-035 integra restauração como novo workspace; próxima história é US-036. Sete originais e DP-01 a DP-04 preservados.
