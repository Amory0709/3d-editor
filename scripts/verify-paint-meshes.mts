// Regression verification for the "Paint mode: GLB crash" bug.
//
// Imports the REAL collectPaintMeshes from @/components/Sidebar (the fixed
// source) and runs it against the actual useGLTF return shape produced by
// three's GLTFLoader.parse on public/fixtures/holey-cube.glb. Asserts:
//   - the useGLTF wrapper has no .traverse (only gltf.scene does);
//   - the fixed call path (gltf.scene) returns the mesh names, no throw;
//   - the null / cold path returns an empty list, no throw;
//   - the pre-fix call path (passing the wrapper) would throw the exact
//     TypeError the bug report reproduces — locked in as a regression guard.
//
// Run: npx tsx --tsconfig ./tsconfig.app.json scripts/verify-paint-meshes.mts
//
// Three's loaders use `self` in some code paths — polyfill for Node.
(globalThis as unknown as { self: typeof globalThis }).self = globalThis;
const { readFile } = await import('node:fs/promises');
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
import type * as THREE from 'three';
import { strict as assert } from 'node:assert';
import { collectPaintMeshes } from '@/components/Sidebar';

let pass = 0;
const fail = (msg: string) => {
  console.error('FAIL:', msg);
  process.exit(1);
};
const ok = (msg: string) => {
  pass++;
  console.log('ok -', msg);
};

async function main() {
  const buf = await readFile('public/fixtures/holey-cube.glb');
  const loader = new GLTFLoader();
  const gltf = await new Promise<Awaited<ReturnType<typeof loader.parseAsync>>>(
    (resolve, reject) => {
      try {
        loader.parse(
          buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
          '',
          (g) => resolve(g),
          (e) => reject(e),
        );
      } catch (e) {
        reject(e);
      }
    },
  );

  // A. The useGLTF wrapper shape — the root cause. The wrapper has no
  //    .traverse; only gltf.scene (THREE.Group / Object3D) does.
  assert.strictEqual(typeof (gltf as { traverse?: unknown }).traverse, 'undefined', 'wrapper must not have .traverse');
  assert.strictEqual(typeof ((gltf as { scene: THREE.Object3D }).scene.traverse), 'function', 'gltf.scene must have .traverse');
  ok('useGLTF wrapper has no .traverse; gltf.scene does (root cause present)');

  // B. Fixed path: collectPaintMeshes(gltf.scene) returns the mesh names
  //    instead of throwing. This is the call the sidebar now makes.
  const viaScene = collectPaintMeshes((gltf as { scene: THREE.Object3D }).scene);
  assert.ok(Array.isArray(viaScene), 'collectPaintMeshes returns an array');
  assert.ok(viaScene.length > 0, 'holey-cube.glb should expose at least one named mesh');
  ok(`collectPaintMeshes(gltf.scene) -> ${JSON.stringify(viaScene)} (no throw)`);

  // C. Null / cold-cache path: usePaintScene returns null while the GLB is
  //    still suspending; the list must read empty, not crash.
  const viaNull = collectPaintMeshes(null);
  assert.deepStrictEqual(viaNull, [], 'collectPaintMeshes(null) -> []');
  ok('collectPaintMeshes(null) -> [] (cold/pending state returns empty, no throw)');

  // D. Regression guard: the pre-fix call path — handing the wrapper in
  //    instead of gltf.scene — must throw the exact TypeError from the bug
  //    report. After the fix the param is typed Object3D | null, so the
  //    wrapper is a compile error; we force the runtime behaviour via an
  //    unknown cast to prove the wrapper-vs-.scene mismatch still bites.
  try {
    collectPaintMeshes(gltf as unknown as THREE.Object3D);
    fail('regression guard: passing the wrapper did NOT throw (expected TypeError)');
  } catch (e) {
    assert.ok(e instanceof TypeError, `expected TypeError, got ${(e as Error).name}`);
    assert.match((e as Error).message, /traverse is not a function/);
    ok(`regression guard: wrapper path throws ${(e as Error).name}: ${(e as Error).message}`);
  }

  console.log(`\n${pass} pass / 0 fail`);
}

main().catch((e) => {
  console.error('FAIL:', e.message ?? e);
  process.exit(1);
});
