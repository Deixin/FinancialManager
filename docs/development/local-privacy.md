# Bloqueio local opcional — US-033

No Desktop Windows, Privacidade local permite ativar, alterar ou desativar um PIN de 6 a 12 dígitos para os espaços locais desta instalação. O padrão permanece desativado. PIN não é conta cloud, PIN do Windows, chave SQLCipher ou senha do backup. A tela explica a política antes de ativar, inclusive a ausência de redefinição do PIN nesta versão. [ADR-0042](../architecture/adr/0042-bloqueio-local-por-pin.md).

## Política e fluxo

Com PIN ativo, o aplicativo bloqueia ao reiniciar o processo, voltar à entrada, perder o foco da janela ou acionar Bloquear agora. A tela bloqueada não exibe nomes de espaços ou conteúdo financeiro. Desbloquear volta à lista; alterar/desativar exige o PIN atual mesmo numa sessão já aberta. A proteção vale para a instalação inteira, sem alterar a fronteira de autorização/cobrança dos workspaces.

Toda reentrada/retentativa solicita bloqueio no core antes de mostrar espaços, inclusive quando o pedido de saída anterior não chegou ao host. O instrumento simula essa perda de pedido; a reentrada ainda exige PIN.

Após cinco erros há espera de 30 segundos, persistida no Windows secret store. Reiniciar não zera contagem/espera. O contador na UI é apenas apresentação; o Rust decide se uma tentativa pode ocorrer. Relógio regredindo mantém a recusa até a hora válida, sem alterar dados. PIN incorreto não apaga ou recria o cofre. Não há redefinição por e-mail, identidade anônima ou exclusão do banco. Backup/restore de produto ainda seguirá em US-034/035; PIN não recupera esses pacotes.

Biometria está explicitamente indisponível nesta versão. Não se declara detecção de hardware, autenticação Windows Hello ou biométrica homologada. Esse adapter exige implementação/validação nativa próprias; o caminho entregue e validado aqui é PIN do aplicativo em Windows x64.

## Liberação de chaves no Rust

LocalState serializa o acesso e consulta LocalLock antes de criar/listar/abrir espaços. Bloqueado, falha antes de consultar/gravar chaves financeiras. Cada operação continua fechando sua conexão SQLCipher e descartando o material de chave; a sessão guarda somente o estado da proteção. Nenhuma chave é rederivada do PIN ou rotacionada ao mudar a política.

O evento nativo Focused(false) marca bloqueio atomicamente, sem esperar um KDF ou uma operação de IO terminar. A próxima entrada e a saída de operações sensíveis conferem o estado. Uma operação já iniciada pode concluir sua transação atômica, mas sua resposta é descartada se o bloqueio ocorrer durante ela. A UI remove imediatamente a árvore financeira, limpa campos e invalida respostas antigas por geração, inclusive desbloqueio atrasado. Seu sinal blur complementa o evento nativo; autorização não depende de esconder componentes.

O contrato de produto passa de três para oito comandos estreitos: os três de workspaces e local_lock_status, lock_local_session, unlock_local_session, configure_local_pin e disable_local_pin. Não há SQL, filesystem, reset de PIN, chave ou hash genérico em IPC. Inputs negam campos extras; respostas contêm somente enabled, locked, retry_after_seconds e biometrics=UNAVAILABLE. A gateway valida forma e resultado esperado, sanitiza erros e não usa storage WebView.

## Persistência da política

Argon2id v19 usa 64 MiB, três passes, paralelismo 1, salt aleatório de 16 bytes e verificador de 32 bytes. ctutils compara o verificador sem curto-circuito. Argon2 0.6.0 reutiliza o pin já provado no spike; ctutils 0.4.3 é dependência direta necessária para a comparação. Não há criptografia caseira ou serviço externo novo. PINs recebidos e buffers nativos derivados usam descarte com zeroize; isso não promete apagar todas as cópias transitórias do framework/JavaScript.

Verificador, salt, contagem e espera ficam no Windows Credential Manager em com.miudos.financial-manager.desktop.privacy.v1, por ID de instalação. A credencial não contém chave SQLCipher nem PIN em texto e é lida novamente para verificar escrita. Falha ambígua fecha a sessão; uma nova verificação pode recarregar somente a política, mantendo PIN ativo bloqueado. Formato/instalação/campos inválidos são recusados.

O marcador não secreto .local-privacy-v1 torna a ausência posterior da credencial uma falha fechada. Na primeira ativação, persiste-se política desativada recuperável, publica-se o marcador por arquivo temporário/rename, depois grava-se e verifica-se a política PIN. Só então a ativação é confirmada. Interrupção antes da gravação PIN preserva a política anterior; após a gravação, a reabertura exige PIN. Fragmento temporário de marcador conhecido pode ser recuperado. Desativar guarda política desativada explícita, conservando o marcador; perda de credencial não vira desativação silenciosa.

Esta é uma camada de privacidade dentro do aplicativo. SQLCipher e proteção do perfil Windows continuam protegendo a chave aleatória. Não resiste a código arbitrário/admin operando como o mesmo usuário Windows comprometido, nem fornece um novo segredo de recuperação. Futuras operações financeiras/exportação/backup deverão passar pela mesma barreira de sessão.

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

Pré-requisitos nativos seguem o [cofre](desktop-vault.md): Windows x64, Rust 1.99.0, MSVC/SDK e Perl para OpenSSL. A prévia em navegador não configura PIN nem simula persistência de produto. A feature lock-smoke habilita os instrumentos e dynamic ACL; lock-probe/lock-smoke não entram no binário padrão. Seus únicos dados são fixtures sintéticas. A CI Windows inclui ambos os protocolos; execução remota não foi observada.

Os [oito gates Chromium](../quality/evidence/us-033-lock-browser-2026-10-17.json) cobrem padrão opcional/política, ativação/troca/desativação, limpeza dos campos, retorno/reentrada, cinco erros/contador, resposta atrasada após blur, axe, texto 200%/reflow/cores forçadas e ausência de storage/egress/erros. O relógio controlado é exclusivo do instrumento; o bloqueio financeiro verdadeiro é provado no Rust.

Os [16 gates Windows](../quality/evidence/us-033-lock-windows-2026-10-17.json) executam dez testes Rust, Clippy/build locked, Credential Manager entre processos, comandos bloqueados, PIN incorreto, reinício, troca/desativação, duas interrupções durante configuração e seis checkpoints na WebView2 real. São comparados ciphertext byte a byte e o digest de todas as colunas das 12 tabelas do FIN-002 A. Não há rekey ou alteração financeira por autenticação. Um teste concorrente comprova que perder foco descarta resposta em andamento e impede novas leituras de chave. Falhas/missing/record adulterado do store são injetados em doubles, sem alterar o secret store do usuário.

Os instrumentos usam raízes novas marcadas em .tools/us033-lock. Removem e verificam ausência da credencial de política e das chaves financeiras antes de excluir arquivos/perfis próprios. Relatórios fechados guardam apenas gates, versões, pendências, data e hashes, sem PIN/verificador, IDs de credencial, snapshots, paths privados ou dados financeiros. Quatro testes Node verificam contratos/erros e evidência. Evidências antigas preservam hashes e permissões de seu momento; o protocolo atual de workspaces usa formato 2 para distinguir oito permissões das três históricas.

Aceite do caminho PIN atendido em Windows x64. Biometria, outras plataformas, distribuição assinada, backup/restore, outbox/sync e G07-VAULT global mantêm seus gates. Próximo incremento: US-034, backup .fmbackup autenticado e versionado. Sete originais e DP-01 a DP-04 preservados.
