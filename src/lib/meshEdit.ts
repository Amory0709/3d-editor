/**
 * Phase 3.2 — mesh geometry editing utilities.
 *
 * Three.js BufferGeometry is flat: vertices + indices. No adjacency info.
 * For a halfedge-quality editor (face / edge selection, bridge loops)
 * you'd want a real halfedge structure (OpenMesh, trimesh). We don't
 * need that for the MVP -- we work directly on the position array.
 *
 * Conventions used here:
 *   - Positions are Float32Array (matching BufferGeometry's native layout).
 *   - Each vertex is 3 consecutive floats: [x, y, z].
 *   - Edges are inferred from indices; an edge is a boundary edge when
 *     it appears in exactly one triangle.
 *
 * Limitations vs. a full mesh library:
 *   - We don't detect non-manifold or self-intersecting geometry.
 *   - Boundary detection assumes a triangle mesh (no quads/n-gons).
 *   - Hole filling uses centroid-fan triangulation, not Liepa / ear
 *     clipping. Works for simple convex-ish holes; non-planar or
 *     highly concave holes will look stepped.
 */

import type { BufferGeometry } from 'three';
import { BufferAttribute, BufferGeometry as BG } from 'three';

/** Edge representation: pair of vertex indices, always a < b for dedup. */
export interface Edge {
  a: number;
  b: number;
}

/** A closed boundary loop, in order, around a hole. */
export interface BoundaryLoop {
  /** Vertex indices in walk order. */
  vertices: number[];
}

/**
 * Find all boundary edges: edges that appear in exactly one triangle.
 * For a triangle mesh, boundary edges outline holes or open boundaries.
 */
export function findBoundaryEdges(geometry: BufferGeometry): Edge[] {
  const idx = geometry.getIndex();
  const pos = geometry.getAttribute('position');
  if (!pos) return [];
  const vertCount = pos.count;
  if (!idx) return [];
  const faceCount: Map<string, number> = new Map();
  const indices = idx.array;
  const triCount = indices.length / 3;
  for (let t = 0; t < triCount; t++) {
    const v0 = indices[t * 3];
    const v1 = indices[t * 3 + 1];
    const v2 = indices[t * 3 + 2];
    const edges: Array<[number, number]> = [
      [v0, v1],
      [v1, v2],
      [v2, v0],
    ];
    for (const [a, b] of edges) {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = lo + '_' + hi;
      faceCount.set(key, (faceCount.get(key) ?? 0) + 1);
    }
  }
  const boundary: Edge[] = [];
  faceCount.forEach((count, key) => {
    if (count === 1) {
      const parts = key.split('_');
      boundary.push({ a: Number(parts[0]), b: Number(parts[1]) });
    }
  });
  return boundary.filter((e) => e.a < vertCount && e.b < vertCount);
}

/**
 * Walk boundary edges into closed loops. Each edge is used exactly once.
 * Assumes a simple (non-self-intersecting) boundary. Empty array = no holes.
 */
export function boundaryLoops(edges: Edge[]): BoundaryLoop[] {
  const adj: Map<number, Array<{ b: number; idx: number }>> = new Map();
  edges.forEach((e, idx) => {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a)!.push({ b: e.b, idx });
    adj.get(e.b)!.push({ b: e.a, idx });
  });
  const used: Set<number> = new Set();
  const loops: BoundaryLoop[] = [];
  for (let startIdx = 0; startIdx < edges.length; startIdx++) {
    if (used.has(startIdx)) continue;
    const startEdge = edges[startIdx];
    const loop: number[] = [startEdge.a];
    let curEnd = startEdge.b;
    used.add(startIdx);
    while (curEnd !== loop[0]) {
      loop.push(curEnd);
      const next = adj.get(curEnd) ?? [];
      const candidate = next.find((n) => !used.has(n.idx));
      if (!candidate) break; // dead end (shouldn't happen for well-formed mesh)
      used.add(candidate.idx);
      curEnd = candidate.b;
    }
    if (loop.length >= 3) loops.push({ vertices: loop });
  }
  return loops;
}

/**
 * Compute the centroid of a boundary loop. Returns [x, y, z].
 */
export function centroidOfLoop(
  boundary: number[],
  positions: Float32Array,
): [number, number, number] {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const v of boundary) {
    cx += positions[v * 3];
    cy += positions[v * 3 + 1];
    cz += positions[v * 3 + 2];
  }
  const n = boundary.length;
  return [cx / n, cy / n, cz / n];
}

/**
 * Triangulate a boundary loop as a fan around a new centroid vertex.
 * Returns [a, b, c] triples; caller appends centroid vertex + triangles.
 */
export function fanTriangles(
  boundary: number[],
  centroidIndex: number,
): Array<[number, number, number]> {
  const tris: Array<[number, number, number]> = [];
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i];
    const b = boundary[(i + 1) % boundary.length];
    tris.push([centroidIndex, a, b]);
  }
  return tris;
}

/**
 * Apply per-vertex offsets to a position array. Returns a NEW array.
 * The caller replaces BufferGeometry.attributes.position.array with the
 * returned array (and sets needsUpdate).
 */
export function applyOffsets(
  basePositions: Float32Array,
  offsets: number[] | null,
): Float32Array {
  const out = new Float32Array(basePositions.length);
  out.set(basePositions);
  if (!offsets) return out;
  if (offsets.length !== basePositions.length) return out;
  for (let i = 0; i < offsets.length; i++) {
    out[i] += offsets[i];
  }
  return out;
}

/** Read a position attribute into a plain number[] for zustand storage. */
export function positionsToOffsets(positions: Float32Array): number[] {
  return Array.from(positions);
}

/** Return the position array for a BufferGeometry, or null if absent. */
export function readPositions(geometry: BufferGeometry): Float32Array | null {
  const attr = geometry.getAttribute('position');
  if (!attr) return null;
  return attr.array as Float32Array;
}

/**
 * Weld vertices that are within `tolerance` of each other by position
 * (other attributes are NOT considered — we want to merge corners even
 * when their normals differ across faces).
 *
 * Returns a new BufferGeometry with welded vertices + a fresh index
 * buffer. For our purposes (boundary detection on boxy meshes) we
 * don't care about preserving the original normal/uv layout — the
 * renderer just needs positions + indices.
 *
 * Implementation: scan positions, group by quantized position hash,
 * emit one vertex per group, rewrite indices to reference the new ids.
 */
export function weldVertices(
  geometry: BufferGeometry,
  tolerance = 1e-4,
): BufferGeometry {
  const positions = readPositions(geometry);
  if (!positions) return geometry;
  const oldIdx = geometry.getIndex();
  const oldIndices = oldIdx ? Array.from(oldIdx.array as Uint16Array | Uint32Array) : null;
  const vertCount = positions.length / 3;

  // Quantize positions to a hash. We use `Math.round` (not `Math.floor`)
// so that positions straddling zero are handled symmetrically —
// `Math.floor(-0.0001 * 1e4)` = -1, but `Math.floor(+0.0001 * 1e4)` = 1,
// which would push two co-located vertices into different hash buckets.
  const mult = Math.pow(10, Math.ceil(-Math.log10(tolerance)));
  const hashToNewIndex = new Map<string, number>();
  const newPositions: number[] = [];
  const remap: number[] = new Array(vertCount);

  for (let i = 0; i < vertCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const qx = Math.round(x * mult);
    const qy = Math.round(y * mult);
    const qz = Math.round(z * mult);
    const key = `${qx},${qy},${qz}`;
    let newIdx = hashToNewIndex.get(key);
    if (newIdx === undefined) {
      newIdx = newPositions.length / 3;
      newPositions.push(x, y, z);
      hashToNewIndex.set(key, newIdx);
    }
    remap[i] = newIdx;
  }

  // Rewrite indices (or build them from a non-indexed source).
  let newIndices: number[];
  if (oldIndices) {
    newIndices = oldIndices.map((i) => remap[i]);
  } else {
    newIndices = remap.slice();
  }

  // Emit a fresh geometry.
  const out = new BG();
  out.setAttribute('position', new BufferAttribute(new Float32Array(newPositions), 3));
  out.setIndex(new BufferAttribute(new Uint32Array(newIndices), 1));
  out.computeVertexNormals();
  out.computeBoundingSphere();
  return out;
}