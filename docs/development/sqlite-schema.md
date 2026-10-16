# Schema SQLite equivalente — US-021

O [aceite](../delivery/05-backlog.md) exige os mesmos saldos/invariantes nos casos homologados em PostgreSQL e SQLite. O [ADR-0032](../architecture/adr/0032-schema-sqlite-e-equivalencia.md) registra escolhas, limites e ameaças. A fundação adiciona @financial-manager/storage-schema 0.1.0; nenhuma tela financeira ou migração de cofre de usuário foi conectada ao schema.

## Comandos

```powershell
pnpm install --frozen-lockfile
pnpm schema:sqlite:check
pnpm schema:dual:test
pnpm schema:native:desktop
pnpm spike:mobile:setup:android
pnpm schema:native:android:build
pnpm schema:native:android:test
pnpm check
```

schema:dual:test usa PostgreSQL Docker Linux em loopback 43221 e SQLite Node em arquivo sintético descartável. Contexto remoto, instância existente e arquivo de outro ensaio são recusados. schema:dual:clean remove somente o ambiente dedicado validado; o lock impede tomar ensaio ativo. Desktop requer Windows x64/Rust/Perl configurados para o binding US-001. Android reutiliza SDK/JDK/CMake/AVD próprios da US-002, porta 5562, app ID separado com.miudos.financialmanager.us021 e APK de teste com bundle embarcado; não usa Metro durante a execução, EAS ou assinatura de produção.

O build Android aplica a propriedade Gradle fmSchemaProbe=us021. A entrada padrão do package continua spikes/us-002/index.ts. A atividade nativa reutiliza o namespace gerado, mas a instalação/dados da US-021 têm ID próprio. O runner substitui apenas esse package sintético, confirma AVD us002/Android emulado, verifica bibliotecas SQLCipher/OpenSSL do APK, desliga rede, executa o corpus, reinicia completamente o SO e reabre para recuperar chave/saldo e limpar bases/chave. O app é parado ao final. A abertura após reinício mostra somente relatório técnico sanitizado.

## Contrato e diferenças físicas

O gerador infra/schema/generate-sqlite.mjs produz SQL em packages/storage-schema/sqlite/migrations e exports TypeScript a partir de sqlite-model.mjs. Também gera o JSON/TS do corpus sintético. Use schema:sqlite:generate ao alterar a fonte; schema:sqlite:check detecta drift. SQLCipher Rust inclui exatamente os arquivos SQL/JSON versionados; Expo importa os exports compilados. Os relatórios incluem hashes das fontes correspondentes e, no Android, do APK efetivamente instalado.

migrateSqlite recebe um SqliteConnection interno (exec/run/rows), configura foreign_keys/recursive_triggers/trusted_schema e verifica FK ativa antes de BEGIN IMMEDIATE. Só instala a versão inicial em uma base vazia/compatível; reaplicação com checksum igual é idempotente. Versão/checksum divergente falha com código fixo e rollback. Não é framework completo de upgrade/downgrade, verificador de schema restaurado ou comando SQL exposto ao usuário.

| Aspecto       | SQLite / responsabilidade do host                                                             |
| ------------- | --------------------------------------------------------------------------------------------- |
| Entidades     | Mesmas 12 entidades do núcleo PostgreSQL, mais metadados privados de migração/guard           |
| Autoridade    | LOCAL no Desktop; CLOUD representa réplica autorizada; não concede lease nem identidade       |
| IDs           | TEXT UUID canônico, comparação binária e FKs compostas; geração v7 na US-023                  |
| Dinheiro      | INTEGER i64; bind/JSON canônico string; nenhuma conversão monetária por Number                |
| Data/instante | TEXT calendário válido; UTC fixo de milissegundos; sem conversão por Date no corpus           |
| Rateio        | Soma completa no commit por guard/FK diferível, sem REAL e sem abs(INT64_MIN)                 |
| Nomes         | normalizedName deriva chave NFKC/espaços/lower no port; índice parcial ativo                  |
| Histórico     | Revisão imutável/única e soft delete; revisão automática/feed/tombstone em histórias próprias |
| Acesso        | Arquivo privado SQLCipher e comandos estreitos; FKs não substituem autorização                |

O pacote compartilhado não abre arquivos, busca chaves, consulta rede ou autentica. Adotadores de produto precisam validar MoneyMinor, autoridade/workspace autorizado e chave antes da migração/operação. Foreign keys são por conexão; PRAGMA dentro de uma transação prévia não garante ativação. O teste recusa esse caso. Um rollback falho exige fechar/descartar o handle no host.

normalized_name é derivado no SQLite e não deve vir de uma requisição. Os casos de nome em português/NFKC foram homologados; versões Unicode/locale e busca completa exigem corpus adicional. Adotar a migração no cofre de produto requer atualizar o validador de schema e homologar backup/restauração com as novas tabelas/triggers, mantendo G07-VAULT. Os atuais probes não migram dados de usuário.

## Protocolo executado

FIN-SCHEMA-001 usa apenas UUIDs/textos sintéticos. Os 33 casos exercitam saldo bancário/poupança/cartão, consumo separado de transferências/liquidação, extremos i64, paginação, FKs cruzadas, subcategoria, calendário/UTC, dinheiro fracionário/overflow, identidade, cartão, parcela positiva/completa, alteração atômica, INT64_MIN, carry, soma excessiva, revisão/soft delete e nomes ativos/arquivados. Cada runtime compara resultados exatos ou recusa esperada; resultados financeiros não aparecem nos relatórios.

- [Dual-engine](../quality/evidence/us-021-dual-engine-2026-10-16.json): 33 casos em cada engine e dez gates adicionais de migração, integridade, guard, escritor concorrente, local sem identidade, RLS, logs e limpeza. CRUD PostgreSQL usa logins restritos; bootstrap só provisiona/inspeciona.
- [Windows](../quality/evidence/us-021-desktop-2026-10-16.json): SQLCipher 4.14.0 community/SQLite 3.51.3; mesmos 33 casos, interrupção de migração, arquivo cifrado, chave errada/ausente, reabertura, integridade e limpeza. Cargo/Clippy do novo teste passaram.
- [Android](../quality/evidence/us-021-android-2026-10-16.json): Android 16/API 36 x86_64, SQLCipher 4.17.0 community/SQLite 3.53.3; mesmos 33 casos, SecureStore, precisão, integridade e criptografia, reboot completo offline (boot_count 5 → 6), recuperação da chave/saldo e limpeza. Runtime libs e hash do APK conferidos.

Os oito testes Node novos verificam geração, normalização, execução SQLite, migração/falha/FK/checksum e evidências. O job dual-schema executa o protocolo PostgreSQL/SQLite em Ubuntu; o teste Rust também integra o cargo test do job Desktop existente. Android foi homologado localmente; iOS e CI remota deste incremento permanecem pendentes. Relatórios temporários ficam em .tools/us021-dual e .tools/us021-native; segredos/bancos próprios são removidos, APK e metadados sintéticos ficam ignorados.

As mudanças de monorepo/CI exigiram novas execuções dos [quatro perfis Docker](../quality/evidence/us-014-environments-2026-10-16-us021.json), [DOM](../quality/evidence/us-016-dom-2026-10-16-us021.json) e [flags](../quality/evidence/us-017-flags-2026-10-16-us021.json). Os históricos foram preservados. A próxima história é US-022, framework de migrations dual-engine, com os gates do cofre e das plataformas mantidos.
