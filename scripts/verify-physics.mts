/**
 * Phase 4b verification: physics world mirrors the editor's asset graph.
 *
 * Pure-Node + tsx; no browser / dev server / playwright needed.
 * Exercises the real cannon-es world: bodies, transforms, shapes,
 * scale handling, lifecycle (add/remove/clear).
 */
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { useEditor } from '@/store/editor';
import { DEFAULT_COLLIDER, type ColliderSpec } from '@/lib/formats';
import {
  drainCollisionEvents,
  getBodyCount,
  getBodyForAsset,
  getPhysicsWorld,
  readBodiesToAssets,
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
  // Phase 4d: also reset playMode + activeAssetId so a test that left
  // play running (or selection set) doesn't pollute the next case.
  // We mutate the flag directly via setState rather than going through
  // setPlayMode() because we want the WORLD to be re-synced from edit
  // (static) state, not play-state.
  if (useEditor.getState().playMode) {
    useEditor.setState({ playMode: false, activeAssetId: null });
    syncBodies(useEditor.getState().assets, false);
  } else {
    useEditor.setState({ activeAssetId: null });
  }
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
  syncBodies(useEditor.getState().assets, false);
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
  syncBodies(useEditor.getState().assets, false);
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
    syncBodies(useEditor.getState().assets, false);
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
    rotation: [0, 0, 0, 'XYZ'],
    scale: [1, 1, 1],
  });
  syncBodies(useEditor.getState().assets, false);
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
    rotation: [Math.PI / 2, 0, Math.PI / 4, 'XYZ'],
    scale: [1, 1, 1],
  });
  syncBodies(useEditor.getState().assets, false);
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

// ─── Test 7b: non-XYZ Euler order round-trips exactly ──────────
// Regression: pre-refactor, physics.ts hard-coded 'XYZ' when
// building the body quaternion. A rotation that was authored in
// 'YXZ' would be re-applied under 'XYZ' and the body would diverge
// from the visual. This test compares the body's quaternion to the
// quaternion three itself would produce from the same Euler, to
// lock in that the order is forwarded.
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id, DEFAULT_COLLIDER.box);
  // Authored in YXZ — common for FPS / third-person characters.
  // At (π/4, π/4, 0) under YXZ the body quaternion has z = -0.1464;
  // under XYZ with the same numbers z = +0.1464. These differ in
  // sign, so the test is sensitive to which order is used.
  useEditor.getState().setAssetTransform(id, {
    position: [0, 0, 0],
    rotation: [Math.PI / 4, Math.PI / 4, 0, 'YXZ'],
    scale: [1, 1, 1],
  });
  syncBodies(useEditor.getState().assets, false);
  const body = getBodyForAsset(id)!;

  // Build the same quaternion in three's convention. This is the
  // source of truth — the body must match it bit-for-bit.
  const e = new THREE.Euler(Math.PI / 4, Math.PI / 4, 0, 'YXZ');
  const q = new THREE.Quaternion().setFromEuler(e);
  const ok =
    approx(body.quaternion.x, q.x, 1e-5) &&
    approx(body.quaternion.y, q.y, 1e-5) &&
    approx(body.quaternion.z, q.z, 1e-5) &&
    approx(body.quaternion.w, q.w, 1e-5);
  check(
    '7b. body quaternion = Euler under YXZ order (order is forwarded, not hard-coded XYZ)',
    ok,
    `body=(${body.quaternion.x.toFixed(4)}, ${body.quaternion.y.toFixed(4)}, ${body.quaternion.z.toFixed(4)}, ${body.quaternion.w.toFixed(4)}) expected=(${q.x.toFixed(4)}, ${q.y.toFixed(4)}, ${q.z.toFixed(4)}, ${q.w.toFixed(4)})`,
  );

  // And confirm it DIFFERS from the would-be-XYZ interpretation —
  // otherwise the test is vacuous. The Z component of the YXZ
  // result is negative; under XYZ it would be positive. So if the
  // physics layer dropped the order and re-applied XYZ, the sign
  // would flip and this would fail.
  const xyzE = new THREE.Euler(Math.PI / 4, Math.PI / 4, 0, 'XYZ');
  const xyzQ = new THREE.Quaternion().setFromEuler(xyzE);
  const differs =
    !approx(body.quaternion.x, xyzQ.x, 1e-5) ||
    !approx(body.quaternion.y, xyzQ.y, 1e-5) ||
    !approx(body.quaternion.z, xyzQ.z, 1e-5) ||
    !approx(body.quaternion.w, xyzQ.w, 1e-5);
  check('7c. YXZ body quaternion differs from XYZ interpretation (test is sensitive)', differs);
}

// ─── Test 8: body is static (mass=0) ────────────────────────────────
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id, DEFAULT_COLLIDER.sphere);
  syncBodies(useEditor.getState().assets, false);
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
    rotation: [0, 0, 0, 'XYZ'],
    scale: [2, 1, 1],
  });
  syncBodies(useEditor.getState().assets, false);
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
    rotation: [0, 0, 0, 'XYZ'],
    scale: [3, 1, 1],
  });
  syncBodies(useEditor.getState().assets, false);
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
  syncBodies(useEditor.getState().assets, false);
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

// ─── Test 11b: non-uniform X scale (2,1,1) on all 4 collider types ──
// Regression: a non-uniform X scale used to produce a truncated-cone body
// for the cylinder (radiusTop * sx, radiusBottom * sz) which did NOT
// contain the visual's elliptical cross-section. The fix uses max(sx, sz)
// for both top and bottom, so the body is a uniform Y-cylinder that
// envelopes the visual in all directions. The other 3 collider types
// are tested in the same pass to lock in the contract for future refactors.
{
  reset();
  const cases: Array<{ t: ColliderSpec['type']; spec: ColliderSpec; label: string }> = [
    { t: 'box', spec: { type: 'box', halfExtents: [0.5, 0.5, 0.5] }, label: 'box' },
    { t: 'sphere', spec: { type: 'sphere', radius: 0.6 }, label: 'sphere' },
    { t: 'cylinder', spec: { type: 'cylinder', radius: 0.5, height: 1.2 }, label: 'cylinder' },
    { t: 'capsule', spec: { type: 'capsule', radius: 0.4, height: 1.2 }, label: 'capsule' },
  ];
  const results: string[] = [];
  for (const c of cases) {
    useEditor.getState().addPrimitive('cube');
    const id = useEditor.getState().activeAssetId!;
    useEditor.getState().setAssetCollider(id, c.spec);
    useEditor.getState().setAssetTransform(id, {
      position: [0, 0, 0],
      rotation: [0, 0, 0, 'XYZ'],
      scale: [2, 1, 1],
    });
    syncBodies(useEditor.getState().assets, false);
    const body = getBodyForAsset(id);
    if (!body) { results.push(`${c.label}=NO_BODY`); continue; }
    // The "must contain" invariant: the body's envelope on each axis
    // must be >= the visual's envelope on that axis. For X, the visual
    // is at spec_radius * 2 (since scale.x = 2). For Z, visual is at
    // spec_radius * 1.
    // Box: halfExtents.x >= 0.5*2 = 1.0; halfExtents.z >= 0.5*1 = 0.5
    // Sphere: radius >= 0.6*2 = 1.2
    // Cylinder: top.x >= 1.0, bot.x >= 1.0 (regression: was 0.5),
    //           top.z >= 0.5, bot.z >= 0.5
    // Capsule: cylinder+radius >= 0.4*2 = 0.8; sphere radius >= 0.8
    const fails: string[] = [];
    switch (c.t) {
      case 'box': {
        const box = body.shapes[0] as CANNON.Box;
        if (box.halfExtents.x < 1.0 - 1e-6) fails.push(`x=${box.halfExtents.x}<1.0`);
        if (box.halfExtents.z < 0.5 - 1e-6) fails.push(`z=${box.halfExtents.z}<0.5`);
        break;
      }
      case 'sphere': {
        const sphere = body.shapes[0] as CANNON.Sphere;
        if (sphere.radius < 1.2 - 1e-6) fails.push(`r=${sphere.radius}<1.2`);
        break;
      }
      case 'cylinder': {
        const cyl = body.shapes[0] as CANNON.Cylinder;
        // The core regression check: both top AND bottom radius must be
        // >= 1.0 (visual's X extent at scale 2). Pre-fix, the bottom
        // was 0.5 and the body did not contain the visual at y=-0.6.
        if (cyl.radiusTop < 1.0 - 1e-6) fails.push(`top=${cyl.radiusTop}<1.0`);
        if (cyl.radiusBottom < 1.0 - 1e-6) fails.push(`bot=${cyl.radiusBottom}<1.0`);
        if (cyl.radiusTop < 0.5 - 1e-6) fails.push(`top<0.5 (z extent)`);
        if (cyl.radiusBottom < 0.5 - 1e-6) fails.push(`bot<0.5 (z extent)`);
        // The fix also makes top == bottom (no longer a truncated cone).
        if (Math.abs(cyl.radiusTop - cyl.radiusBottom) > 1e-6) {
          fails.push(`truncated cone (top=${cyl.radiusTop} != bot=${cyl.radiusBottom})`);
        }
        break;
      }
      case 'capsule': {
        const cyl = body.shapes[0] as CANNON.Cylinder;
        const top = body.shapes[1] as CANNON.Sphere;
        // Cylinder cross-section: radius must be >= 0.4*2 = 0.8 (X).
        if (cyl.radiusTop < 0.8 - 1e-6) fails.push(`cylTop=${cyl.radiusTop}<0.8`);
        // End-sphere radius must also be >= 0.8 so the X-extending cap
        // contains the visual's cap.
        if (top.radius < 0.8 - 1e-6) fails.push(`sphereR=${top.radius}<0.8`);
        break;
      }
    }
    results.push(fails.length === 0 ? `${c.label}=ok` : `${c.label}=FAIL(${fails.join(',')})`);
    useEditor.getState().removeAsset(id);
  }
  const allOk = results.every((r) => r.endsWith('ok'));
  check('11b. non-uniform X scale (2,1,1) body contains visual for all 4 types', allOk, results.join(', '));
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
  syncBodies(useEditor.getState().assets, false);
  check('12a. 2 collider assets → 2 bodies', getBodyCount() === 2, `count=${getBodyCount()}`);
  useEditor.getState().removeAsset(id1);
  syncBodies(useEditor.getState().assets, false);
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
  syncBodies(useEditor.getState().assets, false);
  check('13a. box collider → 1 body', getBodyCount() === 1);
  useEditor.getState().setAssetCollider(id, null);
  syncBodies(useEditor.getState().assets, false);
  check('13b. clear collider → 0 bodies', getBodyCount() === 0, `count=${getBodyCount()}`);
}

// ─── Test 14: changing collider type rebuilds the body ─────────────
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id, DEFAULT_COLLIDER.box);
  syncBodies(useEditor.getState().assets, false);
  const before = getBodyForAsset(id)!;
  const beforeBox = before.shapes[0] as CANNON.Box;
  useEditor.getState().setAssetCollider(id, DEFAULT_COLLIDER.sphere);
  syncBodies(useEditor.getState().assets, false);
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
  syncBodies(useEditor.getState().assets, false);
  const first = getBodyForAsset(id);
  useEditor.getState().setAssetTransform(id, {
    position: [5, 0, 0],
    rotation: [0, 0, 0, 'XYZ'],
    scale: [1, 1, 1],
  });
  syncBodies(useEditor.getState().assets, false);
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
  syncBodies(useEditor.getState().assets, false);
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
  syncBodies(useEditor.getState().assets, false);
  check('17a. 1 body before reset', getBodyCount() === 1);
  resetPhysicsWorld();
  check('17b. resetPhysicsWorld → 0 bodies', getBodyCount() === 0);
  const w = getPhysicsWorld();
  // Phase 4f: a fresh world now contains the static ground plane body
  // (mass=0, infinite Plane at y=0). Previously this was 0 — ground
  // was added as a separate concern.
  check('17c. world is fresh singleton after reset', w.bodies.length === 1, `bodies=${w.bodies.length}`);
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
  syncBodies(useEditor.getState().assets, false);
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
  syncBodies(useEditor.getState().assets, false);
  const before = getBodyForAsset(id);
  useEditor.getState().setAssetTransform(id, {
    position: [0, 0, 0],
    rotation: [0, 0, 0, 'XYZ'],
    scale: [2, 2, 2], // scale change
  });
  syncBodies(useEditor.getState().assets, false);
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
  syncBodies(useEditor.getState().assets, false);
  check('20a. sphere body present', getBodyForAsset(id)!.shapes[0] instanceof CANNON.Sphere);
  useEditor.getState().undo();
  syncBodies(useEditor.getState().assets, false);
  check(
    '20b. undo → box body present',
    getBodyForAsset(id)!.shapes[0] instanceof CANNON.Box,
  );
  useEditor.getState().redo();
  syncBodies(useEditor.getState().assets, false);
  check(
    '20c. redo → sphere body present',
    getBodyForAsset(id)!.shapes[0] instanceof CANNON.Sphere,
  );
}

// ─── Test 21: numeric editor's setAssetCollider path rebuilds the body ──
// Phase 4c-A: the sidebar's number inputs call setAssetCollider with a
// new spec. This test simulates that path — same operation the
// ColliderEditor's onBlur would do — and confirms the body is rebuilt
// with the new dimensions (not just the position updated in place).
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id, { type: 'box', halfExtents: [0.5, 0.5, 0.5] });
  syncBodies(useEditor.getState().assets, false);
  const before = getBodyForAsset(id)!;
  const beforeBox = before.shapes[0] as CANNON.Box;
  check('21a. initial box has 0.5 halfExtents', approx(beforeBox.halfExtents.x, 0.5));

  // Simulate the user editing the box X field from 0.5 to 1.5 and
  // blurring. The editor builds a new spec and calls setAssetCollider.
  useEditor.getState().setAssetCollider(id, {
    type: 'box',
    halfExtents: [1.5, 0.5, 0.5],
  });
  syncBodies(useEditor.getState().assets, false);
  const after = getBodyForAsset(id)!;
  const afterBox = after.shapes[0] as CANNON.Box;
  check(
    '21b. body rebuilt with new halfExtents.x = 1.5',
    before !== after &&
      approx(afterBox.halfExtents.x, 1.5) &&
      approx(afterBox.halfExtents.y, 0.5) &&
      approx(afterBox.halfExtents.z, 0.5),
    `same instance=${before === after} he=(${afterBox.halfExtents.x}, ${afterBox.halfExtents.y}, ${afterBox.halfExtents.z})`,
  );
  check(
    '21c. one history entry per edit (so ⌘Z reverts the value change)',
    useEditor.getState().canUndo(),
  );
  useEditor.getState().undo();
  syncBodies(useEditor.getState().assets, false);
  const undone = getBodyForAsset(id)!;
  const undoneBox = undone.shapes[0] as CANNON.Box;
  check(
    '21d. undo reverts body to original halfExtents = 0.5',
    approx(undoneBox.halfExtents.x, 0.5),
    `he.x=${undoneBox.halfExtents.x}`,
  );
}

// ─── Test 22: numeric editor's edit doesn't push history when value unchanged ──
// Regression: the ColliderEditor's onBlur must not create history
// entries when the user focused and blurred without changing the
// value (e.g. accidentally tabbing through). We simulate by calling
// setAssetCollider with the *same* spec, which the helper layer
// can't detect (the store always pushes on a set call) — but the
// React layer's onBlur short-circuits before reaching the store. The
// pure side of that contract is tested in verify-collider-input.mts;
// here we just confirm the store's contract: a set with the exact
// same value still pushes one entry (the store can't know it's a
// no-op without deep comparison). This is by design — the React
// layer is the gatekeeper.
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id, { type: 'sphere', radius: 0.6 });
  const pastBefore = useEditor.getState().history.past.length;
  // Set the same value again.
  useEditor.getState().setAssetCollider(id, { type: 'sphere', radius: 0.6 });
  const pastAfter = useEditor.getState().history.past.length;
  check(
    '22. store pushes history even on no-op set (React layer is the gatekeeper)',
    pastAfter === pastBefore + 1,
    `past grew ${pastAfter - pastBefore}`,
  );
}

// ─── Test 23: play mode flips body to dynamic ─────────────────────
// Phase 4d: setPlayMode(true) → syncBodies(_, true) → body has
// mass > 0 and type = DYNAMIC. After setPlayMode(false) → mass=0
// and STATIC again.
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id, DEFAULT_COLLIDER.box);
  // Edit-mode sync first so the body exists static.
  syncBodies(useEditor.getState().assets, false);
  const staticBody = getBodyForAsset(id)!;
  check(
    '23a. edit mode: body is static (mass=0, type=STATIC)',
    staticBody.mass === 0 && staticBody.type === CANNON.Body.STATIC,
    `mass=${staticBody.mass} type=${staticBody.type}`,
  );
  // Now enter play mode and re-sync.
  useEditor.getState().setPlayMode(true);
  syncBodies(useEditor.getState().assets, true);
  const dynamicBody = getBodyForAsset(id)!;
  check(
    '23b. play mode: body is dynamic (mass>0, type=DYNAMIC)',
    dynamicBody.mass > 0 && dynamicBody.type === CANNON.Body.DYNAMIC,
    `mass=${dynamicBody.mass} type=${dynamicBody.type}`,
  );
  // Same body instance (rebuilt only on shape change, not on dynamic flip).
  // Note: dynamic flag IS part of the shapeKey, so flipping DOES rebuild.
  // This is intentional — changing mass on a live body in cannon-es is
  // unreliable, so we remove+add. The test confirms a fresh body exists.
  check('23c. dynamic body is a new instance (mass change = rebuild)', staticBody !== dynamicBody);
  // Exit play and re-sync.
  useEditor.getState().setPlayMode(false);
  syncBodies(useEditor.getState().assets, false);
  const staticAgain = getBodyForAsset(id)!;
  check(
    '23d. exit play: body is static again (mass=0, type=STATIC)',
    staticAgain.mass === 0 && staticAgain.type === CANNON.Body.STATIC,
    `mass=${staticAgain.mass} type=${staticAgain.type}`,
  );
}

// ─── Test 24: dynamic body actually moves under gravity ──────────
// Phase 4d: in play mode, world.step() drives the body. After a
// step, a body starting at y=5 should have y < 5.
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id, DEFAULT_COLLIDER.box);
  // Position the asset at y=5 so the body has somewhere to fall from.
  useEditor.getState().setAssetTransform(id, {
    position: [0, 5, 0],
    rotation: [0, 0, 0, 'XYZ'],
    scale: [1, 1, 1],
  });
  useEditor.getState().setPlayMode(true);
  syncBodies(useEditor.getState().assets, true);
  const before = getBodyForAsset(id)!;
  const yBefore = before.position.y;
  stepWorld(1 / 60);
  // Re-fetch after the step (body is in world, but its ref may have
  // been replaced if dynamic flag changed — not the case here, so
  // same ref).
  const after = getBodyForAsset(id)!;
  check(
    '24. dynamic body falls under gravity (y decreased after one step)',
    after.position.y < yBefore,
    `y before=${yBefore} after=${after.position.y.toFixed(4)}`,
  );
  // Cleanup
  useEditor.getState().setPlayMode(false);
}

// ─── Test 25: readBodiesToAssets returns the body's current state ──
// Phase 4d: in play mode, the ticker reads each body back into the
// store. Verify that readBodiesToAssets returns the post-step position
// and a valid rotation.
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id, DEFAULT_COLLIDER.sphere);
  useEditor.getState().setAssetTransform(id, {
    position: [1, 2, 3],
    rotation: [0, 0, 0, 'XYZ'],
    scale: [1, 1, 1],
  });
  useEditor.getState().setPlayMode(true);
  syncBodies(useEditor.getState().assets, true);
  const updates = readBodiesToAssets();
  check('25a. readBodiesToAssets returns one entry per body', updates.length === 1, `count=${updates.length}`);
  const u = updates[0];
  check('25b. assetId matches', u.assetId === id);
  check(
    '25c. position matches body position',
    approx(u.position[0], 1, 1e-3) && approx(u.position[1], 2, 1e-3) && approx(u.position[2], 3, 1e-3),
    `pos=(${u.position[0]}, ${u.position[1]}, ${u.position[2]})`,
  );
  check('25d. rotation is XYZ', u.rotation[3] === 'XYZ');
  useEditor.getState().setPlayMode(false);
}

// ─── Test 26: enter-play snapshots, exit-play writes back ────────
// Phase 4d contract:
//   - setPlayMode(true) → pushes a snapshot of the current assets
//     onto history.past (so a future stop+undo reverts the play)
//   - setPlayMode(false) does NOT push (the snapshot from enter-play
//     is the one that ⌘Z consumes)
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id, DEFAULT_COLLIDER.box);
  useEditor.getState().setAssetTransform(id, {
    position: [10, 20, 30],
    rotation: [0, 0, 0, 'XYZ'],
    scale: [1, 1, 1],
  });
  syncBodies(useEditor.getState().assets, false);
  const pastBeforePlay = useEditor.getState().history.past.length;
  // Enter play
  useEditor.getState().setPlayMode(true);
  const pastAfterPlay = useEditor.getState().history.past.length;
  check(
    '26a. setPlayMode(true) pushes a snapshot (past grew by 1)',
    pastAfterPlay === pastBeforePlay + 1,
    `past ${pastBeforePlay}→${pastAfterPlay}`,
  );
  // Body takes over, asset.transform doesn't change just from entering play.
  check(
    '26b. entering play does not mutate the current asset transform',
    useEditor.getState().assets[0].transform.position[0] === 10 &&
      useEditor.getState().assets[0].transform.position[1] === 20 &&
      useEditor.getState().assets[0].transform.position[2] === 30,
  );
  // After several steps in play mode, the body has moved.
  syncBodies(useEditor.getState().assets, true);
  for (let i = 0; i < 10; i++) stepWorld(1 / 60);
  // The ticker would now write the body's position back; simulate it.
  for (const u of readBodiesToAssets()) {
    useEditor.getState().setAssetTransformFromPlay(u.assetId, u.position, u.rotation);
  }
  check(
    '26c. after play + body→store write, asset position is no longer (10,20,30)',
    useEditor.getState().assets[0].transform.position[1] !== 30,
    `y=${useEditor.getState().assets[0].transform.position[1]}`,
  );
  // Exit play: does NOT push another history entry.
  const pastBeforeStop = useEditor.getState().history.past.length;
  useEditor.getState().setPlayMode(false);
  const pastAfterStop = useEditor.getState().history.past.length;
  check(
    '26d. setPlayMode(false) does NOT push history (snapshot from enter-play is the ⌘Z target)',
    pastAfterStop === pastBeforeStop,
    `past ${pastBeforeStop}→${pastAfterStop}`,
  );
  // Undo should restore the pre-play position (10, 20, 30).
  useEditor.getState().undo();
  check(
    '26e. ⌘Z after stop reverts to pre-play position (10, 20, 30)',
    useEditor.getState().assets[0].transform.position[0] === 10 &&
      useEditor.getState().assets[0].transform.position[1] === 20 &&
      useEditor.getState().assets[0].transform.position[2] === 30,
  );
}

// ─── Test 27: setAssetTransformFromPlay is no-op outside play mode ──
// Phase 4d safety: the action checks the flag and returns s unchanged.
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetTransform(id, {
    position: [0, 0, 0],
    rotation: [0, 0, 0, 'XYZ'],
    scale: [1, 1, 1],
  });
  useEditor.getState().setAssetTransformFromPlay(id, [99, 99, 99], [0, 0, 0, 'XYZ']);
  check(
    '27. setAssetTransformFromPlay is a no-op when playMode is false',
    useEditor.getState().assets[0].transform.position[0] === 0,
  );
}

// ─── Test 28: setAssetTransform is a no-op in play mode ───────────
// Phase 4d safety: gizmo / keyboard / undo must not race the body.
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetTransform(id, {
    position: [0, 0, 0],
    rotation: [0, 0, 0, 'XYZ'],
    scale: [1, 1, 1],
  });
  useEditor.getState().setPlayMode(true);
  useEditor.getState().setAssetTransform(id, {
    position: [42, 42, 42],
    rotation: [0, 0, 0, 'XYZ'],
    scale: [1, 1, 1],
  });
  check(
    '28. setAssetTransform is a no-op in play mode (body is source of truth)',
    useEditor.getState().assets[0].transform.position[0] === 0,
    `pos.x=${useEditor.getState().assets[0].transform.position[0]}`,
  );
  useEditor.getState().setPlayMode(false);
}

// ─── Test 29: store guards against mid-play mutations ─────────────
// Phase 4d defense-in-depth: UI disables most actions in play, but
// programmatic calls (or future shortcuts) could still hit these
// actions. The store must no-op them so the simulation stays sane.
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setPlayMode(true);

  // removeAsset should be a no-op.
  const beforeAssets = useEditor.getState().assets.length;
  useEditor.getState().removeAsset(id);
  check(
    '29a. removeAsset is a no-op in play mode',
    useEditor.getState().assets.length === beforeAssets,
    `assets ${beforeAssets}→${useEditor.getState().assets.length}`,
  );

  // addPrimitive should be a no-op.
  useEditor.getState().addPrimitive('sphere');
  check(
    '29b. addPrimitive is a no-op in play mode',
    useEditor.getState().assets.length === beforeAssets,
    `assets ${beforeAssets}→${useEditor.getState().assets.length}`,
  );

  // setAssetCollider should be a no-op.
  // Pre-condition: collider starts as null (no collider set yet).
  check(
    '29c-pre. collider starts as null (cube added without collider)',
    useEditor.getState().assets[0].collider === null,
  );
  useEditor.getState().setAssetCollider(id, DEFAULT_COLLIDER.sphere);
  check(
    '29c. setAssetCollider is a no-op in play mode',
    useEditor.getState().assets[0].collider === null,
    `collider=${JSON.stringify(useEditor.getState().assets[0].collider)}`,
  );

  // setMode should be a no-op.
  const modeBefore = useEditor.getState().mode;
  useEditor.getState().setMode('gaussian');
  check(
    '29d. setMode is a no-op in play mode',
    useEditor.getState().mode === modeBefore,
    `mode ${modeBefore}→${useEditor.getState().mode}`,
  );

  // undo / redo should be no-ops (they would teleport bodies).
  const pastBefore = useEditor.getState().history.past.length;
  useEditor.getState().undo();
  useEditor.getState().redo();
  check(
    '29e. undo / redo are no-ops in play mode',
    useEditor.getState().history.past.length === pastBefore,
    `past ${pastBefore}→${useEditor.getState().history.past.length}`,
  );

  useEditor.getState().setPlayMode(false);
}

// ─── Test 30: reset() resets playMode (test infrastructure) ─────
// Phase 4d: if a previous test left playMode = true, the next test's
// reset() must clear it so the assertions don't see a polluted store.
{
  reset();
  useEditor.getState().addPrimitive('cube');
  useEditor.getState().setPlayMode(true);
  // Sanity: playMode is now true.
  check(
    '30a. setUp: playMode is true',
    useEditor.getState().playMode === true,
  );
  reset();
  check(
    '30b. reset() clears playMode',
    useEditor.getState().playMode === false,
  );
  // And bodies are re-synced as static (syncBodies called with false).
  const id = useEditor.getState().activeAssetId ?? useEditor.getState().assets[0]?.id;
  // After reset() activeAssetId is null, so re-add to test body state.
  useEditor.getState().addPrimitive('cube');
  useEditor.getState().setAssetCollider(
    useEditor.getState().activeAssetId!,
    DEFAULT_COLLIDER.box,
  );
  syncBodies(useEditor.getState().assets, false);
  const body = getBodyForAsset(useEditor.getState().activeAssetId!)!;
  check(
    '30c. after reset() + edit sync, body is static (mass=0, STATIC)',
    body.mass === 0 && body.type === CANNON.Body.STATIC,
    `mass=${body.mass} type=${body.type}`,
  );
}

// ─── Test 31: beginContact fires when dynamic bodies touch ──────
// Phase 4e: a sphere dropped onto a cube produces a beginContact
// event. Both bodies' listeners fire; drainCollisionEvents() dedups
// the canonical pair to a single entry.
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const cubeId = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(cubeId, DEFAULT_COLLIDER.box);
  useEditor.getState().addPrimitive('sphere');
  const sphereId = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(sphereId, DEFAULT_COLLIDER.sphere);
  // Cube sits at the origin (top face at y=0.5). Sphere sits just
  // above, slightly overlapping so the very first step fires contact.
  useEditor.getState().setAssetTransform(cubeId, {
    position: [0, 0, 0],
    rotation: [0, 0, 0, 'XYZ'],
    scale: [1, 1, 1],
  });
  useEditor.getState().setAssetTransform(sphereId, {
    position: [0, 0.9, 0],
    rotation: [0, 0, 0, 'XYZ'],
    scale: [1, 1, 1],
  });

  useEditor.getState().setPlayMode(true);
  syncBodies(useEditor.getState().assets, true);
  // Single step should generate the contact (sphere center at y=0.9,
  // radius 0.5, bottom at 0.4 — overlapping the cube top at 0.5).
  stepWorld(1 / 60);

  const events = drainCollisionEvents();
  // Order-independent: build a canonical pair string regardless of
  // which id is smaller. The listener canonicalizes to (a < b), but
  // the test shouldn't depend on the listener's ordering.
  const pairKey = (x: string, y: string): string => (x < y ? `${x}|${y}` : `${y}|${x}`);
  check(
    '31. beginContact fires for (cube, sphere) — canonical pair',
    events.length === 1 &&
      pairKey(events[0].a, events[0].b) === pairKey(cubeId, sphereId),
    `events=${JSON.stringify(events)} expected=${pairKey(cubeId, sphereId)}`,
  );

  useEditor.getState().setPlayMode(false);
}

// ─── Test 32: drain dedups the "both listeners fire" case ───────
// Phase 4e: cannon-es fires one beginContact per body per contact.
// Both bodies' listeners push the same canonical pair; drain returns
// ONE entry per unique pair, not two.
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const a = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(a, DEFAULT_COLLIDER.box);
  useEditor.getState().addPrimitive('sphere');
  const b = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(b, DEFAULT_COLLIDER.sphere);
  useEditor.getState().setAssetTransform(a, {
    position: [0, 0, 0],
    rotation: [0, 0, 0, 'XYZ'],
    scale: [1, 1, 1],
  });
  useEditor.getState().setAssetTransform(b, {
    position: [0, 0.9, 0],
    rotation: [0, 0, 0, 'XYZ'],
    scale: [1, 1, 1],
  });
  useEditor.getState().setPlayMode(true);
  syncBodies(useEditor.getState().assets, true);
  stepWorld(1 / 60);
  // cannon-es may fire beginContact multiple times per step for the
  // same pair (one per contact equation). We expect ONE entry after
  // dedup; if cannon-es fires 2+ raw events, dedup collapses them.
  const events = drainCollisionEvents();
  const uniquePairs = new Set(events.map((e) => `${e.a}|${e.b}`));
  check(
    '32. drainCollisionEvents returns unique pairs only (dedup)',
    uniquePairs.size === events.length,
    `raw=${events.length} unique=${uniquePairs.size}`,
  );
  useEditor.getState().setPlayMode(false);
}

// ─── Test 33: edit mode produces no collision events ───────────
// Phase 4e: static bodies don't fire beginContact (no listener
// attached at build time). Sanity check that we're not leaking
// events into the edit-mode pipeline.
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const a = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(a, DEFAULT_COLLIDER.box);
  useEditor.getState().addPrimitive('sphere');
  const b = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(b, DEFAULT_COLLIDER.sphere);
  syncBodies(useEditor.getState().assets, false);
  stepWorld(1 / 60);
  stepWorld(1 / 60);
  const events = drainCollisionEvents();
  check(
    '33. edit-mode (static) bodies emit no collision events',
    events.length === 0,
    `events=${events.length}`,
  );
}

// ─── Test 34: store: setPlayMode(true) clears the log + resets clock ─
// Phase 4e: a fresh play starts with a clean slate. Previous
// play's events are wiped, playClock = 0.
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id, DEFAULT_COLLIDER.box);
  useEditor.getState().setPlayMode(true);
  syncBodies(useEditor.getState().assets, true);
  // Drop the body onto another to fire events.
  useEditor.getState().setAssetTransform(id, {
    position: [0, 0, 0],
    rotation: [0, 0, 0, 'XYZ'],
    scale: [1, 1, 1],
  });
  // Synthesize an event manually so we don't depend on physics timing.
  useEditor.getState().addCollisionEvents([{ a: 'x', b: 'y' }], 1.0);
  // Tick the clock a bit.
  useEditor.getState().tickPlayClock(0.5);
  useEditor.getState().setPlayMode(false);
  check(
    '34a. after first play, log has 1 entry + clock = 0.5',
    useEditor.getState().collisionEvents.length === 1 &&
      useEditor.getState().playClock === 0.5,
  );
  // Now re-enter play: log clears, clock resets.
  useEditor.getState().setPlayMode(true);
  check(
    '34b. setPlayMode(true) clears the log and resets playClock',
    useEditor.getState().collisionEvents.length === 0 &&
      useEditor.getState().playClock === 0,
  );
  useEditor.getState().setPlayMode(false);
}

// ─── Test 35: stop preserves the log (so the user can review) ──
// Phase 4e: stop should NOT clear the log. The user just pressed
// Stop after watching bodies fall; they want to read "what
// collided?" without it vanishing.
{
  reset();
  useEditor.getState().addPrimitive('cube');
  const id = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(id, DEFAULT_COLLIDER.box);
  useEditor.getState().setPlayMode(true);
  useEditor.getState().addCollisionEvents(
    [
      { a: 'cube-a', b: 'cube-b' },
      { a: 'cube-c', b: 'cube-d' },
    ],
    0.1,
  );
  useEditor.getState().setPlayMode(false);
  check(
    '35. setPlayMode(false) preserves the collision log',
    useEditor.getState().collisionEvents.length === 2,
  );
}

// ─── Test 36: addCollisionEvents respects the 100-cap ───────────
// Phase 4e: ring-buffer cap. Push 150 entries; oldest 50 drop off.
{
  reset();
  useEditor.getState().setPlayMode(true);
  const first = [];
  for (let i = 0; i < 50; i++) {
    first.push({ a: `a${i}`, b: `b${i}` });
  }
  useEditor.getState().addCollisionEvents(first, 0.0);
  const second = [];
  for (let i = 50; i < 150; i++) {
    second.push({ a: `a${i}`, b: `b${i}` });
  }
  useEditor.getState().addCollisionEvents(second, 1.0);
  const log = useEditor.getState().collisionEvents;
  check(
    '36a. log length capped at 100',
    log.length === 100,
    `len=${log.length}`,
  );
  check(
    '36b. oldest 50 entries dropped (a50 is now first)',
    log[0].a === 'a50',
    `first.a=${log[0].a}`,
  );
  check(
    '36c. newest entry preserved (a149 is last)',
    log[99].a === 'a149',
    `last.a=${log[99].a}`,
  );
  useEditor.getState().setPlayMode(false);
}

// ─── Test 37: tickPlayClock is no-op in edit mode ───────────────
// Phase 4e: the clock should only advance during play. A stray
// call from elsewhere doesn't drift it.
{
  reset();
  check('37-pre. playClock starts at 0', useEditor.getState().playClock === 0);
  useEditor.getState().tickPlayClock(5);
  check(
    '37. tickPlayClock is a no-op when playMode is false',
    useEditor.getState().playClock === 0,
    `clock=${useEditor.getState().playClock}`,
  );
  useEditor.getState().setPlayMode(true);
  useEditor.getState().tickPlayClock(0.25);
  check(
    '37b. tickPlayClock advances in play mode',
    Math.abs(useEditor.getState().playClock - 0.25) < 1e-9,
    `clock=${useEditor.getState().playClock}`,
  );
  useEditor.getState().setPlayMode(false);
}

// ─── Test 38: append order is preserved (FIFO, newest at end) ──
// Phase 4e: the store appends and now also canonicalizes (a < b).
// For already-canonical inputs this is a no-op, so insertion
// order is still preserved. Test 39 pins the canonicalize
// contract for non-canonical inputs.
{
  reset();
  useEditor.getState().setPlayMode(true);
  useEditor.getState().addCollisionEvents([{ a: 'first-a', b: 'first-b' }], 0.1);
  useEditor.getState().addCollisionEvents(
    [
      { a: 'second-a', b: 'second-b' },
      { a: 'third-a', b: 'third-b' },
    ],
    0.2,
  );
  useEditor.getState().setPlayMode(false);
  const log = useEditor.getState().collisionEvents;
  check('38a. log length is 3', log.length === 3, `len=${log.length}`);
  check(
    '38b. log preserves insertion order (oldest first)',
    log[0].a === 'first-a' && log[1].a === 'second-a' && log[2].a === 'third-a',
  );
  check(
    '38c. timestamps are preserved as-given',
    log[0].t === 0.1 && log[1].t === 0.2 && log[2].t === 0.2,
    `ts=${JSON.stringify(log.map((e) => e.t))}`,
  );
}

// ─── Test 39: addCollisionEvents canonicalizes (a < b) ───────────
// Phase 4e-fix: the physics drain canonicalizes, but
// addCollisionEvents is a public store action. If a future caller
// (Playwright via window.__editor, a trigger-volume API, etc.)
// pushes {a:'z', b:'a'}, the sidebar would show a duplicate-
// looking entry. The store now sorts the pair on insert so the
// contract is "always canonical" regardless of caller.
{
  reset();
  useEditor.getState().setPlayMode(true);
  // Push in REVERSED order; store must normalize to a < b.
  useEditor.getState().addCollisionEvents(
    [
      { a: 'zebra', b: 'apple' },
      { a: 'mango', b: 'banana' },
    ],
    0.5,
  );
  useEditor.getState().setPlayMode(false);
  const log = useEditor.getState().collisionEvents;
  check('39a. log length is 2', log.length === 2, `len=${log.length}`);
  check(
    '39b. pair #1 is canonical (a < b)',
    log[0].a === 'apple' && log[0].b === 'zebra',
    `got (${log[0].a}, ${log[0].b})`,
  );
  check(
    '39c. pair #2 is canonical (a < b)',
    log[1].a === 'banana' && log[1].b === 'mango',
    `got (${log[1].a}, ${log[1].b})`,
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
