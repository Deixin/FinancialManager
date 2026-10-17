# ADR-0042 — Bloqueio local opcional por PIN

Status: adotado e validado para PIN do aplicativo em Windows x64; adapter biométrico e outras plataformas pendentes.

Data: 2026-10-17. História: US-033. Referências: arquitetura §05, privacidade local, RF-32, ADR-0040/0041 e [protocolo](../../development/local-privacy.md).

## Contexto

A chave aleatória do cofre já está no secret store Windows. US-033 pede proteção local opcional, com falha de autenticação sem corrupção e política clara. Um bloqueio apenas na UI permitiria invocar diretamente comandos nativos e recuperar nomes/chaves. PIN também não pode substituir criptografia ou o segredo de um backup portátil.

## Decisão

Implementar PIN de aplicativo de 6–12 dígitos, desativado por padrão, para liberar a sessão da instalação local. Não usar PIN como chave SQLCipher, recriptografar dados existentes ou criar identidade cloud. Reinício, saída para entrada, perda de foco e ação manual bloqueiam; alteração/desativação exigem PIN atual. Cinco erros geram espera persistida de 30 segundos; relógio regredindo falha fechado.

LocalState aplica a barreira antes/depois de operações sensíveis, serializa IO/KDF e recebe flag atômica do evento de foco nativo. UI remove dados imediatamente e ignora respostas de uma geração anterior. Conexões/chaves não são mantidas abertas na sessão. Operação já iniciada pode concluir atomicamente, sem expor a resposta depois do bloqueio.

Argon2id v19 com 64 MiB/3 passes/paralelismo 1 produz verificador de 32 bytes com salt CSPRNG de 16 bytes; ctutils faz comparação sem curto-circuito. Justificam-se argon2 0.6.0 e ctutils 0.4.3 como dependências nativas diretas, com pins já presentes no cache/spike. Não acrescentam serviço externo ou regra ao Domain. [API Argon2](https://docs.rs/argon2/0.6.0/argon2/struct.Argon2.html), [ctutils](https://docs.rs/ctutils/0.4.3/ctutils/).

Política/verificador ficam em namespace Credential Manager próprio, ligados à instalação. Marcador não secreto impede que credencial perdida seja tratada como proteção desativada. Primeira ativação grava estado anterior desativado, publica marcador por rename e persiste/verifica política PIN antes de confirmar. Desativação grava registro explícito. Falha ambígua fecha a sessão; recarregar política não concede uma sessão PIN desbloqueada. Nenhuma migration de schema financeiro é necessária.

Adicionar cinco comandos específicos e nenhuma permissão genérica de SQL/FS/secrets. Inputs e status são fechados. Alteração substitui no ADR-0040 somente o conjunto de três permissões por oito comandos e acrescenta a barreira de privacidade. Demais regras de cofre/compatibilidade permanecem. Binários de teste requerem feature; a produção não recebe hooks de falha ou comandos de relatório.

## Alternativas e consequências

UI sem barreira nativa é insuficiente. Derivar a chave financeira de PIN curto diminuiria a entropia do cofre; envolver/migrar todas as chaves exigiria protocolo de migração não necessário para a proteção adicional dentro da aplicação. O perfil Windows/secret store permanece fronteira confiável, e código arbitrário/admin como esse usuário está fora da garantia.

Biometria não é simulada nem detectada como disponível. A interface a informa indisponível nesta versão; um adapter Windows Hello exigirá integração desktop apropriada, resultado de consentimento e hardware homologado. A [documentação Microsoft](https://learn.microsoft.com/en-us/windows/apps/develop/security/fingerprint-biometrics) é referência para esse trabalho futuro. PIN local entregue não afirma autenticação biométrica ou recuperação de backups.

## Evidência e limites

Dez testes Rust e 16 gates Windows exercitam store real entre processos, falhas simuladas, bloqueio sem leitura de chave, reinício/throttle, troca/desativação, corrida com foco, ciphertext/FIN-002 preservados, duas interrupções de configuração e seis checkpoints WebView2. Oito gates Chromium cobrem fluxo, acessibilidade/reflow e ausência de storage/egress; quatro testes Node cobrem contrato e evidência. Instrumentos removem credenciais/perfis/arquivos próprios e não arquivam segredos ou dados financeiros.

Não há redefinição de PIN nesta versão; a opção é voluntária e informa essa restrição antes da ativação. Backup/restore, outbox/sync, assinatura, outras plataformas e G07-VAULT global continuam pendentes. DP-01 a DP-04 e os sete originais não mudam. CI configurada, execução remota não observada. US-034 é o próximo incremento de produto.
