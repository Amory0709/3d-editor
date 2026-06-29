/**
 * Phase 4b verification: physics world mirrors the editor's asset graph.
 *
 * Pure-Node + tsx; no browser / dev server / playwright needed.
 * Exercises the real cannon-es world: bodies, transforms, shapes,
 * scale handling, lifecycle (add/remove/clear).
 */
import * as CANNON from 'cannon-es';
import { useEditor } from '@/store/editor';
import { DEFAULT_COLLIDER, type ColliderSpec } from '@/lib/formats';
import {
  getBodyCount,
  getBodyForAsset,
  getPhysicsWorld,
  resetPhysicsWorld,
  stepWorld,
  syncBodies,
} from '@/lib/physics';

const RESULTS: Array<{ name: string; pass: boolean; detail?: string }> = [];

function check(name: string, cond: boolean, detail?: string): void {
  RESULTS.push({ name, pass: cond, detail });
}

function approx(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}

function v3eq(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  eps = 1e-6,
): boolean {
  return approx(a.x, b.x, eps) && approx(a.y, b.y, eps) && approx(a.z, b.z, eps);
}

function reset(): void {
  useEditor.getState().resetHistoryForTest();
  // Wipe assets via removeAsset in a loop; resetHistoryForTest doesn't
  // touch the assets array itself.
  const ids = useEditor.getState().assets.map((a) => a.id);
  for (const id of ids) useEditor.getState().removeAsset(id);
  resetPhysicsWorld();
}

// ─── Test 1: world is lazily created ───────────────────────────────
{
  reset();
  const w = getPhysicsWorld();
  check('1. world lazily created', w instanceof CANNON.World);
}

// ─── Test 2: gravity is -9.81 on Y ─────────────────────────────────
{
  reset();
  const w = getPhysicsWorld();
  check(
    '2. gravity = (0, -9.81, 0)',
    v3eq(w.gravity, new CANNON.Vec3(0, -9.81, 0)),
    `gravity=${JSON.stringify(w.gravity)}`,
  );
}

// ─── Test 3: no assets → no bodies ─────────────────────────────────
{
  reset();
  syncBodies(useEditor.getState().assets);
  check('3. no assets → 0 bodies', getBodyCount() === 0, `count=${getBodyCount()}`);
}

// ─── Test 4: asset with collider → 1 body, type matches ────────────
{
  reset();
  useEditor.getState().addPrimitive('cube');
  useEditor.getState().setAssetCollider(
    useEditor.getState().activeAssetId!,
    DEFAULT_COLLIDER.box,
  );
  syncBodies(useEditor.getState().assets);
  const id = useEditor.getState().assets[0].id;
  const body = getBodyForAsset(id);
  check(
    '4. asset with box collider → 1 body, shape = Box',
    body !== null && body.shapes.length === 1 && body.shapes[0] instanceof CANNON.Box,
    `shapes=${body?.shapes.map((s) => s.constructor.name).join(',')}`,
  );
}

// ─── Test 5: each collider type produces the right shape ──────────
{
  reset();
  const types: Array<{ t: ColliderSpec['type']; expected: string }> = [
    { t: 'box', expected: 'Box' },
    { t: 'sphere', expected: 'Sphere' },
    { t: 'cylinder', expected: 'Cylinder' },
    { t: 'capsule', expected: 'compound(1 Cylinder + 2 Sphere)' },
  ];
  const results: string[] = [];
  for (const { t, expected } of types) {
    useEditor.getState().addPrimitive('cube');
    const id = useEditor.getState().activeAssetId!;
    useEditor.getState().setAssetCollider(id, DEFAULT_COLLIDER[t]);
    syncBodies(useEditor.getState().assets);
    const body = getBodyForAsset(id);
    if (!body) {
      results.push(`${t}=NO_BODY`);
      continue;
    }
    const shapeNames = body.shapes.map((s) => s.constructor.name).join('+');
    if (t === 'capsule') {
      const ok =
        body.shapes.length === 3 &&
        body.shapes[0] instanceof CANNON.Cylinder &&
        body.shapes[1] instanceof CANNON.Sphere &&
        body.shapes[2] instanceof CANNON.Sphere;
      results.push(`capsule=${ok ? 'compound ok' : `WRONG(${shapeNames})`}`);
    } else {
      const ok = body.shapes.length === 1 && body.shapes[0].constructor.name === expected;
      results.push(`${t}=${ok ? 'ok' : `WRONG(${shapeNames})`}`);
    }
    // Wipe before next iteration
    useEditor.getState().removeAsset(id);
  }
  const allOk = results.every((r) => r.includes('ok') || r.includes('compound ok'));
  check('5. all 4 collider types produce the right cannon shape', allOk, results.join(', '));
}

// ─── Test 6: body position mirrors asset position ─────────────────
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id, DEFAULT_COLLIDER.sphere);
  useEditor.getState().setAssetTransform(id, {
    position: [1.5, -2.5, 3.75],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  });
  syncBodies(useEditor.getState().assets);
  const body = getBodyForAsset(id)!;
  check(
    '6. body position = asset position',
    v3eq(body.position, new CANNON.Vec3(1.5, -2.5, 3.75)),
    `body.pos=${JSON.stringify(body.position)}`,
  );
}

// ─── Test 7: body quaternion mirrors asset rotation ───────────────
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id, DEFAULT_COLLIDER.box);
  useEditor.getState().setAssetTransform(id, {
    position: [0, 0, 0],
    rotation: [Math.PI / 2, 0, Math.PI / 4],
    scale: [1, 1, 1],
  });
  syncBodies(useEditor.getState().assets);
  const body = getBodyForAsset(id)!;
  // The expected quaternion is the result of XYZ Euler (π/2, 0, π/4).
  const expected = new CANNON.Quaternion();
  expected.setFromEuler(Math.PI / 2, 0, Math.PI / 4, 'XYZ');
  const q = body.quaternion;
  const ok = approx(q.x, expected.x, 1e-5) && approx(q.y, expected.y, 1e-5) && approx(q.z, expected.z, 1e-5) && approx(q.w, expected.w, 1e-5);
  check(
    '7. body quaternion = asset rotation (XYZ Euler)',
    ok,
    `got(${q.x.toFixed(4)}, ${q.y.toFixed(4)}, ${q.z.toFixed(4)}, ${q.w.toFixed(4)})`,
  );
}

// ─── Test 8: body is static (mass=0) ────────────────────────────────
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id, DEFAULT_COLLIDER.sphere);
  syncBodies(useEditor.getState().assets);
  const body = getBodyForAsset(id)!;
  check('8. body mass = 0 (static)', body.mass === 0 && body.type === CANNON.Body.STATIC, `mass=${body.mass} type=${body.type}`);
}

// ─── Test 9: scale (2, 1, 1) bakes into box halfExtents ───────────
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id, { type: 'box', halfExtents: [0.5, 0.5, 0.5] });
  useEditor.getState().setAssetTransform(id, {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [2, 1, 1],
  });
  syncBodies(useEditor.getState().assets);
  const body = getBodyForAsset(id)!;
  const box = body.shapes[0] as CANNON.Box;
  const he = box.halfExtents;
  check(
    '9. box scale (2,1,1) bakes into halfExtents',
    approx(he.x, 1.0) && approx(he.y, 0.5) && approx(he.z, 0.5),
    `halfExtents=(${he.x}, ${he.y}, ${he.z})`,
  );
}

// ─── Test 10: sphere scale (3,1,1) → radius = 1.8 (uses max) ───────
{
  reset();
  useEditor.getState().addPrimitive('sphere');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id, { type: 'sphere', radius: 0.6 });
  useEditor.getState().setAssetTransform(id, {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [3, 1, 1],
  });
  syncBodies(useEditor.getState().assets);
  const body = getBodyForAsset(id)!;
  const sphere = body.shapes[0] as CANNON.Sphere;
  check('10. sphere scale (3,1,1) → radius = 1.8 (uses max axis)', approx(sphere.radius, 1.8), `radius=${sphere.radius}`);
}

// ─── Test 11: capsule has cylinder + 2 spheres, with proper offsets
{
  reset();
  useEditor.getState().addPrimitive('cylinder');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id, { type: 'capsule', radius: 0.4, height: 1.2 });
  syncBodies(useEditor.getState().assets);
  const body = getBodyForAsset(id)!;
  const cyl = body.shapes[0] as CANNON.Cylinder;
  const top = body.shapes[1] as CANNON.Sphere;
  const bot = body.shapes[2] as CANNON.Sphere;
  const topOffset = body.shapeOffsets[1];
  const botOffset = body.shapeOffsets[2];
  check(
    '11. capsule = cylinder(0.4,0.4,1.2) + sphere(r=0.4) at y=±0.6',
    body.shapes.length === 3 &&
      cyl instanceof CANNON.Cylinder &&
      top instanceof CANNON.Sphere &&
      bot instanceof CANNON.Sphere &&
      approx(topOffset.y, 0.6) &&
      approx(botOffset.y, -0.6) &&
      approx(top.radius, 0.4) &&
      approx(bot.radius, 0.4),
    `shapes=${body.shapes.length} offsets=(${topOffset.y}, ${botOffset.y})`,
  );
}

// ─── Test 12: removing an asset removes its body ───────────────────
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id1 = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id1, DEFAULT_COLLIDER.box);
  useEditor.getState().addPrimitive('sphere');
  const id2 = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id2, DEFAULT_COLLIDER.sphere);
  syncBodies(useEditor.getState().assets);
  check('12a. 2 collider assets → 2 bodies', getBodyCount() === 2, `count=${getBodyCount()}`);
  useEditor.getState().removeAsset(id1);
  syncBodies(useEditor.getState().assets);
  check(
    '12b. removing 1 asset → 1 body',
    getBodyCount() === 1 && getBodyForAsset(id1) === null && getBodyForAsset(id2) !== null,
    `count=${getBodyCount()}`,
  );
}

// ─── Test 13: clearing the collider removes the body ──────────────
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id, DEFAULT_COLLIDER.box);
  syncBodies(useEditor.getState().assets);
  check('13a. box collider → 1 body', getBodyCount() === 1);
  useEditor.getState().setAssetCollider(id, null);
  syncBodies(useEditor.getState().assets);
  check('13b. clear collider → 0 bodies', getBodyCount() === 0, `count=${getBodyCount()}`);
}

// ─── Test 14: changing collider type rebuilds the body ─────────────
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id, DEFAULT_COLLIDER.box);
  syncBodies(useEditor.getState().assets);
  const before = getBodyForAsset(id)!;
  const beforeBox = before.shapes[0] as CANNON.Box;
  useEditor.getState().setAssetCollider(id, DEFAULT_COLLIDER.sphere);
  syncBodies(useEditor.getState().assets);
  const after = getBodyForAsset(id)!;
  const afterSphere = after.shapes[0] as CANNON.Sphere;
  check(
    '14. changing type box→sphere rebuilds body with new shape',
    before !== after && beforeBox instanceof CANNON.Box && afterSphere instanceof CANNON.Sphere,
    `before shape=${before.shapes[0].constructor.name} after shape=${after.shapes[0].constructor.name}`,
  );
}

// ─── Test 15: position-only update reuses the same body ────────────
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id, DEFAULT_COLLIDER.box);
  syncBodies(useEditor.getState().assets);
  const first = getBodyForAsset(id);
  useEditor.getState().setAssetTransform(id, {
    position: [5, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  });
  syncBodies(useEditor.getState().assets);
  const second = getBodyForAsset(id);
  check(
    '15. position-only update reuses same body instance',
    first === second && v3eq(second!.position, new CANNON.Vec3(5, 0, 0)),
    `pos=${JSON.stringify(second?.position)}`,
  );
}

// ─── Test 16: world.step on a static body does not move it ─────────
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id, DEFAULT_COLLIDER.sphere);
  syncBodies(useEditor.getState().assets);
  const body = getBodyForAsset(id)!;
  const posBefore = { x: body.position.x, y: body.position.y, z: body.position.z };
  stepWorld(1 / 60);
  stepWorld(1 / 60);
  stepWorld(1 / 60);
  check(
    '16. stepping 3 frames leaves static body at origin',
    v3eq(body.position, posBefore),
    `pos before=${JSON.stringify(posBefore)} after=${JSON.stringify(body.position)}`,
  );
}

// ─── Test 17: resetPhysicsWorld clears everything ──────────────────
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id, DEFAULT_COLLIDER.box);
  syncBodies(useEditor.getState().assets);
  check('17a. 1 body before reset', getBodyCount() === 1);
  resetPhysicsWorld();
  check('17b. resetPhysicsWorld → 0 bodies', getBodyCount() === 0);
  const w = getPhysicsWorld();
  check('17c. world is fresh singleton after reset', w.bodies.length === 0, `bodies=${w.bodies.length}`);
}

// ─── Test 18: mixed (some with, some without collider) ────────────
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const idA = useEditor.getState().activeAssetId!;
  useEditor.getState().addPrimitive('sphere');
  const idB = useEditor.getState().activeAssetId!;
  useEditor.getState().addPrimitive('cylinder');
  const idC = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(idA, DEFAULT_COLLIDER.box);
  // idB has no collider
  useEditor.getState().setAssetCollider(idC, DEFAULT_COLLIDER.cylinder);
  syncBodies(useEditor.getState().assets);
  check(
    '18. mixed: 2 of 3 assets with collider → 2 bodies',
    getBodyCount() === 2 &&
      getBodyForAsset(idA) !== null &&
      getBodyForAsset(idB) === null &&
      getBodyForAsset(idC) !== null,
    `count=${getBodyCount()}`,
  );
}

// ─── Test 19: scale change rebuilds body (new instance) ────────────
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id, DEFAULT_COLLIDER.box);
  syncBodies(useEditor.getState().assets);
  const before = getBodyForAsset(id);
  useEditor.getState().setAssetTransform(id, {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [2, 2, 2], // scale change
  });
  syncBodies(useEditor.getState().assets);
  const after = getBodyForAsset(id);
  const box = after!.shapes[0] as CANNON.Box;
  check(
    '19. scale change rebuilds body with new halfExtents',
    before !== after && approx(box.halfExtents.x, 1.0),
    `same instance=${before === after} half.x=${box.halfExtents.x}`,
  );
}

// ─── Test 20: undo/redo on setAssetCollider syncs correctly ───────
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id, DEFAULT_COLLIDER.box);
  useEditor.getState().setAssetCollider(id, DEFAULT_COLLIDER.sphere);
  syncBodies(useEditor.getState().assets);
  check('20a. sphere body present', getBodyForAsset(id)!.shapes[0] instanceof CANNON.Sphere);
  useEditor.getState().undo();
  syncBodies(useEditor.getState().assets);
  check(
    '20b. undo → box body present',
    getBodyForAsset(id)!.shapes[0] instanceof CANNON.Box,
  );
  useEditor.getState().redo();
  syncBodies(useEditor.getState().assets);
  check(
    '20c. redo → sphere body present',
    getBodyForAsset(id)!.shapes[0] instanceof CANNON.Sphere,
  );
}

// ─── Summary ──────────────────────────────────────────────────────
const passed = RESULTS.filter((r) => r.pass).length;
const failed = RESULTS.length - passed;
console.log('── physics verification ──\n');
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
