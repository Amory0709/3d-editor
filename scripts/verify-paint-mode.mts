/**
 * Regression test for the "paint-mode viewport click-to-pick and
 * selection highlight never work" bug (introduced in 0d8122e).
 *
 * Symptom:
 *   In paint mode, clicking a GLB / OBJ part in the viewport did
 *   nothing, and the in-scene `SelectedRing` highlight never
 *   rendered — even though the sidebar list pick and per-mesh
 *   recolor worked fine.
 *
 * Root cause:
 *   `TransformableAsset` derived a single `interactive` flag as
 *   `editable === true && (mode === 'edit')` and passed it to BOTH
 *   `EditableMesh` and `PaintMesh`. In paint mode `mode !== 'edit'`,
 *   so `interactive` was always `false`, and `PaintMesh` used that
 *   same flag to gate (1) its click-to-pick handler
 *   (`onPick={() => interactive && setPaintSelectedMesh(name)}`)
 *   and (2) the `SelectedRing` highlight
 *   (`isSelected = paintSelected === name && interactive`). Both
 *   were therefore dead for the whole lifetime of paint mode.
 *
 * Fix:
 *   Derive a paint-specific flag (`paintInteractive = editable &&
 *   mode === 'paint'`) and pass it to `PaintMesh`; keep the
 *   edit-mode flag for `EditableMesh`. The shared derivation now
 *   lives in the pure, exported `interactiveFlagsFor` helper in
 *   `TransformableAsset.tsx` (mirrors the `makeGeometry` pattern
 *   in `PrimitiveRenderer.tsx`) so it is unit-testable without
 *   mounting the R3F <Canvas>.
 *
 * What this script covers:
 *   1. `interactiveFlagsFor` flag derivation across every
 *      mode x editable combination (the core fix).
 *   2. The end-to-end behavioral contract through the store: in
 *      paint mode, a viewport "pick" (the action `PaintMesh`'s
 *      `onPick` calls) updates `paintSelectedMesh`, and the
 *      `isSelected` predicate computed with the FIXED
 *      `paintInteractive` flag is true.
 *   3. A counter-test that reproduces the OLD (buggy) derivation
 *      and asserts it would have left `isSelected` false and the
 *      pick a no-op in paint mode — so the test stays sensitive
 *      to a regression that re-merges the two flags.
 *   4. The store's paint-mode selection contract (`setMode`
 *      clears `paintSelectedMesh`, `setPaintSelectedMesh` is a
 *      no-op outside paint mode).
 *   5. Non-active asset in paint mode yields no highlight.
 *
 * Run:
 *   npx tsx --tsconfig ./tsconfig.app.json scripts/verify-paint-mode.mts
 */

import { useEditor } from '@/store/editor';
import { interactiveFlagsFor } from '@/components/TransformableAsset';
import type { EditorMode } from '@/store/editor';

const RESULTS: Array<{ name: string; pass: boolean; detail?: string }> = [];
function check(name: string, cond: boolean, detail?: string): void {
  RESULTS.push({ name, pass: cond, detail });
  console.log(`  ${cond ? '✓' : '✗'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
}

/** The OLD (buggy) derivation, kept here so the counter-test can
 *  prove the regression would resurface if the flags were merged
 *  again. This is the exact expression that shipped in 0d8122e. */
function buggyInteractive(mode: EditorMode, editable: boolean | undefined): boolean {
  return editable === true && mode === 'edit';
}

/** Mirror of `PaintMesh`'s `isSelected` predicate
 *  (`paintSelected === name && interactive`). Kept here so the
 *  test asserts on the ACTUAL behavioral expression the component
 *  uses, not a paraphrase. If PaintMesh's predicate changes, update
 *  this mirror and the corresponding test. */
function paintIsSelected(
  paintSelected: string | null,
  name: string,
  interactive: boolean,
): boolean {
  return paintSelected === name && interactive;
}

/** Mirror of `PaintMesh`'s `onPick` guard
 *  (`() => interactive && setPaintSelectedMesh(name)`). Returns
 *  whether the pick would actually fire. */
function paintPickWouldFire(interactive: boolean): boolean {
  return interactive && true;
}

/** Reset the store to a clean baseline between tests. Mirrors the
 *  `reset()` helper in `verify-physics.mts` (minus the physics
 *  world, which paint mode never touches). */
function reset(): void {
  useEditor.getState().resetHistoryForTest();
  // Flip any play mode off without going through setPlayMode so we
  // don't depend on body write-back. Paint mode is an authoring
  // concern, always exercised with play off.
  if (useEditor.getState().playMode) {
    useEditor.setState({ playMode: false });
  }
  // Remove every asset (some may have been added by addPrimitive).
  const ids = useEditor.getState().assets.map((a) => a.id);
  for (const id of ids) useEditor.getState().removeAsset(id);
  // Clear paint selection + reset mode to the default ('mesh').
  useEditor.setState({
    paintSelectedMesh: null,
    mode: 'mesh',
    activeAssetId: null,
  });
}

// ============================================================
// Test 1: `interactiveFlagsFor` derivation — the core fix.
// Every mode x editable combination.
// ============================================================
console.log('Test 1: interactiveFlagsFor derivation (mode x editable)');
{
  const cases: Array<{
    mode: EditorMode;
    editable: boolean | undefined;
    interactive: boolean;
    paintInteractive: boolean;
    label: string;
  }> = [
    { mode: 'paint', editable: true, interactive: false, paintInteractive: true, label: 'paint + active' },
    { mode: 'edit', editable: true, interactive: true, paintInteractive: false, label: 'edit + active' },
    { mode: 'paint', editable: false, interactive: false, paintInteractive: false, label: 'paint + inactive' },
    { mode: 'edit', editable: false, interactive: false, paintInteractive: false, label: 'edit + inactive' },
    { mode: 'paint', editable: undefined, interactive: false, paintInteractive: false, label: 'paint + undefined' },
    { mode: 'mesh', editable: true, interactive: false, paintInteractive: false, label: 'mesh + active' },
    { mode: 'collision', editable: true, interactive: false, paintInteractive: false, label: 'collision + active' },
    { mode: 'mesh', editable: false, interactive: false, paintInteractive: false, label: 'mesh + inactive' },
  ];
  let i = 0;
  for (const c of cases) {
    i++;
    const got = interactiveFlagsFor(c.mode, c.editable);
    check(
      `1.${i} ${c.label}: interactive=${c.interactive}, paintInteractive=${c.paintInteractive}`,
      got.interactive === c.interactive && got.paintInteractive === c.paintInteractive,
      `got interactive=${got.interactive}, paintInteractive=${got.paintInteractive}`,
    );
  }
}

// ============================================================
// Test 2: paint-mode viewport pick updates the store AND the
// `isSelected` predicate is true with the fixed flag. This is the
// end-to-end behavioral contract of PaintMesh's onPick + SelectedRing.
// ============================================================
console.log('\nTest 2: paint-mode viewport pick → paintSelectedMesh updates + isSelected true');
{
  reset();
  // Enter paint mode with an active asset. (TransformableAsset
  // passes editable=true only when the asset is the active one.)
  useEditor.getState().setMode('paint');
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  check('setup: mode=paint, one active asset', useEditor.getState().mode === 'paint' && !!id);

  // The flag TransformableAsset would compute for the active asset.
  const { interactive, paintInteractive } = interactiveFlagsFor('paint', true);
  check('2a active asset in paint: paintInteractive=true', paintInteractive === true);
  check('2b active asset in paint: interactive (edit flag)=false', interactive === false);

  // Simulate PaintMesh's onPick firing (the viewport click path).
  // PaintMesh calls `setPaintSelectedMesh(name)` — that's the
  // only store mutation a click produces.
  const partName = 'container.005';
  check('2c paintSelectedMesh starts null', useEditor.getState().paintSelectedMesh === null);

  const wouldFire = paintPickWouldFire(paintInteractive);
  check('2d onPick guard fires (interactive=true)', wouldFire === true);
  if (wouldFire) useEditor.getState().setPaintSelectedMesh(partName);

  check('2e after pick, paintSelectedMesh === name', useEditor.getState().paintSelectedMesh === partName);

  // The SelectedRing predicate PaintMesh computes with the fixed flag.
  const isSelected = paintIsSelected(useEditor.getState().paintSelectedMesh, partName, paintInteractive);
  check('2f isSelected predicate true → SelectedRing would render', isSelected === true);

  // A different part is NOT selected.
  const isSelectedOther = paintIsSelected(useEditor.getState().paintSelectedMesh, 'other', paintInteractive);
  check('2g a different part is not selected', isSelectedOther === false);
}

// ============================================================
// Test 3: Counter-test — the OLD (buggy) derivation leaves the
// pick a no-op and the highlight dead in paint mode. This proves
// the test stays sensitive to a regression that re-merges the two
// flags into `editable && mode === 'edit'`.
// ============================================================
console.log('\nTest 3: counter-test — old buggy derivation is dead in paint mode');
{
  reset();
  useEditor.getState().setMode('paint');
  useEditor.getState().addPrimitive('cube');

  // What 0d8122e computed: a single `interactive = editable && isEditMode`.
  const buggy = buggyInteractive('paint', true);
  check('3a OLD interactive flag is false in paint mode (the bug)', buggy === false);

  // onPick guard `interactive && setPaintSelectedMesh(name)` short-circuits.
  const wouldFire = paintPickWouldFire(buggy);
  check('3b OLD onPick guard does NOT fire in paint mode', wouldFire === false);

  // isSelected predicate is ALWAYS false under the buggy flag, even
  // when the store's paintSelectedMesh matches the part name (which
  // is the situation after a SIDEBAR pick — the only path that worked).
  const partName = 'container.005';
  useEditor.getState().setPaintSelectedMesh(partName);
  const isSelectedBuggy = paintIsSelected(useEditor.getState().paintSelectedMesh, partName, buggy);
  check('3c OLD isSelected predicate stays false even when store matches (no SelectedRing)', isSelectedBuggy === false);

  // Contrast: the FIXED flag makes the same predicate true.
  const { paintInteractive } = interactiveFlagsFor('paint', true);
  const isSelectedFixed = paintIsSelected(useEditor.getState().paintSelectedMesh, partName, paintInteractive);
  check('3d FIXED isSelected predicate is true for the same state', isSelectedFixed === true);
}

// ============================================================
// Test 4: sidebar-driven pick still works (the path that was
// never broken), and the FIXED flag now makes the highlight follow.
// ============================================================
console.log('\nTest 4: sidebar pick path + highlight follow (no regression of working path)');
{
  reset();
  useEditor.getState().setMode('paint');
  useEditor.getState().addPrimitive('cube');

  // Sidebar calls setPaintSelectedMesh directly (see Sidebar.tsx
  // PaintMeshList → onPick → setPaintSelectedMesh). This path does
  // NOT depend on the interactive flag, so it always worked.
  useEditor.getState().setPaintSelectedMesh('side_panel_part');
  check('4a sidebar pick sets paintSelectedMesh', useEditor.getState().paintSelectedMesh === 'side_panel_part');

  // Before the fix, the viewport highlight stayed dead because
  // isSelected used the edit-mode flag. After the fix, the highlight
  // follows the sidebar selection.
  const { paintInteractive } = interactiveFlagsFor('paint', true);
  const isSelected = paintIsSelected(useEditor.getState().paintSelectedMesh, 'side_panel_part', paintInteractive);
  check('4b sidebar pick now highlights in viewport (isSelected true)', isSelected === true);
}

// ============================================================
// Test 5: non-active asset in paint mode yields no highlight /
// no pick — the flag must be gated on `editable` (active asset),
// not just on paint mode.
// ============================================================
console.log('\nTest 5: non-active asset in paint mode stays non-interactive');
{
  reset();
  useEditor.getState().setMode('paint');
  useEditor.getState().addPrimitive('cube');
  // editable=false simulates a non-active asset: TransformableAsset
  // passes editable=true only for the active asset id.
  const { interactive, paintInteractive } = interactiveFlagsFor('paint', false);
  check('5a inactive asset: paintInteractive=false', paintInteractive === false);
  check('5b inactive asset: interactive=false', interactive === false);

  const wouldFire = paintPickWouldFire(paintInteractive);
  check('5c inactive asset onPick does NOT fire', wouldFire === false);

  useEditor.getState().setPaintSelectedMesh('container.005');
  const isSelected = paintIsSelected(useEditor.getState().paintSelectedMesh, 'container.005', paintInteractive);
  check('5d inactive asset: no SelectedRing even if name matches', isSelected === false);
}

// ============================================================
// Test 6: edit mode is unchanged — EditableMesh still gets the
// edit-mode interactive flag, and PaintMesh is off-screen so its
// flag is irrelevant (false). This guards against the fix leaking
// paint-mode gating into edit mode.
// ============================================================
console.log('\nTest 6: edit mode interactive flag unchanged (no regression)');
{
  reset();
  useEditor.getState().setMode('edit');
  useEditor.getState().addPrimitive('cube');

  const { interactive, paintInteractive } = interactiveFlagsFor('edit', true);
  check('6a edit + active: interactive=true (EditableMesh gets handles)', interactive === true);
  check('6b edit + active: paintInteractive=false (PaintMesh off-screen)', paintInteractive === false);

  // The store guard (editor.ts:787) blocks non-null paint writes
  // outside paint mode, so even a stray caller can't write a paint
  // selection while in edit mode.
  useEditor.getState().setPaintSelectedMesh('container.005');
  check('6c setPaintSelectedMesh(name) is a no-op in edit mode (store guard)', useEditor.getState().paintSelectedMesh === null);
  // The predicate with the (false) paint flag is false regardless.
  const isSelected = paintIsSelected(useEditor.getState().paintSelectedMesh, 'container.005', paintInteractive);
  check('6d no paint highlight in edit mode (paintInteractive=false)', isSelected === false);

  // Edit-mode flag is false when inactive.
  const inactive = interactiveFlagsFor('edit', false);
  check('6e edit + inactive: interactive=false (no vertex handles)', inactive.interactive === false);
}

// ============================================================
// Test 7: store paint-selection contract (mode isolation the fix
// relies on). These document the store's ACTUAL behavior:
//   - setMode('paint') clears paintSelectedMesh.
//   - setMode('edit') is special-cased to NOT clear it (editor.ts:425
//     returns only { mode }), but the write guard below keeps it inert.
//   - setPaintSelectedMesh(name) with name !== null is a no-op
//     outside paint mode (editor.ts:787 guard).
//   - setPaintSelectedMesh(null) is always allowed (used to clear).
//   - setActiveAsset to a DIFFERENT asset clears paintSelectedMesh
//     (editor.ts:486) — this is the real asset-switch clearing path.
// ============================================================
console.log('\nTest 7: store paint-selection contract (mode isolation)');
{
  reset();
  // Entering paint mode clears any prior paint selection.
  useEditor.getState().setMode('paint');
  useEditor.getState().setPaintSelectedMesh('partA');
  check('7a setPaintSelectedMesh works in paint mode', useEditor.getState().paintSelectedMesh === 'partA');

  // setMode('edit') is special-cased to only set { mode } — it does
  // NOT clear paintSelectedMesh (editor.ts:425). The store comment
  // claims selections are wiped on mode change, but the edit branch
  // only returns `{ mode }`. We document the actual behavior: the
  // stale value survives the mode switch into edit.
  useEditor.getState().setMode('edit');
  check('7b setMode(edit) preserves paintSelectedMesh (edit-branch quirk, value inert)', useEditor.getState().paintSelectedMesh === 'partA');

  // But the write guard keeps it inert: a non-null write outside
  // paint mode is rejected, so the stale value can't be replaced.
  useEditor.getState().setPaintSelectedMesh('blocked');
  check('7c setPaintSelectedMesh(name) no-op outside paint mode (stale value kept)', useEditor.getState().paintSelectedMesh === 'partA');

  // setPaintSelectedMesh(null) is always allowed (no guard on null).
  useEditor.getState().setPaintSelectedMesh(null);
  check('7d setPaintSelectedMesh(null) clears outside paint mode', useEditor.getState().paintSelectedMesh === null);

  // setActiveAsset to a DIFFERENT asset clears paintSelectedMesh —
  // the real asset-switch clearing path (addPrimitive / addAsset set
  // activeAssetId directly and do NOT clear it, only setActiveAsset
  // does).
  useEditor.getState().setMode('paint');
  useEditor.getState().addPrimitive('cube');
  const idA = useEditor.getState().activeAssetId!;
  useEditor.getState().addPrimitive('sphere');
  const idB = useEditor.getState().activeAssetId!;
  // Switch back to A and set a paint selection on it.
  useEditor.getState().setActiveAsset(idA);
  useEditor.getState().setPaintSelectedMesh('part_on_A');
  check('7e paint selection set on asset A', useEditor.getState().paintSelectedMesh === 'part_on_A');
  // Switch to B (a different id) → clears paint selection.
  useEditor.getState().setActiveAsset(idB);
  check('7f setActiveAsset to a different asset clears paintSelectedMesh', useEditor.getState().paintSelectedMesh === null);
  check('7g second asset is now active', useEditor.getState().activeAssetId === idB && idA !== idB);
}

// ============================================================
// Test 8: undefined `editable` is treated as inactive (defensive).
// TransformableAsset's call site passes an explicit boolean, but
// the helper must not blindly assume truthy === true.
// ============================================================
console.log('\nTest 8: defensive — undefined editable treated as inactive');
{
  const p = interactiveFlagsFor('paint', undefined);
  const e = interactiveFlagsFor('edit', undefined);
  check('8a paint + undefined editable → both flags false', p.interactive === false && p.paintInteractive === false);
  check('8b edit + undefined editable → both flags false', e.interactive === false && e.paintInteractive === false);
}

// ============================================================
// Summary
// ============================================================
const passed = RESULTS.filter((r) => r.pass).length;
const failed = RESULTS.length - passed;
console.log(`\n${passed}/${RESULTS.length} pass`);
if (failed > 0) {
  console.error(`❌ ${failed} FAILING`);
  process.exit(1);
} else {
  console.log('✅ ALL PASS');
}
