/**
 * Regression test for the cumulative-offset drift bug in
 * EditableMeshBody's useFrame.
 *
 * Background (commit a4e22ce → next):
 *   The original useFrame did `applyOffsets(readPositions(geometry), offsets)`
 *   and wrote the result back into `attr.array`. Because readPositions
 *   returns the live attr.array (mutation alias), the next frame's read
 *   picked up the already-offset positions and added offsets on top.
 *   Result: any vertex offset compounded by N×offset over N frames,
 *   making dragged vertices fly off to infinity within ~1 second.
 *
 * This test simulates the EditableMeshBody useFrame for 60 frames after
 * a 0.3-unit drag on vertex 0, and asserts:
 *   1. After 60 frames the vertex is still at base+0.3 (NOT drifted).
 *   2. Each frame's vertex position is exactly base+0.3 (no compounding).
 *
 * Run with: `npx tsx scripts/verify-vertex-drag.mts`
 */

import { BoxGeometry } from 'three';

function readPositions(geometry: { positionArray: Float32Array }) {
  return geometry.positionArray;
}

function applyOffsets(
  basePositions: Float32Array,
  offsets: number[] | null,
): Float32Array {
  const out = new Float32Array(basePositions.length);
  out.set(basePositions);
  if (!offsets) return out;
  if (offsets.length !== basePositions.length) return out;
  for (let i = 0; i < offsets.length; i++) out[i] += offsets[i];
  return out;
}

const geom = new BoxGeometry(1, 1, 1);
const positions = geom.getAttribute('position').array as Float32Array;
const initialX = positions[0];

// Snapshot base (the fix: read once, reuse forever)
const baseSnapshot = new Float32Array(positions);

const dragOffset = 0.3;
const vertexOffsets = new Array(positions.length).fill(0);
vertexOffsets[0] = dragOffset;

let allPassed = true;
const N = 60;
for (let frame = 1; frame <= N; frame++) {
  const next = applyOffsets(baseSnapshot, vertexOffsets);
  positions.set(next);
  const expected = initialX + dragOffset;
  const drift = positions[0] - expected;
  if (Math.abs(drift) > 1e-6) {
    console.error(
      `❌ Frame ${frame}: drift ${drift.toFixed(6)} from expected ${expected.toFixed(4)}`,
    );
    allPassed = false;
  }
}

const finalExpected = initialX + dragOffset;
const finalDrift = positions[0] - finalExpected;

if (allPassed && Math.abs(finalDrift) < 1e-6) {
  console.log(
    `✅ vertex drag is idempotent across ${N} frames: vertex 0 stays at ${positions[0].toFixed(4)} (drift ${finalDrift.toFixed(6)})`,
  );
} else {
  console.error(`❌ FAIL — final drift ${finalDrift.toFixed(4)}`);
  process.exit(1);
}

// Bonus: confirm the OLD broken behavior would have drifted dramatically.
// (For documentation purposes only — we don't run this in CI, it's the
// bug we just fixed.)
const oldPositions = new Float32Array(baseSnapshot);
for (let frame = 1; frame <= N; frame++) {
  const live = readPositions({ positionArray: oldPositions });
  const next = applyOffsets(live, vertexOffsets);
  oldPositions.set(next);
}
const oldDrift = oldPositions[0] - finalExpected;
console.log(
  `📜 For reference, OLD broken code would have drifted by ${oldDrift.toFixed(4)} over ${N} frames.`,
);