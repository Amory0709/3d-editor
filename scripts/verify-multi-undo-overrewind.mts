/**
 * Regression verification for the multi-undo over-rewind bug in the
 * geometry-snapshot undo plumbing.
 *
 * Bug: `setGeometrySnapshot` (`src/store/editor.ts`) was "sticky" — it
 * only stored a snapshot when the asset didn't already have one. So the
 * 2nd..Nth destructive geometry op dropped its per-op pre-op snapshot;
 * `undo()` then popped a single history entry that still carried the
 * FIRST op's snapshot, and `applySnapshotToGeometry` wrote that stale
 * snapshot into the live BufferGeometry. Undoing the latest of N
 * stacked ops therefore rewound all N ops at once (live mesh = pre-op-1
 * instead of post-op N-1).
 *
 * This script exercises the REAL store (`useEditor`) and the REAL
 * extracted bridge restore (`applySnapshotToGeometry` from
 * `MeshGeometryBridge.tsx`) against a registered three.js
 * `BufferGeometry`. It does NOT mount a <Canvas> and does NOT re-enact
 * the bridge by hand — it calls the production restore function on the
 * production geometry registry, just as `GeometryUndoBridge`'s effect
 * would. The meshOps pattern (setGeometrySnapshot BEFORE mutation, bump
 * nonce, commitMakeFace) is replayed with crafted snapshots so the two
 * op families (index-grows / positions-grow) are exercised
 * deterministically without depending on three's weld/fill/CSG internals.
 *
 * Run with:
 *   npx tsx --tsconfig ./tsconfig.app.json scripts/verify-multi-undo-overrewind.mts
 *
 * Covers:
 *   • Scenario A — two makeFace-style ops (indices grow, positions
 *     fixed), then one undo: live mesh must be post-op-1, not pre-op-1.
 *   • Scenario B — a fillHoles-style op (positions grow) then a
 *     makeFace-style op, then one undo: live indices + positions must
 *     be post-op-1, with no orphaned trailing vertex.
 *   • Control   — single makeFace op + single undo: live mesh returns
 *     to pre-op-0 (guards against a regression in the single-op path).
 *   • Stepped   — two undo calls in sequence each rewind exactly one op.
 */
import { BufferAttribute, BufferGeometry } from 'three';
import { useEditor } from '@/store/editor';
import {
  applySnapshotToGeometry,
  getGeometry,
  registerGeometry,
} from '@/components/MeshGeometryBridge';

const RESULTS: Array<{ name: string; pass: boolean; detail?: string }> = [];

function check(name: string, cond: boolean, detail?: string): void {
  RESULTS.push({ name, pass: cond, detail });
}

function eq<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

type Snap = { positions: number[]; indices: number[] | null };

/** Apply a snapshot to a geometry by replacing its attributes (the
 *  way the live BufferGeometry would look immediately after an op). */
function setGeomTo(geom: BufferGeometry, snap: Snap): void {
  geom.setAttribute('position', new BufferAttribute(new Float32Array(snap.positions), 3));
  if (snap.indices) {
    geom.setIndex(new BufferAttribute(new Uint16Array(snap.indices), 1));
  } else {
    geom.setIndex(null);
  }
}

function readIndex(geom: BufferGeometry): number[] {
  const idx = geom.getIndex();
  return idx ? Array.from(idx.array as Uint16Array | Uint32Array) : [];
}

function readPositions(geom: BufferGeometry): number[] {
  const pos = geom.getAttribute('position');
  return Array.from(pos.array as Float32Array);
}

/** Replay the meshOps destructive-op pattern: capture pre-op snapshot,
 *  mutate the live geometry, bump the per-asset nonce, commit. */
function applyOp(
  id: string,
  preOp: Snap,
  postOp: Snap,
  geom: BufferGeometry,
  newTris: number[],
): void {
  // preAssets captured BEFORE setGeometrySnapshot (matches meshOps).
  const preAssets = useEditor.getState().assets.map((a) => (a.id === id ? { ...a } : a));
  // meshOps reads the live geometry (currently preOp) and snapshots it.
  useEditor.getState().setGeometrySnapshot(id, {
    positions: preOp.positions,
    indices: preOp.indices,
  });
  // Mutate the live BufferGeometry in place to postOp.
  setGeomTo(geom, postOp);
  // Bump nonce so undo/redo can detect a BufferGeometry change.
  useEditor.setState((s) => ({
    assets: s.assets.map((a) =>
      a.id === id ? { ...a, geometryMutationNonce: (a.geometryMutationNonce ?? 0) + 1 } : a,
    ),
  }));
  // Commit the op to history (enriches preAssets with the just-set snapshot).
  useEditor.getState().commitMakeFace(id, preAssets, newTris);
}

function snapshotOf(id: string): Snap | null {
  const a = useEditor.getState().assets.find((x) => x.id === id);
  return a ? a.geometrySnapshot : null;
}

// ─── Scenario A: two makeFace-style ops (indices grow) ──────────────
console.log('── Scenario A: two index-growing ops, then one undo ──');
{
  useEditor.getState().resetHistoryForTest();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  const geom = new BufferGeometry();

  const G0: Snap = {
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    indices: [0, 1, 2],
  };
  const G1: Snap = {
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    indices: [0, 1, 2, 0, 2, 1],
  };
  const G2: Snap = {
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    indices: [0, 1, 2, 0, 2, 1, 1, 2, 0],
  };

  setGeomTo(geom, G0);
  registerGeometry(id, geom);
  check('A: asset starts with null geometrySnapshot', snapshotOf(id) === null);

  const pastBefore = useEditor.getState().history.past.length;

  // Op 1: G0 -> G1. setGeometrySnapshot must capture G0.
  applyOp(id, G0, G1, geom, G1.indices!.slice(-3));
  check('A: op #1 captured G0 snapshot', eq(snapshotOf(id), G0));

  // Op 2: G1 -> G2. setGeometrySnapshot must OVERWRITE with G1 (the fix).
  // The buggy sticky guard would leave the asset's snapshot at G0.
  applyOp(id, G1, G2, geom, G2.indices!.slice(-3));
  check('A: op #2 overwrote snapshot with G1 (not sticky)', eq(snapshotOf(id), G1));

  check(
    'A: two ops pushed exactly 2 history entries',
    useEditor.getState().history.past.length - pastBefore === 2,
    `past delta = ${useEditor.getState().history.past.length - pastBefore}`,
  );

  // Live geometry is currently G2 (index length 9).
  check('A: live geometry is at G2 pre-undo', readIndex(geom).length === 9);

  // Undo once — should rewind ONLY op #2, restoring G1.
  useEditor.getState().undo();

  check('A: undo popped exactly 1 entry', useEditor.getState().history.past.length === pastBefore + 1);
  check(
    'A: asset flagged in geometryUndoTargets',
    useEditor.getState().geometryUndoTargets.includes(id),
  );

  const restored = snapshotOf(id);
  check('A: restored asset has a snapshot', restored !== null);
  check('A: restored snapshot is G1 (post-op-1)', eq(restored, G1));

  // Run the REAL bridge restore on the registered geometry.
  applySnapshotToGeometry(getGeometry(id)!, restored!);

  check(
    'A: bridge restores post-op-1 index (G1, length 6)',
    readIndex(geom).length === 6 && eq(readIndex(geom), G1.indices),
    `live idx = ${JSON.stringify(readIndex(geom))}`,
  );
  check(
    'A: bridge restores post-op-1 positions (G1, 9 floats)',
    readPositions(geom).length === 9 && eq(readPositions(geom), G1.positions),
    `live pos len = ${readPositions(geom).length}`,
  );

  // Undo again — should rewind op #1, restoring G0.
  useEditor.getState().undo();
  const restored2 = snapshotOf(id);
  check('A: 2nd undo restores G0 snapshot', eq(restored2, G0));
  applySnapshotToGeometry(getGeometry(id)!, restored2!);
  check(
    'A: bridge restores pre-op-0 index (G0, length 3) after 2nd undo',
    readIndex(geom).length === 3 && eq(readIndex(geom), G0.indices),
    `live idx = ${JSON.stringify(readIndex(geom))}`,
  );

  registerGeometry(id, null);
}

// ─── Scenario B: fillHoles (positions grow) then makeFace ───────────
console.log('\n── Scenario B: positions-growing op then index-growing op, then one undo ──');
{
  useEditor.getState().resetHistoryForTest();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  const geom = new BufferGeometry();

  const G0: Snap = {
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    indices: [0, 1, 2],
  }; // 9 floats, 3 idx
  const G1: Snap = {
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 2, 0],
    indices: [0, 1, 2, 0, 2, 3],
  }; // 12 floats, 6 idx (fillHoles added a centroid + fan)
  const G2: Snap = {
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 2, 0],
    indices: [0, 1, 2, 0, 2, 3, 1, 3, 2],
  }; // 12 floats, 9 idx (makeFace added a tri, no vertex growth)

  setGeomTo(geom, G0);
  registerGeometry(id, geom);

  // Op 1: fillHoles-style, G0 -> G1 (positions grow to 12).
  applyOp(id, G0, G1, geom, G1.indices!.slice(-3));
  check('B: op #1 captured G0 snapshot', eq(snapshotOf(id), G0));

  // Op 2: makeFace-style, G1 -> G2 (no vertex growth).
  applyOp(id, G1, G2, geom, G2.indices!.slice(-3));
  check('B: op #2 overwrote snapshot with G1 (not sticky)', eq(snapshotOf(id), G1));

  // Undo once — should restore G1 (positions 12, indices 6).
  useEditor.getState().undo();
  check(
    'B: asset flagged in geometryUndoTargets',
    useEditor.getState().geometryUndoTargets.includes(id),
  );

  const restored = snapshotOf(id);
  check('B: restored snapshot is G1 (post-op-1)', eq(restored, G1));

  applySnapshotToGeometry(getGeometry(id)!, restored!);

  check(
    'B: bridge restores post-op-1 index (G1, length 6)',
    readIndex(geom).length === 6 && eq(readIndex(geom), G1.indices),
    `live idx = ${JSON.stringify(readIndex(geom))} (length ${readIndex(geom).length})`,
  );
  check(
    'B: no stale trailing vertex — snapshot pos length matches live (12)',
    readPositions(geom).length === 12 && restored!.positions.length === 12,
    `live pos len = ${readPositions(geom).length}, snapshot pos len = ${restored!.positions.length}`,
  );
  check(
    'B: bridge restores post-op-1 positions (G1, 12 floats, exact content)',
    eq(readPositions(geom), G1.positions),
  );

  registerGeometry(id, null);
}

// ─── Control: single op + single undo still works (no regression) ──
console.log('\n── Control: single makeFace op + single undo ──');
{
  useEditor.getState().resetHistoryForTest();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  const geom = new BufferGeometry();

  const G0: Snap = {
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    indices: [0, 1, 2],
  };
  const G1: Snap = {
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    indices: [0, 1, 2, 0, 2, 1],
  };

  setGeomTo(geom, G0);
  registerGeometry(id, geom);

  applyOp(id, G0, G1, geom, G1.indices!.slice(-3));
  check('Control: single op captured G0 snapshot', eq(snapshotOf(id), G0));

  useEditor.getState().undo();
  const restored = snapshotOf(id);
  check('Control: undo restores G0 snapshot', eq(restored, G0));
  applySnapshotToGeometry(getGeometry(id)!, restored!);
  check(
    'Control: bridge restores pre-op-0 index (G0, length 3)',
    readIndex(geom).length === 3 && eq(readIndex(geom), G0.indices),
  );
  check(
    'Control: bridge restores pre-op-0 positions (G0, 9 floats)',
    eq(readPositions(geom), G0.positions),
  );

  registerGeometry(id, null);
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
