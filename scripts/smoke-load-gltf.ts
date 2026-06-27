// Smoke test: load a real .glb via three's GLTFLoader from Node and dump scene info.
// Proves the loader path used by MeshRenderer actually parses real GLBs.
// Three's loaders use `self` in some code paths — polyfill for Node.
(globalThis as unknown as { self: typeof globalThis }).self = globalThis;
const { readFile } = await import('node:fs/promises');
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const { NodeIO } = await import('@gltf-transform/core');

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: tsx scripts/smoke-load-gltf.ts <file.glb>');
    process.exit(2);
  }

  // Method A: three's GLTFLoader (the one R3F uses)
  const buf = await readFile(path);
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

  const scene = gltf.scene;
  let meshCount = 0;
  let triCount = 0;
  scene.traverse((o) => {
    const m = o as unknown as { isMesh?: boolean; geometry?: { index?: { count: number } | null; attributes?: { position?: { count: number } } } };
    if (m.isMesh) {
      meshCount++;
      const idx = m.geometry?.index;
      const pos = m.geometry?.attributes?.position;
      triCount += idx ? idx.count / 3 : (pos ? pos.count / 3 : 0);
    }
  });

  console.log(JSON.stringify({
    via: 'three.GLTFLoader',
    meshes: meshCount,
    triangles: Math.round(triCount),
    children: scene.children.length,
    animations: gltf.animations.length,
  }, null, 2));

  // Method B: gltf-transform as a cross-check
  try {
    const io = new NodeIO();
    const doc = await io.read(path);
    const meshes = doc.getRoot().listMeshes();
    let accessors = 0;
    for (const m of meshes) {
      accessors += m.listPrimitives().length;
    }
    console.log(JSON.stringify({
      via: 'gltf-transform',
      meshes: meshes.length,
      primitives: accessors,
    }, null, 2));
  } catch (e) {
    console.warn('gltf-transform cross-check skipped:', (e as Error).message);
  }
}

main().catch((e) => {
  console.error('FAIL:', e.message ?? e);
  process.exit(1);
});