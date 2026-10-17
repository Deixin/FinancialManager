# Espaço local anônimo — US-031

A [US-033](local-privacy.md) acrescenta PIN/Windows Hello opcionais e a [US-034](local-backup.md) acrescenta backup criptografado, totalizando 11 comandos específicos, com os três de workspaces atrás da barreira nativa. Os relatórios atuais têm formato 2 e sufixo us034: [oito gates Chromium](../quality/evidence/us-031-workspaces-browser-2026-10-17-us034.json) e [15 Windows](../quality/evidence/us-031-workspaces-windows-2026-10-17-us034.json). Os de formato 1 abaixo preservam a concessão histórica de três permissões. O usuário continua sem identidade cloud. Homologações humanas ficam diferidas para depois da integração completa, sem bloquear histórias seguintes, conforme [ADR-0044](../architecture/adr/0044-homologacao-humana-apos-integracao.md).

Validação atual reexecutada na [US-032](desktop-vault.md), com [oito gates Chromium](../quality/evidence/us-031-workspaces-browser-2026-10-17-us032.json) e [15 Windows](../quality/evidence/us-031-workspaces-windows-2026-10-17-us032.json). Essa história ampliou migrations/journal e falhas do secret store; o G07-VAULT global mantém backup/restore, outbox e distribuição pendentes. O registro abaixo preserva o recorte entregue na US-031.

O Desktop cria um espaço com nome e finalidade Pessoal/Empresa/Outro, mantém armazenamento Local e moeda BRL, e abre uma visão geral vazia. Não cria cloud_user, auth_identity, workspace_member, token ou usuário remoto anônimo. O nome é exibido como texto; dados pessoais/fiscais não são obrigatórios nem coletados nesta etapa. Cadastro de contas e lançamentos continua nas histórias financeiras; não há saldo fictício no painel.

Continuar sem conta carrega os espaços locais. Sem espaços, apresenta WS-01; com espaços existentes, permite abrir o escolhido. Depois da criação, o usuário pode retornar à entrada, listar e reabrir. Nome/finalidade persistem após sair do processo. A implementação permite mais de um arquivo, sem limite comercial, mas gestão completa/seletor e edição ficam nos seus escopos, incluindo US-036/CF-05.

## Fronteira e contrato

Os únicos comandos de produto concedidos à janela principal são list_local_workspaces, create_local_workspace e open_local_workspace. Não há SQL, caminho de arquivo, segredo, usuário cloud ou modo de armazenamento enviado pela UI. O host escolhe o diretório privado e aplica LOCAL/BRL. Create recebe somente workspace_id, display_name e purpose; campos extras e enum/ID inválidos são recusados no Rust. A gateway TypeScript valida também a resposta, sua autoridade e identidade, e substitui erros desconhecidos por mensagens seguras.

O UUIDv7 do pedido nasce no Web Crypto pelo núcleo de identidade já validado na US-023, somente ao submeter. Reenvio do mesmo ID/conteúdo devolve o espaço existente; mudar conteúdo com ID já publicado gera conflito e não sobrescreve dados. O formulário bloqueia submissões concorrentes e mantém o ID ao repetir uma tentativa. Perda de resposta pode ser recuperada pela listagem, sem criar outra identidade. O core gera instalação/geração com CSPRNG Rust; esses identificadores privados não são conta ou dispositivo cloud, nem são enviados como telemetria.

O modelo Rust separado de UI/adapters valida finalidade e nome não vazio, sem controles e com até 120 unidades UTF-16, alinhado aos controles DOM/shell. A criação grava somente a linha workspace, com demais campos opcionais nulos. Listar/abrir valida o workspace esperado em cada arquivo e não permite alternar autoridade para CLOUD. Múltiplos espaços usam arquivos/chaves distintos; um identificador não fornece acesso SQL genérico.

## Persistência protegida mínima

A persistência da US-031 precisa antecipar o mínimo de cofre da US-032: SQLCipher rusqlite 0.40.2, com bundled-sqlcipher-vendored-openssl, e chave aleatória de 32 bytes no Windows Credential Manager. São as versões do binding/secret store já provadas na US-001. O produto usa namespace próprio, com instalação/espaço, e não importa o banco/schema sintético do spike. Chaves são Zeroizing, não são escritas em arquivo ou devolvidas à WebView. Ausência de chave falha fechada, sem regenerar ou substituir o banco.

Os arquivos ficam em app_local_data_dir/local-v1/workspaces/UUID/vault.db, selecionados apenas no Rust. Um lock de arquivo protege a instalação entre processos; um mutex serializa comandos em threads de IO. Identidade de instalação não secreta fica no diretório privado, sem nomes ou dados financeiros. Paths/entradas ligados ou inesperados são recusados; a garantia não cobre um administrador ou o mesmo usuário Windows comprometido.

A criação usa staging/UUID. Persiste/verifica a chave, inicializa migrations v1/v2 e workspace, verifica integridade, fecha o banco e renomeia o diretório no mesmo volume. A publicação é a última operação falível do pedido. Falha anterior limpa staging/chave; processo encerrado deixa marcador privado que a próxima abertura recupera antes de publicar qualquer espaço. Recuperação nunca elimina chave de workspace publicado. Não há promessa de recuperação física após corte de energia nesta história.

O runner Rust usa as migrations de produto existentes. Catálogo gerado por infra/local-workspaces/generate.mjs referencia os mesmos SQL e checksums da US-022, sem nova versão de schema. Verifica histórico contíguo/checksums, definições exatas de tabelas/índices/triggers e integridade; recusa schema futuro/adulterado. Suporta somente avanço não destrutivo até v2. Downgrade, alterações destrutivas, backup_manifest/restore e homologação ampliada permanecem no G07-VAULT. SQLite abre com chave, FK/recursive_triggers, trusted_schema OFF, temp em memória, secure_delete, journal DELETE e synchronous FULL.

Dependências diretas novas reutilizam pins de rusqlite, getrandom, uuid, chrono, zeroize, sha2 e keyring já usados no spike, necessárias a banco, IDs/tempo, checksum e segredo. Serde/serde_json passam a produção para contratos/migrations. @tauri-apps/api 2.12.4 fornece invoke/isTauri públicos, em lugar de API interna no código de produto. O código de teste ainda usa instrumentação própria, separada por feature/binário. Nenhuma regra monetária ou dependência externa de serviço foi adicionada.

## Reprodução e evidências

```sh
pnpm install --frozen-lockfile
pnpm desktop:workspaces:generate
pnpm desktop:workspaces:check
pnpm desktop:workspaces:native
pnpm check
pnpm desktop:preview
```

Preview continua somente visual em loopback 44361: não simula persistência e pede abrir o Desktop para criar/abrir espaços. Os aliases desktop:entry:check/native agora executam o protocolo atual. Os instrumentos/evidências originais da US-030 foram preservados como históricos; seu antigo gate de zero permissões não descreve a concessão atual de três comandos estreitos.

Os [oito gates Chromium](../quality/evidence/us-031-workspaces-browser-2026-10-17.json) verificam formulário offline, campos mínimos, submissão única, resposta/retorno, nome hostil como texto, erro sanitizado/ACK perdido, acessibilidade/reflow e ausência de storage/egress. Usam um adapter sintético em memória instalado apenas pelo Playwright, nunca empacotado no aplicativo. Não são prova de persistência nativa.

Os [15 gates Windows](../quality/evidence/us-031-workspaces-windows-2026-10-17.json) executam seis testes Rust, Clippy/build locked e WebView2 com os comandos reais. Criam, reabrem em outro processo e comprovam banco criptografado, recusa de SQLite sem chave/chave errada, falta de chave sem mutação, ausência das três tabelas cloud, migrations v2 e isolamento. Dois processos são encerrados abruptamente após guardar chave e após commit antes de publicação; recuperação remove staging/chaves órfãs e conserva os espaços publicados. O relatório exige limpeza de todas as credenciais/perfis/arquivos próprios. Offline na WebView é injeção de sinal/egress, sem alterar a rede do SO.

Quatro testes Node adicionais cobrem decoder, projeção de erros, geração/checksums e evidência. O protocolo mantém artefatos sintéticos em .tools/us031-workspaces, com perfil e instalação distintos do usuário; executáveis/caches permanecem ignorados. Relatórios fechados contêm somente gates, versões, pendências, datas e hashes. Não arquivam IDs de instalações/credenciais, nomes, banco ou conteúdo financeiro. CI Windows foi atualizada; execução remota deste incremento não foi observada.

## Limites

Aceite US-031 atendido em Windows x64 no recorte de criação/persistência/reabertura local. A antecipação mínima de SQLCipher não encerra US-032 ou G07-VAULT: faltam homologação ampliada de migrations/journal/outbox, integração de backup/restore e distribuição. Não há PIN, contas/lançamentos nativos, sincronização, cloud, release assinado/updater ou homologação macOS/Linux/iOS. Os sete originais e DP-01 a DP-04 foram preservados. [ADR-0040](../architecture/adr/0040-workspace-local-anonimo.md). Próximo passo: US-032.
