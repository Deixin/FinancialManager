/* global structuredClone */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  captureLocalClassification,
  classificationEdit,
  decodeClassificationResult,
  verifyClassificationRead,
  localClassificationMessage,
} from '../../apps/desktop/dist/local-classification.js';
import { decodeClassificationSnapshot } from '../../apps/desktop/dist/local-classification-filters.js';
import { classificationChange } from '../../packages/domain/dist/classification.js';
import {
  editorSnapshot,
  syntheticEditorHost,
  workspace as w,
  id,
} from '../classification-desktop/fixture.mjs';
import {
  validateDesktopClassificationEvidence,
  browserChecks,
  nativeChecks,
} from '../classification-desktop/evidence.mjs';
const command = (n = 102) => {
    const base = editorSnapshot().transactions.find((r) => r.id === id(n));
    return {
      base,
      classification: {
        kind: 'SET',
        allocation_id: base.content.allocations[0]?.id ?? id(n + 500),
        category_id: id(10),
        subcategory_id: id(20),
      },
      tag_ids: base.content.tag_ids,
    };
  },
  snapshot = (h) => decodeClassificationSnapshot(h.read(w), w);
test('Desktop classification vectors are reproducible from the shared service and include imported split group archived and unknown-field cases', () => {
  assert.equal(
    spawnSync(
      process.execPath,
      ['infra/classification-desktop/generate.mjs', '--check'],
      { encoding: 'utf8', windowsHide: true },
    ).status,
    0,
  );
  const f = JSON.parse(
    readFileSync('apps/desktop/src-tauri/fixtures/us045-classification.json'),
  );
  assert.equal(f.synthetic_only, true);
  assert.equal(f.vectors.length, 58);
  for (const name of [
    'keep_extra_selection',
    'paired_transfer',
    'paired_card',
    'split_set_rejected',
    'archive_kept',
  ])
    assert.ok(f.vectors.some((v) => v.name === name));
});
test('Classification transport captures complete bases and IDs and refuses extras foreign scope duplicates oversize and non-v7 new allocations', () => {
  const c = command(),
    value = captureLocalClassification([c], w);
  c.base.content.display_name = 'SYNTHETIC MUTATED';
  c.tag_ids.push(id(30));
  assert.notEqual(
    value[0].base.content.display_name,
    c.base.content.display_name,
  );
  assert.ok(Object.isFrozen(value[0].base.content));
  for (const input of [
    [],
    [command(), command()],
    [{ ...command(), actor_type: 'SYSTEM' }],
    [{ ...command(), base: { ...command().base, workspace_id: id(999) } }],
    [{ ...command(), tag_ids: [id(30), id(30)] }],
    [
      {
        ...command(),
        classification: {
          ...command().classification,
          allocation_id: '4b871fc7-f700-430b-a236-5c7212d74c90',
        },
      },
    ],
    Array(257).fill(command()),
  ])
    assert.throws(() => captureLocalClassification(input, w), {
      code: 'INVALID_CLASSIFICATION',
    });
  const large = command();
  large.base.content.display_name = 'x'.repeat(4 * 1024 * 1024);
  assert.throws(() => captureLocalClassification([large], w), {
    code: 'INVALID_CLASSIFICATION',
  });
});
test('Editor intents include the complete paired operation while splits only permit tags with KEEP', () => {
  const s = decodeClassificationSnapshot(editorSnapshot(), w),
    set = command(104).classification,
    pair = classificationEdit(s, id(104), set, [id(30)]);
  assert.equal(pair.length, 2);
  assert.equal(
    pair.find((c) => c.base.id === id(105)).classification.kind,
    'KEEP',
  );
  assert.deepEqual(
    pair.find((c) => c.base.id === id(105)).tag_ids,
    s.movements.transactions.find((r) => r.id === id(105)).content.tag_ids,
  );
  const split = classificationEdit(s, id(100), { kind: 'KEEP' }, []);
  assert.deepEqual(
    classificationChange(split[0]).content.allocations,
    split[0].base.content.allocations,
  );
  assert.throws(() => classificationEdit(s, id(100), { kind: 'CLEAR' }, []), {
    code: 'CLASSIFICATION_SPLIT_REVIEW_REQUIRED',
  });
  const partial = {
    ...s,
    movements: {
      ...s.movements,
      transactions: s.movements.transactions.filter((r) => r.id !== id(105)),
    },
  };
  assert.throws(() => classificationEdit(partial, id(104), set, []), {
    code: 'COMPOSITE_REQUIRED',
  });
});
test('Single allocation uses exact i64 magnitude and preserves notes while zero and minimum i64 allow KEEP tags only', () => {
  const c = command(106);
  c.classification = {
    ...c.classification,
    category_id: id(12),
    subcategory_id: id(22),
  };
  const expected = classificationChange(captureLocalClassification([c], w)[0]);
  assert.equal(
    expected.content.allocations[0].amount_minor,
    '9007199254740993',
  );
  assert.equal(
    expected.content.allocations[0].note,
    c.base.content.allocations[0].note,
  );
  for (const amount of ['0', '-9223372036854775808']) {
    const b = command();
    b.base.content.account_amount_minor = amount;
    b.base.content.economic_kind = 'ADJUSTMENT';
    assert.throws(() => captureLocalClassification([b], w), {
      code: 'CLASSIFICATION_AMOUNT_UNSUPPORTED',
    });
    assert.equal(
      captureLocalClassification(
        [{ ...b, classification: { kind: 'KEEP' } }],
        w,
      )[0].base.content.account_amount_minor,
      amount,
    );
  }
});
test('Acknowledgements and follow-up reads must match changed flags versions immutable content and complete history', async () => {
  const h = syntheticEditorHost(),
    commands = captureLocalClassification([command()], w),
    raw = await h.apply(w, commands),
    entries = decodeClassificationResult(raw, commands),
    next = snapshot(h);
  verifyClassificationRead(next, commands, entries);
  for (const mutate of [
    (r) => {
      r.entries = [];
    },
    (r) => {
      r.extra = true;
    },
    (r) => {
      r.entries[0].changed = false;
    },
    (r) => {
      r.entries[0].version = '999';
    },
    (r) => {
      r.entries[0].revision_id = id(1).replace('7000', '4000');
    },
    (r) => {
      r.entries.push(r.entries[0]);
    },
  ]) {
    const bad = structuredClone(raw);
    mutate(bad);
    assert.throws(() => decodeClassificationResult(bad, commands), {
      code: 'INVALID_RESPONSE',
    });
  }
  const corrupt = structuredClone(next);
  corrupt.movements.transactions.find(
    (r) => r.id === commands[0].base.id,
  ).content.original_description = 'SYNTHETIC FORGED';
  assert.throws(() => verifyClassificationRead(corrupt, commands, entries), {
    code: 'INVALID_RESPONSE',
  });
  const missing = structuredClone(next);
  missing.movements.history = [];
  assert.throws(() => verifyClassificationRead(missing, commands, entries), {
    code: 'INVALID_RESPONSE',
  });
});
test('Import classification preserves provenance and CLEAR and no-op keep their exact audit contract', async () => {
  const h = syntheticEditorHost(),
    commands = captureLocalClassification([command()], w),
    first = await h.apply(w, commands);
  decodeClassificationResult(first, commands);
  const changed = snapshot(h).movements.transactions.find(
    (r) => r.id === id(102),
  );
  assert.equal(changed.content.origin_kind, 'IMPORT');
  assert.equal(
    changed.content.original_description,
    commands[0].base.content.original_description,
  );
  const count = h.read(w).history.length,
    keep = captureLocalClassification(
      [
        {
          base: changed,
          classification: { kind: 'KEEP' },
          tag_ids: changed.content.tag_ids,
        },
      ],
      w,
    ),
    noop = decodeClassificationResult(await h.apply(w, keep), keep);
  assert.equal(noop[0].changed, false);
  assert.equal(noop[0].revision_id, null);
  assert.equal(h.read(w).history.length, count);
  verifyClassificationRead(snapshot(h), keep, noop);
  const clear = captureLocalClassification(
      [
        {
          base: changed,
          classification: { kind: 'CLEAR' },
          tag_ids: changed.content.tag_ids,
        },
      ],
      w,
    ),
    r = decodeClassificationResult(await h.apply(w, clear), clear);
  verifyClassificationRead(snapshot(h), clear, r);
  assert.equal(
    snapshot(h).movements.transactions.find((r) => r.id === id(102)).content
      .allocations.length,
    0,
  );
});
test('Version conflicts archived new references and retained archived references follow the shared guarded writer', async () => {
  const h = syntheticEditorHost(),
    commands = captureLocalClassification([command()], w);
  await h.apply(w, commands);
  await assert.rejects(h.apply(w, commands), { code: 'VERSION_CONFLICT' });
  const s = snapshot(h),
    archived = s.movements.transactions.find((r) => r.id === id(106));
  await h.apply(
    w,
    captureLocalClassification(
      [
        {
          base: archived,
          classification: { kind: 'KEEP' },
          tag_ids: archived.content.tag_ids,
        },
      ],
      w,
    ),
  );
  const c = command(101);
  c.classification = {
    ...c.classification,
    category_id: id(12),
    subcategory_id: id(22),
  };
  await assert.rejects(h.apply(w, captureLocalClassification([c], w)), {
    code: 'CLASSIFICATION_REFERENCE_UNAVAILABLE',
  });
  assert.ok(
    !localClassificationMessage(Error('SYNTHETIC_PRIVATE_CANARY')).includes(
      'CANARY',
    ),
  );
});
test('Both paired kinds preserve money and partner versions and invalid second plans roll back every audit', async () => {
  for (const n of [104, 107]) {
    const h = syntheticEditorHost(),
      s = snapshot(h),
      selected = s.movements.transactions.find((r) => r.id === id(n)),
      partner = s.movements.transactions.find(
        (r) =>
          r.content.group_id === selected.content.group_id &&
          r.id !== selected.id,
      ),
      commands = classificationEdit(s, id(n), command(n).classification, []);
    const entries = decodeClassificationResult(
        await h.apply(w, commands),
        commands,
      ),
      next = snapshot(h);
    verifyClassificationRead(next, commands, entries);
    assert.deepEqual(
      next.movements.transactions.find((r) => r.id === partner.id),
      partner,
    );
    assert.equal(entries.filter((r) => r.changed).length, 1);
    for (const before of s.movements.transactions) {
      const after = next.movements.transactions.find((r) => r.id === before.id);
      assert.equal(
        after.content.account_amount_minor,
        before.content.account_amount_minor,
      );
      assert.equal(after.content.economic_kind, before.content.economic_kind);
    }
    const fresh = syntheticEditorHost(),
      bad = structuredClone(commands);
    bad.find((c) => c.base.id === partner.id).tag_ids = [id(999)];
    const prior = JSON.stringify(fresh.read(w));
    await assert.rejects(fresh.apply(w, bad), {
      code: 'CLASSIFICATION_REFERENCE_UNAVAILABLE',
    });
    assert.equal(JSON.stringify(fresh.read(w)), prior);
  }
});
test('Native classification is a specific 28th command and composes the existing revision writer and atomic guards', () => {
  const capability = JSON.parse(
    readFileSync('apps/desktop/src-tauri/capabilities/entry-main.json'),
  );
  assert.equal(capability.permissions.length, 28);
  assert.equal(
    capability.permissions.at(-1),
    'allow-apply-local-classification-change',
  );
  const source = readFileSync(
    'apps/desktop/src-tauri/src/local_classification.rs',
    'utf8',
  );
  assert.match(source, /TransactionBehavior::Immediate/);
  assert.match(source, /local_movements::save/);
  assert.match(source, /validate_groups/);
  for (const file of ['transfer_model.rs', 'card_payment_model.rs'])
    assert.doesNotMatch(
      readFileSync('apps/desktop/src-tauri/src/' + file, 'utf8'),
      /fn revision\(/,
    );
  const frontend = readFileSync(
    'apps/desktop/src/local-classification.ts',
    'utf8',
  );
  assert.doesNotMatch(
    frontend,
    /localStorage|sessionStorage|indexedDB|fetch\(/,
  );
});
test('Desktop classification evidence requires every actual browser Windows fault restore and cleanup gate', () => {
  for (const kind of ['browser', 'windows']) {
    const r = JSON.parse(
      readFileSync(
        'docs/quality/evidence/us-045-desktop-classification-' +
          kind +
          '-2026-10-18-us046-allocations.json',
      ),
    );
    assert.equal(
      validateDesktopClassificationEvidence(r, { matchSources: false }).passed,
      true,
    );
    for (const name of kind === 'browser' ? browserChecks : nativeChecks) {
      const bad = structuredClone(r);
      delete bad.checks[name];
      assert.throws(() =>
        validateDesktopClassificationEvidence(bad, { matchSources: false }),
      );
    }
    assert.throws(() =>
      validateDesktopClassificationEvidence(
        { ...r, financial_payload: 'SYNTHETIC' },
        { matchSources: false },
      ),
    );
  }
});
