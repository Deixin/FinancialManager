import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { profileNames, requireEnvironment as ensure } from './model.mjs';
import {
  startProfile,
  verifyProfile,
  stopProfile,
  profileArtifactsExist,
  secretValues,
  connectProfile,
  httpsJson,
  manifest,
  sourceHashes,
} from './runtime.mjs';

export async function homologateEnvironments(
  session,
  { progress = () => {} } = {},
) {
  // Never take over a developer's already-running environment to run a test.
  ensure(
    profileNames.every((name) => !profileArtifactsExist(name)),
    'ENVIRONMENT_PROFILE_IN_USE',
  );
  const started = {},
    owners = {},
    profiles = {},
    checks = {};
  const report = {
    format_version: 1,
    scope: 'docker-local-foundation-environments',
    synthetic_only: true,
    started_at_utc: new Date().toISOString(),
    passed: false,
    profiles,
    checks,
    versions: session.versions,
    images: manifest.images,
    source_sha256: sourceHashes(),
    pending: [
      'product-api-bff-worker',
      'object-storage-adapter',
      'remote-staging-and-production',
      'native-client-runtime-integration',
    ],
  };
  let failed;
  try {
    progress('failed_start_recovery');
    const blocker = createServer();
    await new Promise((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(
        manifest.profiles.local.database_port,
        '127.0.0.1',
        resolve,
      );
    });
    owners.local = randomUUID();
    let refusedStart = false;
    try {
      await startProfile(session, 'local', {
        exclusive: true,
        owner: owners.local,
      });
    } catch {
      refusedStart = true;
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
    ensure(refusedStart, 'ENVIRONMENT_FAILURE_NOT_DETECTED');
    await stopProfile(session, 'local', { owner: owners.local });
    ensure(!profileArtifactsExist('local'), 'ENVIRONMENT_CLEANUP_INCOMPLETE');
    checks.failed_start_preserves_recoverable_cleanup = true;
    for (const name of ['local', 'ci']) {
      progress('start_' + name);
      owners[name] = randomUUID();
      started[name] = await startProfile(session, name, {
        exclusive: true,
        owner: owners[name],
      });
      progress('verify_' + name);
      profiles[name] = await verifyProfile(session, name);
    }
    progress('cross_profile_isolation');
    const first = secretValues('local'),
      second = secretValues('ci');
    ensure(
      Object.keys(first).every((key) => first[key] !== second[key]),
      'ENVIRONMENT_CREDENTIALS_REUSED',
    );
    const pool = connectProfile(started.ci, first.runtime);
    let refused = false;
    try {
      await pool.query('SELECT 1');
    } catch (error) {
      refused = error.code === '28P01';
    } finally {
      await pool.end();
    }
    ensure(refused, 'ENVIRONMENT_CROSS_PROFILE_ACCESS');
    checks.cross_profile_credentials_rejected = true;
    let wrongCa = false;
    try {
      await httpsJson(
        'ci',
        `https://127.0.0.1:${started.ci.identity_port}/realms/fm-ci/.well-known/openid-configuration`,
        { caProfile: 'local' },
      );
    } catch {
      wrongCa = true;
    }
    ensure(wrongCa, 'ENVIRONMENT_CA_REUSED');
    checks.cross_profile_tls_trust_rejected = true;
    progress('idempotent_start');
    let occupied = false;
    try {
      await startProfile(session, 'local', { exclusive: true });
    } catch (error) {
      occupied = error.code === 'ENVIRONMENT_PROFILE_IN_USE';
    }
    ensure(occupied, 'ENVIRONMENT_EXISTING_PROFILE_OVERWRITTEN');
    checks.exclusive_test_refuses_existing_instance = true;
    const repeated = await startProfile(session, 'local');
    ensure(
      repeated.owner === started.local.owner,
      'ENVIRONMENT_RESTART_CHANGED_OWNER',
    );
    await verifyProfile(session, 'local');
    checks.repeated_up_preserves_instance = true;
    progress('local_recreation');
    await stopProfile(session, 'local', { owner: owners.local });
    ensure(!profileArtifactsExist('local'), 'ENVIRONMENT_CLEANUP_INCOMPLETE');
    owners.local = randomUUID();
    started.local = await startProfile(session, 'local', {
      exclusive: true,
      owner: owners.local,
    });
    const rotated = secretValues('local');
    ensure(
      Object.keys(first).every((key) => first[key] !== rotated[key]),
      'ENVIRONMENT_CREDENTIALS_REUSED',
    );
    await verifyProfile(session, 'local');
    checks.recreation_rotates_credentials_and_instance = true;
    for (const name of ['local', 'ci'])
      await stopProfile(session, name, { owner: owners[name] });
    for (const name of ['integration', 'staging']) {
      progress('start_' + name);
      owners[name] = randomUUID();
      started[name] = await startProfile(session, name, {
        exclusive: true,
        owner: owners[name],
      });
      progress('verify_' + name);
      profiles[name] = await verifyProfile(session, name);
      await stopProfile(session, name, { owner: owners[name] });
    }
    report.passed = true;
  } catch (error) {
    failed = error;
  } finally {
    let cleaned = true;
    for (const [profile, owner] of Object.entries(owners)) {
      try {
        await stopProfile(session, profile, { owner });
      } catch {
        cleaned = false;
      }
    }
    checks.all_owned_containers_networks_and_secrets_removed =
      cleaned && profileNames.every((name) => !profileArtifactsExist(name));
    if (!checks.all_owned_containers_networks_and_secrets_removed)
      report.passed = false;
    report.completed_at_utc = new Date().toISOString();
    if (failed) {
      report.passed = false;
      report.failure_code =
        typeof failed.code === 'string' &&
        /^ENVIRONMENT_[A-Z_]+$/.test(failed.code)
          ? failed.code
          : 'ENVIRONMENT_TEST_FAILED';
    }
  }
  return report;
}
