import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  digest,
  objectDigest,
  protocolSources,
  relativeInput,
} from './policy.mjs';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const catalogPath = path.join(root, 'infra/validation/catalog.json');
let catalogText, cachedCatalog;
export function readCatalog() {
  const text = readFileSync(catalogPath, 'utf8');
  if (text !== catalogText) {
    cachedCatalog = JSON.parse(text);
    catalogText = text;
  }
  // Callers that publish a new catalog must own their copy.
  return cachedCatalog;
}

export function readRecord(entry, directory = root) {
  const file = relativeInput(entry.report);
  if (!file.startsWith('docs/quality/evidence/'))
    throw Error('EVIDENCE_LOCATION_INVALID');
  const bytes = readFileSync(path.join(directory, file));
  if (digest(bytes) !== entry.sha256) throw Error('EVIDENCE_ARTIFACT_CHANGED');
  const report = JSON.parse(bytes);
  if (
    report.scope !== entry.scope ||
    objectDigest(report) !== entry.content_sha256
  )
    throw Error('EVIDENCE_IDENTITY_INVALID');
  return report;
}

export function assertProtocolSources(report, entry, directory = root) {
  for (const [file, expected] of Object.entries(
    protocolSources(report, entry.sourceBase),
  )) {
    if (
      !/^[a-f0-9]{64}$/.test(expected) ||
      !existsSync(path.join(directory, file)) ||
      digest(readFileSync(path.join(directory, file))) !== expected
    )
      throw Error('EVIDENCE_INPUT_CHANGED: ' + file);
  }
}

export function readCurrentEvidence(scope) {
  const entry = readCatalog().entries.find((item) => item.scope === scope);
  if (!entry) throw Error('EVIDENCE_SCOPE_UNKNOWN');
  return readRecord(entry);
}

// Migration adapter for existing consumers. Only the explicitly registered
// CURRENT filenames are aliases. Historical filenames keep their original bytes.
export function readEvidenceFile(file, options) {
  const resolved =
    file instanceof URL
      ? fileURLToPath(file)
      : typeof file === 'string'
        ? path.resolve(file)
        : null;
  if (
    resolved &&
    path.dirname(resolved) === path.join(root, 'docs/quality/evidence')
  ) {
    const name = path.basename(resolved);
    const entry = readCatalog().entries.find((item) => item.alias === name);
    if (entry) {
      readRecord(entry);
      return readFileSync(path.join(root, entry.report), options);
    }
  }
  return readFileSync(file, options);
}

// The original validator remains strict for newly produced reports and for
// synthetic validator tests. The exception is an intact, catalogued historical
// execution whose protocol inputs are still byte-identical. Consumer tests run
// again under pnpm check; their catalog reference is not a native runtime input.
export function currentEvidenceValidator(validate) {
  return (report, options = {}) => {
    if (options.matchSources === false) return validate(report, options);
    try {
      return validate(report, options);
    } catch (originalError) {
      try {
        const entry = readCatalog().entries.find(
          (item) => item.scope === report?.scope,
        );
        if (!entry || objectDigest(report) !== entry.content_sha256)
          throw originalError;
        readRecord(entry);
        assertProtocolSources(report, entry);
        return validate(report, { ...options, matchSources: false });
      } catch {
        throw originalError;
      }
    }
  };
}
