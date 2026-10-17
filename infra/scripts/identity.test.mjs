import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  IdentityError,
  encodeUuidV7,
  uuidV7,
  uuidV7Milliseconds,
  resourceId,
  createIdentityRuntime,
  createCryptoIdentity,
  MAX_UUID_MILLISECONDS,
} from '../../packages/contracts/dist/identity.js';
import {
  financialDate,
  utcInstant,
  instantFromEpochMilliseconds,
  instantEpochMilliseconds,
  summarizeMovements,
} from '../../packages/domain/dist/index.js';
import {
  identityVectors,
  runIdentityProbe,
} from '../../packages/contracts/dist/identity-probe.js';
import { createApiIdentity } from '../../apps/api/dist/identity.js';
import { createWorkerIdentity } from '../../apps/worker/dist/identity.js';
import { createDesktopIdentity } from '../../apps/desktop/dist/identity.js';
import {
  SYNTHETIC_WORKSPACE,
  SYNTHETIC_ACCOUNTS,
  SYNTHETIC_MOVEMENTS,
} from '../../packages/test-fixtures/dist/index.js';
import {
  nodeChecks,
  runtimeChecks,
  validateIdentityEvidence,
} from '../identity/evidence.mjs';
test('UUIDv7 codec matches RFC 9562 A.6 and preserves all timestamp bits at the limits', () => {
  const v = identityVectors.rfc,
    bytes = new Uint8Array(v.entropy);
  assert.equal(encodeUuidV7(v.milliseconds, bytes), v.uuid);
  for (const ms of [0, 1, 2 ** 32 - 1, 2 ** 32, MAX_UUID_MILLISECONDS]) {
    const id = encodeUuidV7(ms, bytes);
    assert.equal(uuidV7Milliseconds(id), ms);
    assert.equal(id[14], '7');
    assert.match(id[19], /[89ab]/);
  }
  for (const ms of [-1, 0.5, NaN, Infinity, MAX_UUID_MILLISECONDS + 1])
    assert.throws(() => encodeUuidV7(ms, bytes), { code: 'INVALID_UUID_TIME' });
});
test('resource IDs preserve legacy versions and reject normalization or non-RFC alternatives', () => {
  assert.equal(
    resourceId(identityVectors.legacy_uuid),
    identityVectors.legacy_uuid,
  );
  assert.throws(() => uuidV7(identityVectors.legacy_uuid), {
    code: 'INVALID_UUID_V7',
  });
  for (const id of [
    ...identityVectors.invalid_uuid,
    null,
    1,
    {},
    ' ' + identityVectors.rfc.uuid,
  ])
    assert.throws(() => resourceId(id), { code: 'INVALID_RESOURCE_ID' });
});
test('Node API and worker run the same corpus with real CSPRNGs including a frozen and regressing clock', () => {
  const expected = Object.fromEntries(
    runtimeChecks.map((name) => [name, true]),
  );
  assert.deepEqual(runIdentityProbe(createApiIdentity), expected);
  assert.deepEqual(runIdentityProbe(createWorkerIdentity), expected);
});
test('entropy is required without Math.random fallback and failures never return provider details', () => {
  const old = Math.random;
  try {
    Math.random = () => {
      throw new Error('INSECURE_RANDOM_CALLED');
    };
    uuidV7(createApiIdentity().newId());
  } finally {
    Math.random = old;
  }
  for (const randomBytes of [
    () => {
      throw new Error('SYNTHETIC_PRIVATE_ENTROPY_CANARY');
    },
    () => new Uint8Array(9),
    () => new Array(10).fill(0),
  ]) {
    const generator = createIdentityRuntime({
      epochMilliseconds: () => 1,
      randomBytes,
    });
    assert.throws(() => generator.newId(), {
      message: 'ENTROPY_UNAVAILABLE',
      code: 'ENTROPY_UNAVAILABLE',
    });
  }
  assert.throws(() => createCryptoIdentity(undefined, () => 1).newId(), {
    code: 'ENTROPY_UNAVAILABLE',
  });
});
test('clock failures and invalid times are explicit and inputs are captured by the factory', () => {
  const ports = {
    epochMilliseconds: () => identityVectors.rfc.milliseconds,
    randomBytes: () => new Uint8Array(identityVectors.rfc.entropy),
  };
  const generator = createIdentityRuntime(ports);
  ports.epochMilliseconds = () => -1;
  ports.randomBytes = () => {
    throw new Error('MUTATED_PROVIDER');
  };
  assert.equal(generator.newId(), identityVectors.rfc.uuid);
  assert.equal(Object.isFrozen(generator), true);
  assert.throws(
    () =>
      createIdentityRuntime({
        epochMilliseconds: () => {
          throw new Error('SYNTHETIC_PRIVATE_CLOCK_CANARY');
        },
        randomBytes: () => new Uint8Array(10),
      }).newId(),
    { message: 'CLOCK_UNAVAILABLE' },
  );
});
test('UTC codecs preserve historical instants and reject precision loss, offsets and calendar normalization', () => {
  for (const v of identityVectors.valid_instants) {
    const parsed = utcInstant(v.text);
    assert.equal(instantEpochMilliseconds(parsed), v.milliseconds);
    assert.equal(instantFromEpochMilliseconds(v.milliseconds), v.text);
    assert.equal(JSON.parse(JSON.stringify(parsed)), v.text);
  }
  for (const v of [...identityVectors.invalid_instants, new Date(), null, 1])
    assert.throws(() => utcInstant(v), { code: 'INVALID_INSTANT' });
  for (const epoch of [-62135596800001, 253402300800000, 1.1, NaN, Infinity])
    assert.throws(() => instantFromEpochMilliseconds(epoch), {
      code: 'INVALID_INSTANT',
    });
});
test('financial dates stay calendar dates independent of any instant or timezone', () => {
  for (const date of identityVectors.valid_dates)
    assert.equal(financialDate(date), date);
  for (const date of identityVectors.invalid_dates)
    assert.throws(() => financialDate(date), { code: 'INVALID_DATE' });
});
test('desktop bridge accepts only canonical Rust outputs and sanitizes transport failures', async () => {
  const v = identityVectors.rfc,
    instant = identityVectors.valid_instants[4].text;
  const bridge = createDesktopIdentity({
    newId: async () => v.uuid,
    nowInstant: async () => instant,
  });
  assert.equal(await bridge.newId(), v.uuid);
  assert.equal(await bridge.nowInstant(), instant);
  const broken = createDesktopIdentity({
    newId: async () => {
      throw new Error('SYNTHETIC_PRIVATE_IPC_CANARY');
    },
    nowInstant: async () => {
      throw new Error('SYNTHETIC_PRIVATE_IPC_CANARY');
    },
  });
  await assert.rejects(broken.newId(), { message: 'ENTROPY_UNAVAILABLE' });
  await assert.rejects(broken.nowInstant(), { message: 'CLOCK_UNAVAILABLE' });
  await assert.rejects(
    createDesktopIdentity({
      newId: async () => identityVectors.legacy_uuid,
      nowInstant: async () => instant,
    }).newId(),
    { code: 'INVALID_UUID_V7' },
  );
});
test('UUID clock order cannot change economic totals or financial dates', () => {
  const base = {
    workspace_id: SYNTHETIC_WORKSPACE,
    accounts: SYNTHETIC_ACCOUNTS,
    movements: SYNTHETIC_MOVEMENTS,
    period: { from: '2026-10-01', to: '2026-10-31' },
  };
  const expected = summarizeMovements(base);
  const renamed = SYNTHETIC_MOVEMENTS.map((row, index) => ({
    ...row,
    id: encodeUuidV7(
      identityVectors.rfc.milliseconds - index,
      new Uint8Array(identityVectors.rfc.entropy),
    ),
  }));
  assert.deepEqual(
    summarizeMovements({ ...base, movements: renamed.reverse() }),
    expected,
  );
  assert.equal(
    renamed.every((row) =>
      SYNTHETIC_MOVEMENTS.some(
        (old) => old.financial_date === row.financial_date,
      ),
    ),
    true,
  );
});
test('identity fixture generation is deterministic and never requires a secure random source', () => {
  const result = spawnSync(
    process.execPath,
    ['infra/identity/generate.mjs', '--check'],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(result.status, 0);
});
test('historical identity evidence preserves Node/browser/PostgreSQL/SQLite and native SQLCipher scopes', () => {
  for (const kind of ['node', 'windows', 'android']) {
    const filename = new URL(
      '../../docs/quality/evidence/us-023-' + kind + '-2026-10-16.json',
      import.meta.url,
    );
    const load = () => JSON.parse(readFileSync(filename, 'utf8'));
    assert.equal(
      validateIdentityEvidence(load(), kind, { matchSources: false }).passed,
      true,
    );
    for (const gate of kind === 'node'
      ? nodeChecks
      : [...runtimeChecks, 'sqlcipher_roundtrip_reopen_and_cleanup']) {
      const report = load();
      delete report.checks[gate];
      assert.throws(
        () => validateIdentityEvidence(report, kind, { matchSources: false }),
        /IDENTITY_EVIDENCE_INVALID/,
      );
    }
    for (const change of [
      (r) => {
        r.payload = 'SYNTHETIC_PRIVATE_CANARY';
      },
      (r) => {
        r.source_sha256[Object.keys(r.source_sha256)[0]] = 'invalid-hash';
      },
      (r) => {
        r.pending = [];
      },
      (r) => {
        r.same_millisecond_sample_count = 0;
      },
      (r) => {
        r.completed_at_utc = 'invalid';
      },
    ]) {
      const report = load();
      change(report);
      assert.throws(
        () => validateIdentityEvidence(report, kind, { matchSources: false }),
        /IDENTITY_EVIDENCE_INVALID/,
      );
    }
  }
  assert.equal(
    new IdentityError('ENTROPY_UNAVAILABLE').message,
    'ENTROPY_UNAVAILABLE',
  );
});
