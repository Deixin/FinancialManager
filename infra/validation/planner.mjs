import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, readCatalog, readRecord } from './evidence.mjs';
import {
  changedInputs,
  digest,
  isCritical,
  isGoverned,
  protocolSources,
  relativeInput,
  selectSuites,
  safetyChanges,
  unclassifiedInputs,
  safetyInputsFor,
} from './policy.mjs';

export async function loadProtocol(entry) {
  const validator = await import(
    pathToFileURL(path.join(root, relativeInput(entry.module))).href
  );
  const sourceModule = entry.sourceModule
    ? await import(
        pathToFileURL(path.join(root, relativeInput(entry.sourceModule))).href
      )
    : validator;
  if (
    typeof validator[entry.validator] !== 'function' ||
    typeof sourceModule[entry.hashes] !== 'function'
  )
    throw Error('PROTOCOL_EXPORT_INVALID');
  return {
    validate: validator[entry.validator],
    hashes: () => sourceModule[entry.hashes](...entry.sourceArgs),
  };
}

export function workingInventory(directory = root) {
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: directory, encoding: 'utf8', windowsHide: true },
  )
    .split('\0')
    .filter(Boolean);
  return Object.fromEntries(
    [...new Set(files)]
      .filter(isGoverned)
      .sort()
      .map((file) => [
        file,
        existsSync(path.join(directory, file))
          ? digest(readFileSync(path.join(directory, file)))
          : null,
      ]),
  );
}

export async function planValidation({ full = false } = {}) {
  const catalog = readCatalog();
  if (
    catalog.format_version !== 1 ||
    new Set(catalog.entries.map((e) => e.scope)).size !== catalog.entries.length
  )
    throw Error('VALIDATION_CATALOG_INVALID');
  if (
    new Set(catalog.entries.map((e) => e.alias)).size !== catalog.entries.length
  )
    throw Error('VALIDATION_ALIAS_DUPLICATE');
  const states = [];
  const covered = new Set();
  const currentCritical = {};
  for (const entry of catalog.entries) {
    if (
      !/^[a-z0-9-]+$/.test(entry.scope) ||
      !['browser', 'data', 'native'].includes(entry.kind) ||
      !Array.isArray(entry.command) ||
      !entry.command.length ||
      entry.command.some((arg) => typeof arg !== 'string') ||
      !relativeInput(entry.command[0]).startsWith('infra/') ||
      !entry.command[0].endsWith('.mjs') ||
      !relativeInput(entry.output).startsWith('.tools/')
    )
      throw Error('VALIDATION_PROTOCOL_CONFIG_INVALID');
    const report = readRecord(entry);
    const protocol = await loadProtocol(entry);
    // Historical shape/check validation is separate from current input matching.
    const previous = protocolSources(report, entry.sourceBase);
    const current = protocolSources(
      { source_sha256: protocol.hashes() },
      entry.sourceBase,
    );
    try {
      protocol.validate(report, { matchSources: false });
    } catch (error) {
      // An intact old execution may need a new format after its producer changes.
      // It is pending, never accepted as proof of the new behavior.
      if (!changedInputs(previous, current).length) throw error;
    }
    for (const [file, hash] of Object.entries(current))
      if (isCritical(file)) currentCritical[file] = hash;
    for (const file of [...Object.keys(previous), ...Object.keys(current)])
      covered.add(file);
    states.push({
      scope: entry.scope,
      changed: changedInputs(previous, current),
      current,
    });
  }
  for (const state of states) {
    const entry = catalog.entries.find((item) => item.scope === state.scope);
    state.changed = [
      ...new Set([
        ...state.changed,
        ...safetyChanges(
          catalog.safetyBaselines,
          entry.safety_digest,
          safetyInputsFor(entry, currentCritical),
        ),
      ]),
    ].sort();
  }
  const inventory = workingInventory();
  const unclassified = unclassifiedInputs(
    catalog.inventory,
    inventory,
    covered,
  );
  return {
    format_version: 1,
    unclassified,
    criticalInputs: currentCritical,
    suites: selectSuites(states, { full }),
  };
}

export async function assertCatalogCurrent() {
  const plan = await planValidation();
  if (plan.unclassified.length)
    throw Error(
      'VALIDATION_UNCLASSIFIED_INPUT: ' + plan.unclassified.join(', '),
    );
  const stale = plan.suites.filter((suite) => suite.selected);
  if (stale.length)
    throw Error(
      'VALIDATION_PROTOCOLS_PENDING: ' +
        stale.map((suite) => suite.scope).join(', '),
    );
  return plan;
}
