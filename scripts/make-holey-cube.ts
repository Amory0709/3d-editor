/**
 * Make a holey .glb fixture for verifying the mesh hole-fill workflow.
 *
 * Starts with three's BoxGeometry (6 faces, 24 vertices because each
 * face has its own copy of vertices for hard edges), then deletes the
 * top face's 2 triangles. The result is a box with an open top — the
 * user can then go to Edit mode → "Fill holes" and watch the top close.
 *
 * Output: holey-cube.glb (relative to repo root).
 *
 * Usage: npx tsx scripts/make-holey-cube.ts
 */

(globalThis as unknown as { self: typeof globalThis }).self = globalThis;

import { writeFile } from 'node:fs/promises';
import { BoxGeometry, BufferAttribute } from 'three';
import { Document, NodeIO } from '@gltf-transform/core';

async function main() {
  // 1. Build a box geometry. three's BoxGeometry gives 24 vertices
  //    (4 per face × 6 faces) so each face is independent.
  const geom = new BoxGeometry(1, 1, 1);

  // 2. Identify the top face triangles by normal. The top face is the
  //    one whose triangles have a normal pointing in +Y. We compute
  //    the index array, walk each triangle, and drop the ones whose
  //    centroid has y > 0.49 (allowing for FP imprecision).
  const idx = geom.getIndex()!;
  const pos = geom.getAttribute('position') as BufferAttribute;
  const indices = Array.from(idx.array as Uint16Array);
  const kept: number[] = [];
  const removed: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    const ay = (pos.array as Float32Array)[a * 3 + 1];
    const by = (pos.array as Float32Array)[b * 3 + 1];
    const cy = (pos.array as Float32Array)[c * 3 + 1];
    if (ay > 0.49 && by > 0.49 && cy > 0.49) {
      removed.push(a, b, c);
    } else {
      kept.push(a, b, c);
    }
  }
  console.log(
    `Removed ${removed.length / 3} top-face triangles (${removed.length} indices).`,
  );
  console.log(`Kept ${kept.length / 3} triangles (${kept.length} indices).`);

  // 3. Write the kept triangles back into the geometry's index buffer.
  const newIdx = new Uint16Array(kept);
  geom.setIndex(new BufferAttribute(newIdx, 1));
  geom.computeVertexNormals();

  // 4. Pack into a GLB using @gltf-transform.
  const positions = (geom.getAttribute('position').array as Float32Array);
  const newIndices = new Uint32Array(kept);

  const doc = new Document();
  const buffer = doc.createBuffer();
  const positionAccessor = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array(positions))
    .setBuffer(buffer);
  const indexAccessor = doc
    .createAccessor()
    .setType('SCALAR')
    .setArray(newIndices)
    .setBuffer(buffer);

  const mesh = doc.createMesh('HoleyBox');
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', positionAccessor)
    .setIndices(indexAccessor);
  mesh.addPrimitive(prim);

  const node = doc.createNode('Mesh').setMesh(mesh);
  const scene = doc.createScene('Scene').addChild(node);
  doc.getRoot().setDefaultScene(scene);

  const io = new NodeIO();
  const glb = await io.writeBinary(doc);
  await writeFile(
    new URL('../holey-cube.glb', import.meta.url),
    Buffer.from(glb),
  );
  console.log(`Wrote holey-cube.glb (${glb.byteLength} bytes)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});