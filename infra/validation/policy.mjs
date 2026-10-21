import { createHash } from 'node:crypto';
import path from 'node:path';

export function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}

export const objectDigest = (value) => digest(JSON.stringify(canonical(value)));

export function relativeInput(name, base = '') {
  const normalized = path.posix.normalize(path.posix.join(base, name));
  if (
    normalized.startsWith('../') ||
    normalized === '..' ||
    path.posix.isAbsolute(normalized) ||
    /[:\\\x00]/.test(normalized)
  )
    throw Error('VALIDATION_PATH_INVALID');
  return normalized;
}

// These tests are executed afresh by the mandatory pnpm check. They consume
// protocol reports; they are not inputs to the native/browser/data protocols.
export const isConsumerTest = (file) =>
  /^infra\/scripts\/[^/]+\.test\.mjs$/.test(file);

export function protocolSources(report, sourceBase = '') {
  return Object.fromEntries(
    Object.entries(report.source_sha256)
      .map(([file, hash]) => [relativeInput(file, sourceBase), hash])
      .filter(([file]) => !isConsumerTest(file)),
  );
}

export function changedInputs(previous, current) {
  return [...new Set([...Object.keys(previous), ...Object.keys(current)])]
    .filter((file) => previous[file] !== current[file])
    .sort();
}

export function isCritical(file) {
  return (
    /(?:^|\/)(?:migrations?|migration_catalog|keys|identity|local_lock|local_backup|local_restore|local_workspaces|vault|commands|lib)(?:[./_-]|$)/.test(
      file,
    ) ||
    /(?:^|\/)(?:money|revisions|scope|unit-scope|authorization|policy)(?:[./_-]|$)/.test(
      file,
    ) ||
    /^(?:pnpm-lock\.yaml|packages\/config\/|packages\/storage-schema\/|apps\/api\/persistence\/)/.test(
      file,
    )
  );
}

export function isGoverned(file) {
  if (isConsumerTest(file) || file.startsWith('infra/validation/'))
    return false;
  return (
    /^(?:apps\/|packages\/|infra\/|\.github\/workflows\/)/.test(file) ||
    /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json|eslint\.config\.mjs|\.node-version)$/.test(
      file,
    )
  );
}

export function selectSuites(states, { full = false } = {}) {
  return states.map((state) => ({
    ...state,
    selected: full || state.changed.length > 0,
    reason: full
      ? 'full'
      : state.changed.some(isCritical)
        ? 'critical'
        : state.changed.length
          ? 'inputs-changed'
          : 'unchanged',
  }));
}

export function safetyChanges(baselines, previousDigest, current) {
  const previous = baselines[previousDigest];
  if (
    !previous ||
    digest(JSON.stringify(Object.entries(previous).sort())) !== previousDigest
  )
    throw Error('VALIDATION_SAFETY_BASELINE_INVALID');
  return changedInputs(previous, current);
}

export const unclassifiedInputs = (previous, current, covered) =>
  changedInputs(previous, current).filter((file) => !covered.has(file));

export function safetyInputsFor(entry, inputs) {
  const desktop =
    entry.scope.endsWith('-windows') || entry.scope.endsWith('-browser');
  return Object.fromEntries(
    Object.entries(inputs).filter(
      ([file]) => !file.startsWith('apps/desktop/') || desktop,
    ),
  );
}
