# Cofre Desktop — US-032

O cofre de produto iniciado na US-031 usa SQLCipher no Rust, chave aleatória de 32 bytes por workspace e Windows Credential Manager escopado à instalação/espaço. O aceite da US-032 exige abertura somente com chave correta e ausência do segredo em texto persistido. Esta etapa amplia a prova de falhas e recuperação do core existente, preservando sua política de abertura, compatibilidade, journal e publicação de identidade. [ADR-0041](../architecture/adr/0041-homologacao-cofre-produto.md).

## Proteção e fronteiras

O host escolhe o diretório privado. A WebView continua com somente list_local_workspaces, create_local_workspace e open_local_workspace; não recebe SQL, caminhos ou segredo. A chave é verificada no secret store antes da publicação. Chave ausente/store indisponível falham sem regenerar segredo nem substituir banco. O material secreto usa Zeroizing; erros de produto são códigos sanitizados.

As migrations existentes v1/v2 rodam numa transação, com histórico/checksum, definições de schema e integridade validados. A homologação lê oito opções efetivas: FK/recursive_triggers ON, trusted_schema OFF, temp_store MEMORY, synchronous FULL, secure_delete ON, cipher_memory_security ON e journal DELETE. SQLCipher 4.14.0 community / SQLite 3.51.3 são versões observadas; não passam a ser uma nova política de recusa de cofres existentes.

## Reprodução

```sh
pnpm install --frozen-lockfile
pnpm desktop:workspaces:check
pnpm desktop:workspaces:native
pnpm desktop:vault:check
pnpm check
```

Requer Windows x64, Rust 1.99.0 com Clippy/rustfmt, MSVC/Windows SDK e Perl nativo para OpenSSL vendorizado. O cache Cargo do spike é reutilizado sem importar seu código/schema/credenciais. Não há dependência nova de produção: a feature opcional vault-smoke ativa rusqlite/trace e instrumentação separada. O binário padrão não a ativa. A CI Windows inclui o protocolo; execução remota deste incremento não foi observada.

O [relatório Windows](../quality/evidence/us-032-vault-windows-2026-10-17.json) exige 11 gates:

1. Rustfmt/Clippy sem avisos e oito testes Rust de falhas.
2. Build locked do produto e instrumento separado.
3. SQLCipher real e oito opções de proteção efetivas.
4. Interrupção de migração após o DDL v2.
5. Interrupção após gravar o histórico v2 na transação.
6. Interrupção imediatamente antes do COMMIT.
7. Journal DELETE quente com cabeçalho real e conteúdo protegido, inspecionado antes de reabrir SQLite.
8. Recuperação desse journal com rollback integral do estado financeiro não confirmado.
9. Lock recusando um segundo processo real na mesma instalação.
10. Ausência do instrumento no binário padrão e manutenção dos três comandos estreitos.
11. Remoção verificada das credenciais e dos arquivos próprios.

Os oito testes Rust verificam arquivo ausente, SQLite sem chave/chave incorreta sem mutação, secret store indisponível, falhas antes/depois da escrita do segredo, falha de limpeza recuperável sem apagar espaço publicado, ciphertext corrompido, schema/histórico adulterados e upgrade preservando a fixture. Injetam falhas com KeyStore em memória; os subprocessos usam Windows Credential Manager real entre execuções. Os seis testes Rust anteriores e os 15 gates WebView2 da US-031 continuam separados.

## Interrupções e dados sintéticos

Cada caso prepara instalação própria em .tools/us032-vault/run-*. A fixture é o workspace A do FIN-002 v1, explicitamente sintético, com storage_mode adaptado para LOCAL e nomes ASCII normalizados. Não é importador de produto. Compara todas as colunas das 12 tabelas financeiras, incluindo histórico de revisão, ordenadas por identidade. Inteiros são strings, sem ponto flutuante. Só um digest temporário fica no diretório do teste; o relatório não contém snapshot financeiro.

O trace de teste observa a conexão real do migrador e encerra o processo com código 73 nos checkpoints. Não imprime SQL nem altera o migrador. Reabertura exige versão v1 e mesmo estado financeiro antes da nova tentativa; depois exige v2, schema/histórico íntegros e estado idêntico. Checkpoint não alcançado falha o protocolo.

O teste de journal usa transação não confirmada, cache spill e marcador sintético grande. Confere o cabeçalho quente depois do encerramento. Antes de reabrir SQLite, examina os arquivos buscando chave bruta/hexadecimal e trechos financeiros sintéticos conhecidos, inclusive nas páginas anteriores à atualização. Após recuperar, a fixture deve ser a original. Isso não representa corte físico de energia.

O instrumento exige raiz nova na preparação e marcador sintético nas demais operações. A limpeza verifica localização/ausência de links, remove somente as próprias credenciais, verifica sua ausência e então elimina os arquivos. Falha do protocolo também tenta limpar; relatório nunca é aprovado sem confirmação. São emitidos apenas gates, versões, pendências, hashes e data, sem IDs, nomes, valores, paths privados, bancos, chaves ou conteúdo financeiro. Três testes Node rejeitam evidência incompleta, fontes obsoletas, campos extras e hashes históricos malformados.

## Escopo e sequência

Aceite US-032 atendido em Windows x64 para inicialização, abertura protegida, chave do SO e recuperação exercitada de migrations/journal. G07-VAULT global mantém outbox/sincronização, backup_manifest, backup/restauração em staging como novo workspace, outra instalação de produto, distribuição assinada e outras plataformas nos seus gates. A homologação de outra instalação Windows na US-001 continua como evidência do spike.

Próxima história: US-033, PIN/biometria opcionais como camada adicional; backup/restore de produto seguem em US-034/035. Não se concede autorização offline cloud nem se define retenção/papéis. Sete documentos originais e DP-01 a DP-04 preservados.
