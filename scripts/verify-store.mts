/**
 * Pure-Node store verification. Runs with `tsx` (already a devDependency)
 * against the TypeScript source directly. No browser, no playwright, no
 * dev server needed — works in any sandbox that has Node + tsx.
 *
 * Run with:
 *   node_modules/tsx/dist/cli.mjs --tsconfig ./tsconfig.app.json \
 *     scripts/verify-store.mts
 *
 * Or after the `npx tsx` is wired (future): `npx tsx scripts/verify-store.mts`
 *
 * Covers:
 *   • phase 3.2 — drag commit-on-release (5 invariants)
 *   • phase 4a  — collider + refit nonce + sidebar (10 invariants)
 */
import { useEditor } from '@/store/editor';
import type { ColliderType } from '@/lib/formats';

const RESULTS: Array<{ name: string; pass: boolean; detail?: string }> = [];

function check(name: string, cond: boolean, detail?: string): void {
  RESULTS.push({ name, pass: cond, detail });
}

function eq<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ─── Phase 3.2: drag commit-on-release ──────────────────────────────
console.log('── phase 3.2: drag commit-on-release ──');

// Reset history for a clean baseline.
useEditor.getState().resetHistoryForTest();
useEditor.getState().addPrimitive('cube');
const cubeId = useEditor.getState().activeAssetId!;
const cubeAsset = useEditor.getState().assets.find((a) => a.id === cubeId)!;

// Test 1: 60-frame drag → exactly 1 history entry.
{
  const pastBefore = useEditor.getState().history.past.length;
  const pre = useEditor.getState().assets;
  for (let i = 1; i <= 60; i++) {
    useEditor.getState().setAssetTransformLive(cubeId, {
      ...cubeAsset.transform,
      position: [i * 0.05, i * 0.02, 0],
    });
  }
  useEditor.getState().commitTransformDrag(pre);
  const grew = useEditor.getState().history.past.length - pastBefore;
  check('1. 60-frame drag → exactly 1 history entry', grew === 1, `grew=${grew}`);
}

// Test 2: no-op drag (no live updates) → 0 history entries.
{
  useEditor.getState().resetHistoryForTest();
  useEditor.getState().addPrimitive('sphere');
  const id = useEditor.getState().activeAssetId!;
  const pastBefore = useEditor.getState().history.past.length;
  const pre = useEditor.getState().assets;
  useEditor.getState().commitTransformDrag(pre);
  const grew = useEditor.getState().history.past.length - pastBefore;
  check('2. no-op drag (click without movement) → 0 entries', grew === 0, `grew=${grew}`);
}

// Test 3: single ⌘Z reverts entire drag.
{
  useEditor.getState().resetHistoryForTest();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  const asset = useEditor.getState().assets.find((a) => a.id === id)!;
  const pre = useEditor.getState().assets;
  for (let i = 1; i <= 30; i++) {
    useEditor.getState().setAssetTransformLive(id, {
      ...asset.transform,
      position: [i * 0.1, 0, 0],
    });
  }
  useEditor.getState().commitTransformDrag(pre);
  useEditor.getState().undo();
  const pos = useEditor.getState().assets.find((a) => a.id === id)!.transform.position;
  check(
    '3. single ⌘Z reverts entire drag',
    pos[0] === 0 && pos[1] === 0 && pos[2] === 0,
    `pos=${JSON.stringify(pos)}`,
  );
}

// Test 4: external setAssetTransform (reset button) still pushes 1 entry.
{
  useEditor.getState().resetHistoryForTest();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  const pastBefore = useEditor.getState().history.past.length;
  useEditor.getState().setAssetTransform(id, {
    position: [5, 0, 0],
    rotation: [0, 0, 0, 'XYZ'],
    scale: [1, 1, 1],
  });
  const grew = useEditor.getState().history.past.length - pastBefore;
  check('4. external setAssetTransform → 1 history entry', grew === 1, `grew=${grew}`);
}

// Test 5: drag commit clears redo stack.
{
  useEditor.getState().resetHistoryForTest();
  useEditor.getState().addPrimitive('cube');
  useEditor.getState().addPrimitive('sphere');
  useEditor.getState().undo();
  const futureBefore = useEditor.getState().history.future.length;
  const id = useEditor.getState().activeAssetId!;
  const asset = useEditor.getState().assets.find((a) => a.id === id)!;
  const pre = useEditor.getState().assets;
  useEditor.getState().setAssetTransformLive(id, {
    ...asset.transform,
    position: [1, 0, 0],
  });
  useEditor.getState().commitTransformDrag(pre);
  const futureAfter = useEditor.getState().history.future.length;
  check(
    '5. drag commit clears redo stack',
    futureBefore === 1 && futureAfter === 0,
    `before=${futureBefore} after=${futureAfter}`,
  );
}

// ─── Phase 4a: collider + refit nonce ───────────────────────────────
console.log('\n── phase 4a: collider + refit nonce ──');

// Test 6: addAsset bumps refitRequestNonce.
{
  useEditor.getState().resetHistoryForTest();
  const before = useEditor.getState().refitRequestNonce;
  useEditor.getState().addPrimitive('cube');
  const after = useEditor.getState().refitRequestNonce;
  check('6. addAsset bumps refitRequestNonce', after - before === 1, `${before}→${after}`);
}

// Test 7: addPrimitive also bumps refitRequestNonce (it builds the
// asset inline rather than going through addAsset).
{
  useEditor.getState().resetHistoryForTest();
  const before = useEditor.getState().refitRequestNonce;
  useEditor.getState().addPrimitive('sphere');
  const after = useEditor.getState().refitRequestNonce;
  check('7. addPrimitive bumps refitRequestNonce', after - before === 1, `${before}→${after}`);
}

// Test 8: setActiveAsset does NOT bump refitRequestNonce.
{
  useEditor.getState().resetHistoryForTest();
  useEditor.getState().addPrimitive('cube');
  useEditor.getState().addPrimitive('sphere');
  const nonce1 = useEditor.getState().refitRequestNonce;
  const sphereId = useEditor.getState().assets[1].id;
  useEditor.getState().setActiveAsset(sphereId);
  const nonce2 = useEditor.getState().refitRequestNonce;
  check('8. setActiveAsset does NOT refit', nonce2 === nonce1, `${nonce1}→${nonce2}`);
}

// Test 9: removeAsset does NOT bump refitRequestNonce.
{
  useEditor.getState().resetHistoryForTest();
  useEditor.getState().addPrimitive('cube');
  useEditor.getState().addPrimitive('sphere');
  const nonce1 = useEditor.getState().refitRequestNonce;
  const sphereId = useEditor.getState().assets[1].id;
  useEditor.getState().removeAsset(sphereId);
  const nonce2 = useEditor.getState().refitRequestNonce;
  check('9. removeAsset does NOT refit', nonce2 === nonce1, `${nonce1}→${nonce2}`);
}

// Test 10: setAssetCollider round-trips all 4 types.
{
  useEditor.getState().resetHistoryForTest();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  const types: ColliderType[] = ['box', 'sphere', 'capsule', 'cylinder'];
  const results: Array<[ColliderType, ColliderType | undefined]> = [];
  for (const type of types) {
    useEditor.getState().setAssetCollider(id, { type });
    const a = useEditor.getState().assets.find((x) => x.id === id)!;
    results.push([type, a.collider?.type]);
  }
  const allMatch = results.every(([t, p]) => p === t);
  check(
    '10. setAssetCollider round-trips all 4 collider types',
    allMatch,
    results.map(([t, p]) => `${t}→${p}`).join(', '),
  );
}

// Test 11: setAssetCollider pushes 1 history entry.
{
  useEditor.getState().resetHistoryForTest();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  const pastBefore = useEditor.getState().history.past.length;
  useEditor.getState().setAssetCollider(id, { type: 'cylinder' });
  const grew = useEditor.getState().history.past.length - pastBefore;
  check('11. setAssetCollider → 1 history entry', grew === 1, `grew=${grew}`);
}

// Test 12: setAssetCollider(null) clears.
{
  useEditor.getState().resetHistoryForTest();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id, { type: 'box' });
  useEditor.getState().setAssetCollider(id, null);
  const a = useEditor.getState().assets.find((x) => x.id === id)!;
  check('12. setAssetCollider(null) clears', a.collider === null);
}

// Test 13: undo/redo round-trip on collider.
{
  useEditor.getState().resetHistoryForTest();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id, { type: 'box' });
  useEditor.getState().setAssetCollider(id, { type: 'sphere' });
  useEditor.getState().undo();
  const afterUndo = useEditor.getState().assets.find((x) => x.id === id)!.collider;
  useEditor.getState().undo();
  const afterUndo2 = useEditor.getState().assets.find((x) => x.id === id)!.collider;
  useEditor.getState().redo();
  const afterRedo1 = useEditor.getState().assets.find((x) => x.id === id)!.collider;
  useEditor.getState().redo();
  const afterRedo2 = useEditor.getState().assets.find((x) => x.id === id)!.collider;
  check(
    '13. undo/redo round-trip on collider',
    afterUndo?.type === 'box' &&
      afterUndo2 === null &&
      afterRedo1?.type === 'box' &&
      afterRedo2?.type === 'sphere',
    `undo:${afterUndo?.type}→${afterUndo2} redo:${afterRedo1?.type}→${afterRedo2?.type}`,
  );
}

// Test 14: refit nonce combined with F-key refit (UI side composes
// them, so the store just needs to expose the nonce).
{
  useEditor.getState().resetHistoryForTest();
  const initial = useEditor.getState().refitRequestNonce;
  useEditor.getState().addPrimitive('cube');
  useEditor.getState().addPrimitive('sphere');
  useEditor.getState().addPrimitive('cylinder');
  const after3 = useEditor.getState().refitRequestNonce;
  check('14. refitRequestNonce monotonically increases on add', after3 === initial + 3, `${initial}→${after3}`);
}

// Test 15: mode change does NOT bump refitRequestNonce (only adds do).
{
  useEditor.getState().resetHistoryForTest();
  useEditor.getState().addPrimitive('cube');
  const nonce1 = useEditor.getState().refitRequestNonce;
  useEditor.getState().setMode('collision');
  useEditor.getState().setMode('gaussian');
  useEditor.getState().setMode('mesh');
  const nonce2 = useEditor.getState().refitRequestNonce;
  check('15. setMode does NOT refit', nonce2 === nonce1, `${nonce1}→${nonce2}`);
}

// ─── Summary ────────────────────────────────────────────────────────
const passed = RESULTS.filter((r) => r.pass).length;
const failed = RESULTS.length - passed;

console.log('\n── results ──');
for (const r of RESULTS) {
  const icon = r.pass ? '✓' : '✗';
  const detail = r.detail ? ` (${r.detail})` : '';
  console.log(`  ${icon} ${r.name}${detail}`);
}
console.log(`\n${passed}/${RESULTS.length} pass`);

if (failed > 0) {
  console.error(`\n❌ ${failed} FAIL`);
  process.exit(1);
}
console.log(`\n✅ ALL PASS`);
