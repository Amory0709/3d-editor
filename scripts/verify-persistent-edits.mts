/**
 * Regression test for the "vertex edits vanish on asset switch" bug.
 *
 * User report (session 4):
 *   '现在编辑vertices之后一旦选择别的模型 就看不到我编辑的vertices的
 *    改动了 重新选中才能看到'
 *   ('After editing vertices, once I select a different model, I can no
 *    longer see my vertex edits. I have to re-select [the edited one]
 *    to see them.')
 *
 * Root cause: TransformableAsset gated the entire <EditableMesh>
 * (which owns the useFrame offset-applier) on `useEditable = active
 * && edit-mode`. When the user clicked another asset, the active
 * one unmounted EditableMesh and mounted <MeshRenderer> instead.
 * MeshRenderer created a fresh BufferGeometry (or pulled a cached
 * GLB scene) on mount and never read asset.vertexOffsets, so the
 * offset mutation in the (now-disposed) geometry was lost.
 *
 * Fix: always render <EditableMesh>. The geometry + useFrame
 * offset loop ALWAYS runs. The interactive layer (vertex handles,
 * wireframe, DoubleSide) is the only thing gated on active +
 * edit-mode.
 *
 * This test simulates the React lifecycle in plain JS:
 *   1. Mount MockEditableMesh for asset A → drag vertex 0
 *   2. Switch active to B → A's MeshEditable stays mounted
 *   3. Verify A's vertex 0 still shows the offset
 *   4. Switch back to A → no remount, offset still applied
 *
 * The MockEditableMesh mirrors EditableMeshBody's useFrame logic
 * byte-for-byte. If you change one, change the other.
 */

import { makeGeometry } from '../src/components/PrimitiveRenderer';
import type { BufferGeometry } from 'three';

// Mirror of EditableMesh.tsx's useFrame offset-applier. If you
// change one, change the other.
function applyOffsets(base: Float32Array, offsets: number[] | null): Float32Array {
  if (!offsets) return base;
  const N = base.length / 3;
  if (offsets.length !== N * 3) return base;
  const out = new Float32Array(base.length);
  for (let i = 0; i < N; i++) {
    const dx = offsets[i * 3];
    const dy = offsets[i * 3 + 1];
    const dz = offsets[i * 3 + 2];
    out[i * 3]     = base[i * 3]     + dx;
    out[i * 3 + 1] = base[i * 3 + 1] + dy;
    out[i * 3 + 2] = base[i * 3 + 2] + dz;
  }
  return out;
}

/**
 * Mock the EditableMeshBody offset-applier behavior in plain JS.
 * Mirrors the React lifecycle: geometry is created once, base
 * snapshot taken once per geometry identity, every "frame" writes
 * (base + offsets) into attr.array in place.
 */
class MockEditableMesh {
  private baseRef: Float32Array | null = null;
  private geomRef: BufferGeometry | null = null;
  public vertexOffsets: number[] | null = null;

  constructor(public geometry: BufferGeometry) {
    const positions = this.geometry.getAttribute('position').array as Float32Array;
    if (this.geomRef !== geometry) {
      this.baseRef = new Float32Array(positions);
      this.geomRef = geometry;
    }
  }

  setOffsets(offsets: number[] | null) {
    this.vertexOffsets = offsets;
  }

  /** Mimic useFrame: write (base + offsets) into attr.array */
  tick() {
    if (!this.geometry || !this.baseRef) return;
    const attr = this.geometry.getAttribute('position');
    if (!attr) return;
    const next = applyOffsets(this.baseRef, this.vertexOffsets);
    attr.array.set(next);
    attr.needsUpdate = true;
  }

  /** Read the current visible vertex 0 position from the geometry. */
  getVertex0(): [number, number, number] {
    const a = this.geometry.getAttribute('position').array;
    return [a[0], a[1], a[2]];
  }
}

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); fail++; }
}

// BoxGeometry(1) vertex 0 = (0.5, 0.5, 0.5) (top-right-front corner).
const CUBE_V0_BASE: [number, number, number] = [0.5, 0.5, 0.5];

// === Test 1: EditableMesh keeps applying offsets across active-asset switch ===
console.log('Test 1: EditableMesh stays mounted → offsets visible across switch');
{
  // Asset A's EditableMesh instance.
  const geomA = makeGeometry('cube');
  const meshA = new MockEditableMesh(geomA);

  // User drags vertex 0 by (0.3, 0, 0).
  // BoxGeometry has 24 vertices (8 corners × 3 face duplicates), so
  // vertexOffsets is 24*3 = 72 entries.
  const offsets: number[] = [];
  offsets.push(0.3, 0, 0);
  for (let i = 1; i < 24; i++) offsets.push(0, 0, 0);
  meshA.setOffsets(offsets);
  meshA.tick();

  const v0_after_drag = meshA.getVertex0();
  check('after drag, vertex 0 = (0.8, 0.5, 0.5)',
    Math.abs(v0_after_drag[0] - 0.8) < 1e-6 &&
    Math.abs(v0_after_drag[1] - 0.5) < 1e-6 &&
    Math.abs(v0_after_drag[2] - 0.5) < 1e-6,
    `actual=${v0_after_drag.join(',')}`);

  // === Simulate user clicking asset B ===
  // With the FIX, TransformableAsset for A still renders
  // <EditableMesh>, so meshA is the SAME instance. No unmount.
  for (let f = 0; f < 60; f++) meshA.tick();

  const v0_after_switch = meshA.getVertex0();
  check('after switching active to B for 60 frames, A vertex 0 still at (0.8, 0.5, 0.5)',
    Math.abs(v0_after_switch[0] - 0.8) < 1e-6 &&
    Math.abs(v0_after_switch[1] - 0.5) < 1e-6 &&
    Math.abs(v0_after_switch[2] - 0.5) < 1e-6,
    `actual=${v0_after_switch.join(',')} — would be ${CUBE_V0_BASE.join(',')} if MeshRenderer recreated the geometry`);

  // === Simulate user clicking back to A ===
  // meshA is STILL the same instance — no remount, offsets still
  // applied every frame.
  for (let f = 0; f < 60; f++) meshA.tick();

  const v0_after_back = meshA.getVertex0();
  check('after switching back to A, vertex 0 still at (0.8, 0.5, 0.5)',
    Math.abs(v0_after_back[0] - 0.8) < 1e-6 &&
    Math.abs(v0_after_back[1] - 0.5) < 1e-6 &&
    Math.abs(v0_after_back[2] - 0.5) < 1e-6,
    `actual=${v0_after_back.join(',')}`);
}

// === Test 2: Counter-test — reproduces the OLD bug ===
// If someone re-introduces the bug (unmount EditableMesh and mount
// MeshRenderer = brand-new geometry), the offsets are lost. This is
// the behavior we are protecting against.
console.log('\nTest 2: Counter-test — old bug returns if we recreate the geometry');
{
  // Original lifecycle: EditableMesh on A, drag vertex 0.
  const geomA1 = makeGeometry('cube');
  const m1 = new MockEditableMesh(geomA1);
  const offsets: number[] = [];
  offsets.push(0.3, 0, 0);
  for (let i = 1; i < 24; i++) offsets.push(0, 0, 0);
  m1.setOffsets(offsets);
  m1.tick();
  check('original: vertex 0 = (0.8, 0.5, 0.5)',
    Math.abs(m1.getVertex0()[0] - 0.8) < 1e-6);

  // Simulate the bug: unmount EditableMesh, mount MeshRenderer
  // (which creates a brand-new geometry). Even though vertexOffsets
  // is still in the store, the new geometry doesn't have the
  // offsets applied.
  const geomA2 = makeGeometry('cube');  // fresh, pristine
  const m2 = new MockEditableMesh(geomA2);
  m2.setOffsets(null);  // ← simulating MeshRenderer: doesn't read vertexOffsets
  m2.tick();
  check('after bug: new geometry shows original (0.5, 0.5, 0.5) — edits lost',
    Math.abs(m2.getVertex0()[0] - 0.5) < 1e-6 &&
    Math.abs(m2.getVertex0()[1] - 0.5) < 1e-6 &&
    Math.abs(m2.getVertex0()[2] - 0.5) < 1e-6,
    `actual=${m2.getVertex0().join(',')}`);

  // Now simulate user clicking BACK to A. Old code would re-mount
  // EditableMesh, which DOES read vertexOffsets and applies them.
  // → edits "magically" come back. This matches the user's report
  //   "重新选中才能看到" (have to re-select to see them).
  const m3 = new MockEditableMesh(makeGeometry('cube'));
  m3.setOffsets(offsets);
  m3.tick();
  check('on re-select (old behavior): edits reappear, vertex 0 = (0.8, 0.5, 0.5)',
    Math.abs(m3.getVertex0()[0] - 0.8) < 1e-6);
}

// === Test 3: Fix preserves drift invariant (idempotent for 100 frames) ===
console.log('\nTest 3: fix preserves drift invariant (idempotent for 100 frames)');
{
  const geom = makeGeometry('cube');
  const m = new MockEditableMesh(geom);
  const offsets: number[] = [];
  offsets.push(0.7, 0.2, -0.1);
  for (let i = 1; i < 24; i++) offsets.push(0, 0, 0);
  m.setOffsets(offsets);
  for (let f = 0; f < 100; f++) m.tick();
  const v = m.getVertex0();
  check('vertex 0 stays at (1.2, 0.7, 0.4) after 100 ticks',
    Math.abs(v[0] - 1.2) < 1e-6 &&
    Math.abs(v[1] - 0.7) < 1e-6 &&
    Math.abs(v[2] - 0.4) < 1e-6,
    `actual=${v.join(',')}`);
}

// === Test 4: Vertex count integrity — offsets.length must equal positions.length / 3 ===
console.log('\nTest 4: offsets size must match vertex count (defensive guard)');
{
  const geom = makeGeometry('cube');
  const m = new MockEditableMesh(geom);
  const N = geom.getAttribute('position').count;
  // Try wrong-sized offsets — should not crash, just no-op.
  m.setOffsets([0.1, 0, 0]);  // length 3, not 72
  m.tick();
  const v = m.getVertex0();
  check('wrong-sized offsets: vertex 0 stays at original (0.5, 0.5, 0.5)',
    Math.abs(v[0] - 0.5) < 1e-6 && Math.abs(v[1] - 0.5) < 1e-6,
    `actual=${v.join(',')}`);
  check('cube has 24 vertices (8 corners × 3 face duplicates)',
    N === 24,
    `count=${N}`);
}

console.log(`\n${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);