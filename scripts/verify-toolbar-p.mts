/**
 * Toolbar P-key (edit-mode play) regression test.
 *
 * Bug (introduced by d02a919 "feat(3.2): strip edit mode to vertex-only
 * UI"): that commit made the Play/Stop button refuse to enter play in
 * edit mode (`disabled={mode === 'edit'}` + tooltip "Exit edit mode to
 * play"), but left the `P` keydown handler toggling play unconditionally.
 * Pressing `P` in edit mode entered play via the shortcut while the
 * button was visibly disabled, leaving the store in the abnormal
 * `mode === 'edit' && playMode === true` state.
 *
 * Fix:
 *   1. Toolbar.tsx keydown handler: `if (mode === 'edit') return;`
 *      before `setPlayMode(!playMode)` — matches the disabled button.
 *   2. store/editor.ts setPlayMode: `if (play && s.mode === 'edit')
 *      return;` — defense-in-depth entry guard so any programmatic
 *      caller is also refused. Stopping (play=false) stays allowed so a
 *      stray play can always be cleared.
 *
 * Scope note: a real `keydown` dispatch needs a DOM (jsdom / happy-dom),
 * which are not dependencies of this project. This script therefore
 * exercises the store action directly — running the exact expression
 * the Toolbar's `P` handler calls (`setPlayMode(!playMode)`) with the
 * store forced into `mode: 'edit'` — plus the store's own entry guard.
 * The end-to-end keydown path is covered by the browser-side steps in
 * the accompanying test plan.
 *
 * Run with:
 *   npx tsx --tsconfig ./tsconfig.app.json scripts/verify-toolbar-p.mts
 */
import { useEditor } from '@/store/editor';

const RESULTS: Array<{ name: string; pass: boolean; detail?: string }> = [];

function check(name: string, cond: boolean, detail?: string): void {
  RESULTS.push({ name, pass: cond, detail });
}

// Mirror the verify-physics.mts reset() helper: clears history, play
// mode, selection, and assets so each test starts from a clean slate.
// We mutate playMode via setState (not setPlayMode) so the edit-mode
// entry guard can't interfere with teardown.
function reset(): void {
  useEditor.getState().resetHistoryForTest();
  if (useEditor.getState().playMode) {
    useEditor.setState({ playMode: false, activeAssetId: null });
  } else {
    useEditor.setState({ activeAssetId: null });
  }
  const ids = useEditor.getState().assets.map((a) => a.id);
  for (const id of ids) useEditor.getState().removeAsset(id);
  // Restore default mode (mesh). setMode is a no-op while playMode is
  // true, but we've just cleared playMode, so this always works.
  useEditor.setState({ mode: 'mesh', selectedVertices: [], paintSelectedMesh: null });
}

// ─── Section 1: the bug — P-key expression no longer enters play in edit mode ──
console.log('── toolbar P-key (edit-mode play) verification ──');

// Test 1: setup. Edit mode + not playing = the state where the Play
// button renders disabled. This is the exact precondition the bug
// fires from.
{
  reset();
  useEditor.setState({ mode: 'edit' });
  check(
    '1. setup: mode === "edit" && playMode === false (button would be disabled)',
    useEditor.getState().mode === 'edit' && useEditor.getState().playMode === false,
    `mode=${useEditor.getState().mode} playMode=${useEditor.getState().playMode}`,
  );
}

// Test 2: the core regression. Run the EXACT expression the Toolbar's
// P handler runs (`setPlayMode(!playMode)`) in edit mode. Before the
// fix this flipped playMode to true (the bug). After the fix the store
// entry guard refuses it, so playMode stays false.
{
  reset();
  useEditor.setState({ mode: 'edit' });
  useEditor.getState().setPlayMode(!useEditor.getState().playMode);
  check(
    '2. P-key expression in edit mode: playMode stays false (was true = BUG)',
    useEditor.getState().playMode === false,
    `playMode=${useEditor.getState().playMode}`,
  );
  check(
    '2b. VERDICT: keyboard P no longer enters play in edit mode (FIXED)',
    useEditor.getState().playMode === false && useEditor.getState().mode === 'edit',
    `playMode=${useEditor.getState().playMode} mode=${useEditor.getState().mode}`,
  );
}

// Test 3: refused entry must be a true no-op — no pre-play history
// snapshot pushed, no deselection, no collision-log/clock reset, and
// mode MUST remain 'edit' (setPlayMode never touches mode). Each of
// these would have side-effected under the buggy enter-play.
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.setState({ mode: 'edit' });
  // Seed some state that enter-play would clobber: a selection, a
  // collision log entry, and a non-zero playClock.
  useEditor.setState({ selectedVertices: [3, 7] });
  useEditor.getState().addCollisionEvents([{ a: 'x', b: 'y' }], 0.0);
  useEditor.setState({ playClock: 9.25 });

  const pastBefore = useEditor.getState().history.past.length;
  const activeBefore = useEditor.getState().activeAssetId;
  const vertsBefore = useEditor.getState().selectedVertices.length;
  const logBefore = useEditor.getState().collisionEvents.length;
  const clockBefore = useEditor.getState().playClock;

  useEditor.getState().setPlayMode(true); // refused by the new guard

  check(
    '3a. setPlayMode(true) in edit mode pushes NO history snapshot',
    useEditor.getState().history.past.length === pastBefore,
    `past ${pastBefore}→${useEditor.getState().history.past.length}`,
  );
  check(
    '3b. setPlayMode(true) in edit mode does NOT clear activeAssetId',
    useEditor.getState().activeAssetId === activeBefore,
    `activeAssetId ${activeBefore}→${useEditor.getState().activeAssetId}`,
  );
  check(
    '3c. setPlayMode(true) in edit mode does NOT clear selectedVertices',
    useEditor.getState().selectedVertices.length === vertsBefore,
    `vertices ${vertsBefore}→${useEditor.getState().selectedVertices.length}`,
  );
  check(
    '3d. setPlayMode(true) in edit mode does NOT clear the collision log',
    useEditor.getState().collisionEvents.length === logBefore,
    `log ${logBefore}→${useEditor.getState().collisionEvents.length}`,
  );
  check(
    '3e. setPlayMode(true) in edit mode does NOT reset playClock',
    useEditor.getState().playClock === clockBefore,
    `clock ${clockBefore}→${useEditor.getState().playClock}`,
  );
  check(
    '3f. setPlayMode(true) in edit mode leaves mode === "edit"',
    useEditor.getState().mode === 'edit',
    `mode=${useEditor.getState().mode}`,
  );
  // activeAssetId still resolves to a live asset — edit UI is intact.
  check(
    '3g. edit-mode asset still present after refused entry',
    useEditor.getState().assets.find((a) => a.id === id) !== undefined,
  );
}

// Test 4: stopping (play=false) is ALWAYS allowed. Even from a
// hypothetical abnormal `mode === 'edit' && playMode === true` state
// (the exact state the bug produced), setPlayMode(false) must clear it
// so the user is never trapped. The new guard blocks only *entry*.
{
  reset();
  // Synthesize the buggy end-state directly via setState (the only
  // way to reach it now that entry is blocked).
  useEditor.setState({ mode: 'edit', playMode: true });
  check(
    '4a. pre: abnormal state mode=edit && playMode=true synthesized',
    useEditor.getState().mode === 'edit' && useEditor.getState().playMode === true,
  );
  useEditor.getState().setPlayMode(false);
  check(
    '4b. setPlayMode(false) escapes the abnormal state (stop is always allowed)',
    useEditor.getState().playMode === false && useEditor.getState().mode === 'edit',
    `playMode=${useEditor.getState().playMode} mode=${useEditor.getState().mode}`,
  );
}

// Test 5: idempotency guard still fires before the edit guard. Calling
// setPlayMode(false) when already false in edit mode is a no-op via the
// existing `playMode === play` check, so the new guard is never
// reached. Verifies ordering and that the new guard didn't shadow the
// idempotency fast path.
{
  reset();
  useEditor.setState({ mode: 'edit', playMode: false });
  // Should not throw, not enter play, not push history.
  const pastBefore = useEditor.getState().history.past.length;
  useEditor.getState().setPlayMode(false);
  check(
    '5. setPlayMode(false) when already false in edit mode is a no-op',
    useEditor.getState().playMode === false &&
      useEditor.getState().history.past.length === pastBefore,
  );
}

// ─── Section 2: happy-path regressions — play still works outside edit mode ──
console.log('\n── happy path: play still works outside edit mode ──');

// Test 6: in the default mesh mode, setPlayMode(true) still enters play
// (pushes snapshot, clears activeAssetId, clears log, resets clock).
// Proves the new guard is specific to mode === 'edit'.
{
  reset();
  useEditor.getState().addPrimitive('cube');
  // Seed state that legitimate enter-play SHOULD clobber, to prove the
  // enter-play path is still live outside edit mode.
  useEditor.getState().addCollisionEvents([{ a: 'x', b: 'y' }], 0.0);
  useEditor.setState({ playClock: 9.25 });
  const pastBefore = useEditor.getState().history.past.length;

  useEditor.getState().setPlayMode(true);

  check(
    '6a. mesh mode: setPlayMode(true) enters play',
    useEditor.getState().playMode === true,
    `playMode=${useEditor.getState().playMode}`,
  );
  check(
    '6b. mesh mode: setPlayMode(true) pushes a pre-play snapshot (past grew by 1)',
    useEditor.getState().history.past.length === pastBefore + 1,
    `past ${pastBefore}→${useEditor.getState().history.past.length}`,
  );
  check(
    '6c. mesh mode: setPlayMode(true) clears activeAssetId (enter-play deselects)',
    useEditor.getState().activeAssetId === null,
    `activeAssetId=${useEditor.getState().activeAssetId}`,
  );
  check(
    '6d. mesh mode: setPlayMode(true) clears the collision log',
    useEditor.getState().collisionEvents.length === 0,
    `log=${useEditor.getState().collisionEvents.length}`,
  );
  check(
    '6e. mesh mode: setPlayMode(true) resets playClock to 0',
    useEditor.getState().playClock === 0,
    `clock=${useEditor.getState().playClock}`,
  );
  check(
    '6f. mesh mode: setPlayMode(true) does NOT change mode',
    useEditor.getState().mode === 'mesh',
    `mode=${useEditor.getState().mode}`,
  );
  useEditor.getState().setPlayMode(false);
}

// Test 7: full play/stop round-trip in mesh mode still works.
{
  reset();
  useEditor.getState().addPrimitive('cube');
  useEditor.getState().setPlayMode(true);
  check('7a. enter play in mesh mode', useEditor.getState().playMode === true);
  useEditor.getState().setPlayMode(false);
  check(
    '7b. exit play in mesh mode round-trips playMode to false',
    useEditor.getState().playMode === false,
  );
}

// Test 8: the guard is symmetric across every NON-edit mode. Play must
// remain reachable from mesh / collision / paint (the user-facing
// modes in the Toolbar's MODES list), so the fix can't over-block.
{
  const modes: Array<{ id: 'mesh' | 'collision' | 'paint'; label: string }> = [
    { id: 'mesh', label: 'mesh' },
    { id: 'collision', label: 'collision' },
    { id: 'paint', label: 'paint' },
  ];
  const fails: string[] = [];
  for (const m of modes) {
    reset();
    useEditor.setState({ mode: m.id });
    useEditor.getState().setPlayMode(true);
    if (useEditor.getState().playMode !== true) fails.push(`${m.label} did not enter play`);
    useEditor.getState().setPlayMode(false);
    if (useEditor.getState().playMode !== false) fails.push(`${m.label} did not stop`);
  }
  check(
    '8. play/stop reachable from every non-edit toolbar mode (mesh, collision, paint)',
    fails.length === 0,
    fails.join('; '),
  );
}

// Test 9: not trapped in edit mode. After the refused entry, the user
// can still switch to mesh mode and then play — the guard doesn't
// wedge the editor. (setMode no-ops while playMode is true, but the
// refused entry keeps playMode false, so setMode works.)
{
  reset();
  useEditor.setState({ mode: 'edit' });
  useEditor.getState().setPlayMode(true); // refused
  check(
    '9a. after refused entry, still in edit mode and not playing',
    useEditor.getState().mode === 'edit' && useEditor.getState().playMode === false,
  );
  useEditor.getState().setMode('mesh');
  check(
    '9b. after refused entry, setMode("mesh") still works (not trapped)',
    useEditor.getState().mode === 'mesh',
    `mode=${useEditor.getState().mode}`,
  );
  useEditor.getState().setPlayMode(true);
  check(
    '9c. after switching to mesh, play now enters',
    useEditor.getState().playMode === true,
    `playMode=${useEditor.getState().playMode}`,
  );
  useEditor.getState().setPlayMode(false);
}

// Test 10: setMode('edit') is itself allowed when not playing, and
// then play is blocked — confirms the invariant direction (edit
// forbids play, not the reverse).
{
  reset();
  check(
    '10a. can enter edit mode from mesh when not playing',
    (useEditor.getState().setMode('edit'), useEditor.getState().mode === 'edit'),
  );
  useEditor.getState().setPlayMode(true);
  check(
    '10b. setPlayMode(true) blocked once in edit mode',
    useEditor.getState().playMode === false,
  );
  // And leaving edit mode re-enables play.
  useEditor.getState().setMode('mesh');
  useEditor.getState().setPlayMode(true);
  check(
    '10c. after leaving edit mode, play is re-enabled',
    useEditor.getState().playMode === true,
  );
  useEditor.getState().setPlayMode(false);
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
