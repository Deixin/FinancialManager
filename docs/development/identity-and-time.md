# US-023 — Identidade e tempo

O incremento fornece geração UUIDv7 por host e codecs temporais consistentes. [ADR-0034](../architecture/adr/0034-uuidv7-e-politica-temporal.md), [US-023](../delivery/05-backlog.md) e [G07-IDS/TIME](spikes/us-007-physical-decisions.md) registram decisões e limites.

## Contratos

- contracts: resourceId preserva UUID RFC canônico v1–v8; uuidV7 valida saídas novas; encodeUuidV7 implementa o layout RFC a partir de tempo/bytes explícitos. createIdentityRuntime recebe portas confiáveis, sem estado ou fallback inseguro.
- domain: utcInstant aceita somente string UTC com três casas de ms, ano 0001–9999. instantFromEpochMilliseconds/instantEpochMilliseconds fazem conversão exata no intervalo permitido. financialDate conserva data de calendário sem fuso.
- Web/API/worker: factories createWebIdentity/createApiIdentity/createWorkerIdentity usam Web Crypto do host. Mobile: src/identity.ts usa expo-crypto/getRandomValues, importado em entrypoint Native. Não use getRandomBytes como gerador de IDs.
- Desktop: identity.rs usa uuid/getrandom e chrono; createDesktopIdentity valida um bridge assíncrono estreito. Binding Tauri e casos de uso de produto ainda precisam integrar essas operações.

O runtime expõe newId e nowInstant. Capturar um ID não define data financeira ou revisão. Não compare relógios/UUIDs para escolher vencedor de conflito, autorizar, ordenar feed ou decidir expiração offline. No mesmo ms a cauda é aleatória; regressão de relógio pode fazer o UUID diminuir. Preserve IDs já existentes, inclusive v4; o gerador só atende entidades novas.

Falhas usam códigos fixos sem inputs/cause. Não converta dinheiro para Number. Clock/epoch usa inteiros exatos no intervalo próprio e é um conceito separado de MoneyMinor. Instantes com offsets ou precisão maior exigem um adaptador de entrada explícito; o codec interno os recusa em vez de reinterpretar/truncar.

## Execução

```text
pnpm identity:generate
pnpm identity:check
pnpm identity:test
pnpm identity:native:windows
pnpm spike:mobile:setup:android
pnpm identity:native:android:build
pnpm identity:native:android:test
pnpm check
```

identity:test exige Docker Linux local e Chromium do Playwright instalado. Usa apenas financial-manager-us023, PostgreSQL 18.6 pinado por digest, tmpfs, segredo aleatório em arquivo ignorado e porta 43223 limitada a 127.0.0.1. Verifica 14 gates: corpus de IDs/tempo, API/worker CSPRNG, quatro processos TZ, Chromium real em quatro fusos, UUIDv7/ordem PostgreSQL, domínios/precisão, roundtrip SQLite, logs e limpeza. Em falha, identity:clean remove somente esses recursos, recusando contexto remoto, symlinks, lock ativo ou propriedade/imagem divergente.

Vetores fonte: packages/contracts/fixtures/us023.json; TS gerado para os probes via identity:generate. O subpath contracts/identity-probe é somente instrumento sintético. O vetor UUID é o exemplo público da RFC 9562 A.6. Instantes válidos incluem os limites 0001/9999 e histórico pré-1970; rejeições incluem 1900 não bissexto, offsets, precisão excessiva e leap seconds. Os mesmos valores são validados em JS/Chrono e usados nos testes de persistência.

Windows usa o crate já fixado do spike US-001, com Rust 1.99, SQLCipher real e dados temporários sintéticos. O novo teste valida RFC/CSPRNG, relógios, IDs legados, calendário/UTC, persistência/reabertura e remoção da base. A adição de chrono está justificada no ADR; não modifica o formato de backups ou a geração de IDs do experimento histórico.

Android tem app ID com.miudos.financialmanager.us023 e profile Gradle fmIdentityProbe=us023. O main padrão US-002 permanece. O runner recusa dispositivos físicos e AVD diferente de us002/emulator-5562, confere SQLCipher/OpenSSL no APK e confirma modo avião/Wi-Fi/dados. Duas execuções com PIDs distintos verificam CSPRNG real, schema v2 via migrations, UTC/DATE/IDs persistidos, SecureStore, reabertura e limpeza. O app próprio é desinstalado; o emulador iniciado para a homologação é encerrado ao final do trabalho. Não substitui a homologação iOS.

Os resultados ignorados ficam em .tools/us023-identity/node.json, windows.json e android.json. Os [três relatórios versionados](../quality/evidence/us-023-node-2026-10-16.json) têm contrato fechado, hashes atuais e escopo/pendências explícitos; [Windows](../quality/evidence/us-023-windows-2026-10-16.json), [Android](../quality/evidence/us-023-android-2026-10-16.json). Não arquive bancos, chaves, logs brutos ou IDs aleatórios. As evidências US-021 anteriores permanecem históricas após a mudança de core/configuração/lockfiles; os seus gates e manifests continuam validados sem fingir que seus hashes descrevem as fontes atuais.

## Próxima etapa

A US-024 deve começar pelo gate G07-QUERY antes de escolher typed-query/repositories e integrar os contextos transacionais/autorizados. G07-IDS/TIME ainda exigem iOS; bindings de comandos/repositories, restore/cofre e releases permanecem nos gates próprios. DP-01 a DP-04 não foram resolvidas.
