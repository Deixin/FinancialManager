/* global structuredClone */
// Explicitly synthetic parity vectors, generated from the shared production Domain.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { planAccountChange } from '../../packages/domain/dist/index.js';
import { captureLocalAccountChange } from '../../apps/desktop/dist/local-accounts.js';
const workspace = '0199d040-0000-7000-8000-000000000001',
  now = '2026-10-17T12:00:00.000Z';
const id = (n) => '0199d040-0000-7000-8000-' + String(n).padStart(12, '0');
const create = () => ({
  kind: 'CREATE',
  account: {
    id: id(2),
    name: 'SYNTHETIC US040 ACCOUNT',
    institution_name: null,
    account_kind: 'CHECKING',
    balance_nature: 'ASSET',
    currency_code: 'BRL',
  },
  reference: {
    id: id(1002),
    amount_minor: '100000',
    reference_date: '2026-10-01',
    day_position: 'START_OF_DAY',
  },
});
const initial = planAccountChange(workspace, null, create(), now).state,
  vectors = [];
function vector(name, current, change) {
  current = structuredClone(current);
  change = structuredClone(change);
  let expected;
  try {
    expected = {
      plan: planAccountChange(
        workspace,
        current,
        captureLocalAccountChange(change, workspace),
        now,
      ),
    };
  } catch (error) {
    expected = {
      error: [
        'STALE_ACCOUNT',
        'REFERENCE_CONFLICT',
        'ACCOUNT_ARCHIVED',
        'ACCOUNT_NOT_FOUND',
      ].includes(error.code)
        ? error.code
        : 'INVALID_ACCOUNT_CHANGE',
    };
  }
  vectors.push({
    name,
    workspace_id: workspace,
    now,
    current,
    change,
    expected,
  });
}
vector('create_with_reference', null, create());
vector('replay_create', initial, create());
vector('optional_reference', null, { ...create(), reference: null });
for (const amount of [
  '9223372036854775807',
  '-9223372036854775808',
  '9007199254740993',
  '0',
])
  vector(
    'i64_' +
      (amount.startsWith('-') ? 'negative_' : '') +
      amount.replace('-', ''),
    null,
    { ...create(), reference: { ...create().reference, amount_minor: amount } },
  );
for (const kind of [
  'CHECKING',
  'SAVINGS',
  'DIGITAL',
  'CASH',
  'CREDIT_CARD',
  'INVESTMENT_SIMPLE',
  'LOAN_SIMPLE',
  'OTHER',
]) {
  const c = create();
  c.account.account_kind = kind;
  c.account.balance_nature = ['CREDIT_CARD', 'LOAN_SIMPLE'].includes(kind)
    ? 'LIABILITY'
    : 'ASSET';
  vector('kind_' + kind, null, c);
}
for (const name of [
  '  SYNTHETIC TRIM  ',
  '\ufeffSYNTHETIC BOM\ufeff',
  '😀'.repeat(60),
  '😀'.repeat(61),
  'SYNTHETIC\nCONTROL',
  ' ',
  'x'.repeat(121),
])
  vector('label_' + vectors.length, null, {
    ...create(),
    account: { ...create().account, name },
  });
for (const amount of [
  '01',
  '-0',
  '+1',
  '1.0',
  '1,0',
  '9223372036854775808',
  1,
  1.5,
  null,
])
  vector('invalid_money_' + vectors.length, null, {
    ...create(),
    reference: { ...create().reference, amount_minor: amount },
  });
for (const patch of [
  { currency_code: 'USD' },
  { balance_nature: 'LIABILITY' },
  { account_kind: 'UNKNOWN' },
  { institution_name: '' },
  { path: 'SYNTHETIC_PRIVATE' },
  { id: 'malformed' },
])
  vector('invalid_account_' + vectors.length, null, {
    ...create(),
    account: { ...create().account, ...patch },
  });
for (const patch of [
  { reference_date: '2026-02-30' },
  { reference_date: '2028-02-29' },
  { day_position: null },
  { day_position: 'UNKNOWN' },
  { id: id(2) },
])
  vector('reference_codec_' + vectors.length, null, {
    ...create(),
    reference: { ...create().reference, ...patch },
  });
const missing = create();
delete missing.reference;
vector('required_nullable_reference', null, missing);
const missingInstitution = create();
delete missingInstitution.account.institution_name;
vector('required_nullable_institution', null, missingInstitution);
const edit = {
  kind: 'UPDATE',
  base: initial.account,
  name: 'SYNTHETIC RENAMED',
  institution_name: 'SYNTHETIC BANK',
  status: 'ACTIVE',
};
vector('edit', initial, edit);
const edited = planAccountChange(workspace, initial, edit, now).state;
vector('edit_replay', edited, edit);
vector('stale_edit', edited, { ...edit, name: 'SYNTHETIC STALE' });
const archived = planAccountChange(
  workspace,
  initial,
  {
    ...edit,
    name: initial.account.name,
    institution_name: null,
    status: 'ARCHIVED',
  },
  now,
).state;
vector('archive', initial, { ...edit, status: 'ARCHIVED' });
vector('reactivate', archived, { ...edit, base: archived.account });
const legacy = structuredClone(initial);
legacy.account.name = '  SYNTHETIC LEGACY ' + 'x'.repeat(140) + '  ';
legacy.account.institution_name = 'SYNTHETIC LEGACY ' + 'y'.repeat(140);
vector('preserve_legacy_archive', legacy, {
  kind: 'UPDATE',
  base: legacy.account,
  name: legacy.account.name,
  institution_name: legacy.account.institution_name,
  status: 'ARCHIVED',
});
vector('correct_legacy', legacy, { ...edit, base: legacy.account });
vector('immutable_kind', initial, { ...edit, account_kind: 'SAVINGS' });
vector('foreign_base', initial, {
  ...edit,
  base: { ...initial.account, workspace_id: id(99) },
});
vector('missing_account', null, edit);
const correction = {
  kind: 'REFERENCE',
  account_id: id(2),
  reference: {
    id: id(1003),
    amount_minor: '9007199254740993',
    reference_date: '2026-10-02',
    day_position: 'END_OF_DAY',
  },
  replaces_id: id(1002),
};
vector('correct_reference', initial, correction);
const corrected = planAccountChange(workspace, initial, correction, now).state;
vector('replay_reference', corrected, correction);
vector('stale_reference', corrected, {
  ...correction,
  reference: { ...correction.reference, id: id(1004) },
});
vector('archived_reference', archived, correction);
vector('active_point_conflict', initial, {
  ...correction,
  replaces_id: null,
  reference: {
    ...correction.reference,
    reference_date: '2026-10-01',
    day_position: 'START_OF_DAY',
  },
});
vector('add_second_position', initial, {
  ...correction,
  replaces_id: null,
  reference: { ...correction.reference, reference_date: '2026-10-01' },
});
vector('self_reference_id', initial, { ...correction, replaces_id: id(1003) });
const later = planAccountChange(
  workspace,
  corrected,
  {
    ...correction,
    replaces_id: id(1003),
    reference: { ...correction.reference, id: id(1004), amount_minor: '1' },
  },
  now,
).state;
vector('replay_never_reactivates_old_reference', later, correction);
const file = new URL(
    '../../apps/desktop/src-tauri/fixtures/us040-accounts.json',
    import.meta.url,
  ),
  text =
    JSON.stringify(
      {
        format_version: 1,
        synthetic_only: true,
        source: 'shared-production-domain',
        vectors,
      },
      null,
      2,
    ) + '\n';
if (process.argv.includes('--check'))
  assert.equal(readFileSync(file, 'utf8'), text, 'ACCOUNT_VECTORS_STALE');
else writeFileSync(file, text);
console.log('US040_ACCOUNT_VECTORS: ' + vectors.length);
