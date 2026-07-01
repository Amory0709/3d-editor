import type { BufferGeometry } from 'three';
import { BufferAttribute } from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import {
  applyOffsets,
  boundaryLoops,
  centroidOfLoop,
  fanTriangles,
  findBoundaryEdges,
  readPositions,
  weldVertices,
} from './meshEdit';
import { getGeometry } from '@/components/MeshGeometryBridge';
import { useEditor } from '@/store/editor';

/**
 * Phase 3.2b -- fill all boundary loops of the active asset's geometry
 * using centroid-fan triangulation.
 *
 * Mutates the asset's BufferGeometry in place:
 *   - adds one centroid vertex per loop (appended to positions)
 *   - adds fan triangles per loop (appended to indices)
 *   - sets needsUpdate on the geometry
 *
 * Then syncs `vertexOffsets` so the asset's edit state reflects the
 * new vertex count (new centroids start at zero offset).
 *
 * Returns the number of holes filled, or 0 if there were none / the
 * asset had no editable geometry.
 *
 * Limitations:
 *   - Only handles triangle meshes with a single boundary loop per hole.
 *     Multi-loop holes (a hole with an island inside it) will produce
 *     weird results -- the centroid of the outer loop is used, and the
 *     island is ignored.
 *   - The fan triangulation isn't smooth across non-planar holes.
 *     For complex holes, prefer an external tool (Blender, MeshLab).
 */
export function fillHolesOnAsset(assetId: string): number {
  const geometry = getGeometry(assetId);
  if (!geometry) return 0;
  // Capture pre-mutation geometry snapshot so undo can restore.
  const prePositions = readPositions(geometry);
  const preIndices = geometry.getIndex();
  if (prePositions) {
    useEditor.getState().setGeometrySnapshot(assetId, {
      positions: Array.from(prePositions),
      indices: preIndices ? Array.from(preIndices.array as Uint16Array | Uint32Array) : null,
    });
  }
  // Weld duplicate vertices first: three's BoxGeometry ships with
  // 24 vertices (no sharing), so every edge appears in 1 triangle and
  // would falsely look like a boundary. weldVertices merges co-located
  // verts (with a 1e-4 epsilon) into shared corners, which is what
  // boundary detection expects. (We use our own weldVertices rather
  // than three's mergeVertices because the latter is known to keep
  // normals separate per-face when boxes have per-face normals.)
  let work: BufferGeometry;
  try {
    work = weldVertices(geometry, 1e-4);
  } catch {
    work = geometry;
  }
  const filled = fillHolesInGeometry(work);
  if (filled > 0) {
    // Copy the merged+filled geometry back into the live asset buffer.
    copyGeometryAttributes(work, geometry);
    // Sync the store: vertexOffsets must match the new vertex count.
    const positions = readPositions(geometry);
    if (positions) {
      useEditor.getState().setVertexData(assetId, Array.from(positions));
    }
    // Bump the per-asset mutation nonce so undo/redo can detect that
    // the BufferGeometry was mutated (snapshot reference alone is not
    // a reliable signal after commitMakeFace enrichment).
    useEditor.setState((s) => ({
      assets: s.assets.map((a) =>
        a.id === assetId
          ? { ...a, geometryMutationNonce: (a.geometryMutationNonce ?? 0) + 1 }
          : a,
      ),
    }));
  }
  return filled;
}

/**
 * Copy attributes (position, normal, uv, indices) from `src` into `dst`,
 * replacing dst's existing attributes. Used by fillHolesOnAsset to
 * merge-then-fill into a working geometry, then copy back.
 */
function copyGeometryAttributes(src: BufferGeometry, dst: BufferGeometry): void {
  for (const name of ['position', 'normal', 'uv']) {
    const attr = src.getAttribute(name);
    if (!attr) continue;
    dst.deleteAttribute(name);
    dst.setAttribute(name, attr.clone());
  }
  const idx = src.getIndex();
  if (idx) {
    dst.setIndex(idx.clone());
  } else {
    dst.setIndex(null);
  }
  dst.computeBoundingSphere();
}

/**
 * Mutates the given geometry: detect boundary loops, add a centroid
 * vertex per loop, add fan triangles per loop.
 *
 * Returns the number of loops filled.
 */
export function fillHolesInGeometry(geometry: BufferGeometry): number {
  const positions = readPositions(geometry);
  if (!positions) return 0;
  const idx = geometry.getIndex();
  if (!idx) return 0; // non-indexed not supported in MVP
  const edges = findBoundaryEdges(geometry);
  const loops = boundaryLoops(edges);
  if (loops.length === 0) return 0;

  // Build new positions array: original + one centroid per loop.
  const newPositions = new Float32Array(positions.length + loops.length * 3);
  newPositions.set(positions);
  let centroidOffset = 0;
  const centroidIndices: number[] = [];
  for (const loop of loops) {
    const [cx, cy, cz] = centroidOfLoop(loop.vertices, positions);
    const idx = positions.length / 3 + centroidOffset;
    newPositions[idx * 3] = cx;
    newPositions[idx * 3 + 1] = cy;
    newPositions[idx * 3 + 2] = cz;
    centroidIndices.push(idx);
    centroidOffset++;
  }

  // Build new indices: original + fan triangles per loop.
  const oldIndices = idx.array;
  const newIndices = new Uint32Array(
    oldIndices.length + loops.reduce((sum, loop) => sum + loop.vertices.length * 3, 0),
  );
  newIndices.set(oldIndices);
  let writeOffset = oldIndices.length;
  loops.forEach((loop, i) => {
    const tris = fanTriangles(loop.vertices, centroidIndices[i]);
    for (const [a, b, c] of tris) {
      newIndices[writeOffset++] = a;
      newIndices[writeOffset++] = b;
      newIndices[writeOffset++] = c;
    }
  });

  // Mutate the geometry in place.
  geometry.setAttribute('position', new BufferAttribute(newPositions, 3));
  geometry.setIndex(new BufferAttribute(newIndices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return loops.length;
}

/**
 * Phase 3.2b -- discard all per-vertex offsets for an asset, so the
 * geometry is rendered at its base positions on the next frame.
 *
 * Note: this only clears `vertexOffsets` (the per-vertex drag offsets
 * applied every frame by EditableMesh.useFrame). It does NOT roll back
 * destructive geometry mutations (hole-fill, make-face, boolean). For
 * those, use Cmd+Z. The naming is intentionally "reset edits" rather
 * than "reset geometry" to set that expectation.
 *
 * Why we touch the BufferGeometry: EditableMesh applies offsets in
 * useFrame and writes the result back into `attr.array`. Once an
 * offset has been baked into the array, just clearing the store's
 * vertexOffsets isn't enough — the next frame's `applyOffsets(base,
 * null)` would restore from the already-baked positions, not from the
 * original base. So we explicitly set the position array back to
 * `base` here.
 */
export function resetVertexEdits(assetId: string): void {
  const geometry = getGeometry(assetId);
  if (!geometry) return;
  const base = readPositions(geometry);
  if (!base) return;
  // If the geometry was grown by hole-fill, `base` already includes
  // the added centroids (we read straight from the live BufferGeometry).
  // applyOffsets with null returns a copy of base — i.e. zeroes any
  // baked-in offset drift without removing the centroids.
  useEditor.getState().setVertexOffsets(assetId, null);
  const attr = geometry.getAttribute('position');
  if (attr) {
    attr.array.set(applyOffsets(base, null));
    attr.needsUpdate = true;
    geometry.computeBoundingSphere();
  }
}

/**
 * Phase 3.2c -- manually create a face from a set of vertex indices.
 *
 * Triangulation strategy (Blender-style F): fan from vertex 0.
 *   - 2 vertices: skipped (need 3+ to form a face; edge would be
 *     a separate "Make Edge" operation we don't implement)
 *   - 3 vertices: one triangle [0, 1, 2]
 *   - 4 vertices: two triangles [0,1,2] + [0,2,3]
 *   - N vertices: (N-2) triangles, fan from vertex 0
 *
 * Limitation: the fan is a planar assumption. For non-coplanar vertex
 * sets the face will be visibly folded. Same as Blender's default F.
 *
 * Mutates the geometry in place (appends nothing — reuses existing
 * vertices, just adds triangles). No new vertices, so vertexOffsets
 * doesn't need to be resized; but we still commit so undo restores
 * pre-face state.
 *
 * Returns the new triangles as a flat index array (every 3 = one tri),
 * or [] if the selection was too small or geometry was missing.
 */
export function makeFaceOnAsset(
  assetId: string,
  vertexIndices: number[],
): number[] {
  if (vertexIndices.length < 3) return [];
  const geometry = getGeometry(assetId);
  if (!geometry) return [];
  const idx = geometry.getIndex();
  if (!idx) return [];
  // De-dup while preserving order.
  const seen = new Set<number>();
  const unique: number[] = [];
  for (const v of vertexIndices) {
    if (!seen.has(v)) {
      seen.add(v);
      unique.push(v);
    }
  }
  if (unique.length < 3) return [];

  // Capture pre-mutation snapshot so undo can restore.
  const prePositions = readPositions(geometry);
  if (prePositions) {
    useEditor.getState().setGeometrySnapshot(assetId, {
      positions: Array.from(prePositions),
      indices: Array.from(idx.array as Uint16Array | Uint32Array),
    });
  }

  // Build fan triangles.
  const newTris: number[] = [];
  for (let i = 1; i < unique.length - 1; i++) {
    newTris.push(unique[0]);
    newTris.push(unique[i]);
    newTris.push(unique[i + 1]);
  }

  // Append to the index buffer. Keep the typed-array width of the source
  // so existing GPU buffers remain compatible. Indices never grow past
  // 65535 here because makeFaceOnAsset only reuses existing vertices
  // (no new vertex indices are introduced), so Uint16Array is safe.
  const oldIndices = idx.array;
  const oldIsUint32 = oldIndices instanceof Uint32Array;
  const IndexArrayCtor = oldIsUint32 ? Uint32Array : Uint16Array;
  const next = new IndexArrayCtor(oldIndices.length + newTris.length);
  next.set(oldIndices);
  let writeHead = oldIndices.length;
  for (let i = 0; i < newTris.length; i++) {
    next[writeHead++] = newTris[i];
  }
  geometry.setIndex(new BufferAttribute(next, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  // Bump nonce so undo/redo detect the BufferGeometry mutation.
  // (vertexOffsets didn't change — no setVertexData call here.)
  useEditor.setState((s) => ({
    assets: s.assets.map((a) =>
      a.id === assetId
        ? { ...a, geometryMutationNonce: (a.geometryMutationNonce ?? 0) + 1 }
        : a,
    ),
  }));
  return newTris;
}

/**
 * Phase 5 -- boolean CSG on two assets.
 *
 * Takes the geometry of `idA` and `idB` (must be both registered in the
 * MeshGeometryBridge), wraps each in a Brush with the asset's current
 * transform applied, runs Evaluator with `op`, and writes the result
 * back to idA's geometry in place. idB is left untouched.
 *
 * Op dispatch:
 *   - 'union' / 'add' / 'addition' -> ADDITION
 *   - 'subtract' / 'subtraction' -> SUBTRACTION (a - b)
 *   - 'intersect' / 'intersection' -> INTERSECTION
 *
 * Returns the new vertex count, or 0 if the op failed (e.g. missing
 * geometry, registered geometry was disposed, etc.).
 *
 * Known limitations:
 *   - We use the asset's transform but ignore vertexOffsets for the
 *     brush — they live in the position attribute overlay, not on the
 *     geometry. Boolean works on the base shape, not on per-vertex edits.
 *     User warning lives in the sidebar.
 *   - CSG can produce non-manifold seams where the two meshes meet; the
 *     hole-fill button can patch those afterwards.
 */
export function booleanOnAssets(
  idA: string,
  idB: string,
  op: 'union' | 'subtract' | 'intersect',
): number {
  const state = useEditor.getState();
  const assetA = state.assets.find((a) => a.id === idA);
  const assetB = state.assets.find((a) => a.id === idB);
  if (!assetA || !assetB) return 0;
  const geomA = getGeometry(idA);
  const geomB = getGeometry(idB);
  if (!geomA || !geomB) return 0;

  // Capture pre-mutation snapshot for assetA (only one that gets mutated).
  const prePosA = readPositions(geomA);
  const preIdxA = geomA.getIndex();
  if (prePosA) {
    state.setGeometrySnapshot(idA, {
      positions: Array.from(prePosA),
      indices: preIdxA ? Array.from(preIdxA.array as Uint16Array | Uint32Array) : null,
    });
  }

  // Build Brush meshes from each geometry with its world transform.
  const brushA = new Brush(geomA);
  // Weld duplicate vertices so CSG has consistent topology.
  const weldedA = weldVertices(geomA, 1e-4);
  brushA.geometry = weldedA;
  brushA.position.fromArray(assetA.transform.position);
  // asset.rotation is [x, y, z, EulerOrder]; three's rotation.set
  // accepts (x, y, z, order).
  const [rxA, ryA, rzA, orderA] = assetA.transform.rotation;
  brushA.rotation.set(rxA, ryA, rzA, orderA);
  brushA.scale.fromArray(assetA.transform.scale);
  brushA.updateMatrixWorld(true);

  const brushB = new Brush(geomB);
  const weldedB = weldVertices(geomB, 1e-4);
  brushB.geometry = weldedB;
  brushB.position.fromArray(assetB.transform.position);
  const [rxB, ryB, rzB, orderB] = assetB.transform.rotation;
  brushB.rotation.set(rxB, ryB, rzB, orderB);
  brushB.scale.fromArray(assetB.transform.scale);
  brushB.updateMatrixWorld(true);

  const evaluator = new Evaluator();
  let opEnum;
  switch (op) {
    case 'union':
      opEnum = ADDITION;
      break;
    case 'subtract':
      opEnum = SUBTRACTION;
      break;
    case 'intersect':
      opEnum = INTERSECTION;
      break;
  }

  let result: Brush;
  try {
    result = evaluator.evaluate(brushA, brushB, opEnum) as Brush;
  } catch (e) {
    console.warn('[booleanOnAssets] evaluator.evaluate failed:', e);
    return 0;
  }
  if (!result || !result.geometry) return 0;

  // Copy the result geometry into geomA's buffer.
  const newPos = result.geometry.getAttribute('position');
  if (!newPos) return 0;
  const newIdx = result.geometry.getIndex();
  geomA.deleteAttribute('position');
  geomA.setAttribute('position', newPos.clone());
  if (newIdx) {
    geomA.setIndex(newIdx.clone());
  } else {
    // Result has no index buffer — synthesize one over the position list.
    const len = newPos.count;
    const idxArr = new Uint32Array(len);
    for (let i = 0; i < len; i++) idxArr[i] = i;
    geomA.setIndex(new BufferAttribute(idxArr, 1));
  }
  geomA.computeVertexNormals();
  geomA.computeBoundingSphere();

  // Sync store offsets to the new vertex count.
  state.setVertexData(idA, Array.from(geomA.getAttribute('position').array as Float32Array));
  // Bump nonce for undo/redo. The snapshot + setVertexData above have
  // already mutated the asset record; this counter is the signal
  // commitMakeFace / undo / redo compare against.
  useEditor.setState((s) => ({
    assets: s.assets.map((a) =>
      a.id === idA
        ? { ...a, geometryMutationNonce: (a.geometryMutationNonce ?? 0) + 1 }
        : a,
    ),
  }));

  // Cleanup: the Brushes may share geometry with the original assets
  // (when no transform was applied), in which case disposing would yank
  // it out from under the renderer. Skip in that case.
  weldedA.dispose();
  weldedB.dispose();
  // The result Brush owns a fresh geometry; dispose it once the buffer
  // attributes are cloned into geomA (they're independent arrays now).
  result.geometry.dispose();

  return newPos.count;
}