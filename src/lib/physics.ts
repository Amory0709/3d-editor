/**
 * Physics world (phase 4b / 4d / 4e).
 *
 * Owns a single cannon-es World that mirrors the editor's asset graph:
 *   • every asset with a `collider` gets a body in the world
 *   • body position / rotation track the asset's transform each frame
 *     (edit mode only; in play mode the body is the source of truth)
 *   • body shape (radius / halfExtents / height) tracks the collider
 *     spec × asset scale
 *   • when an asset is removed or its collider cleared, the body is
 *     removed too
 *
 * Sync is one-way: editor → physics in edit mode; in play mode
 * (phase 4d) bodies become dynamic and the world.step() drives them,
 * with the body's transform flowing back into the asset each frame.
 *
 * Phase 4e: dynamic bodies emit `beginContact` events via a listener
 * attached at build time. The listener pushes to a module-level buffer
 * keyed by canonical (a, b) asset-id pair (a < b by string compare).
 * Callers drain the buffer after each stepWorld via
 * `drainCollisionEvents()`. Drain-time dedup handles cannon-es's
 * "one event per body per contact" — two listeners (one per body)
 * produce the same canonical pair, so we collapse to one entry.
 *
 * The world is a module-level singleton. There is one editor, so one
 * world is correct. `resetPhysicsWorld()` is exposed for test isolation.
 */
import * as CANNON from 'cannon-es';
import { Euler, Quaternion, type EulerOrder } from 'three';
import type { AssetRef, ObjectTransform } from '@/store/editor';
import type { ColliderSpec } from '@/lib/formats';

const FIXED_STEP = 1 / 60;
const MAX_SUB_STEPS = 3;

let world: CANNON.World | null = null;
/** assetId → body. We keep the lookup table outside the world so it
 *  survives world rebuilds and so callers can introspect bodies
 *  without scanning world.bodies every frame. */
const bodyByAssetId = new Map<string, CANNON.Body>();
/** body → assetId (phase 4e). Reverse of bodyByAssetId, used by the
 *  beginContact listener to translate cannon-es body refs into the
 *  asset ids the store cares about. Maintained in lock-step with
 *  bodyByAssetId. */
const assetIdByBody = new Map<CANNON.Body, string>();
/** assetId → last shape spec key. Used to avoid rebuilding a body
 *  when only its position/rotation changed (the common case). */
const lastShapeKey = new Map<string, string>();
/** Phase 4e: collision events captured from beginContact listeners
 *  during stepWorld. Drained by `drainCollisionEvents()` after each
 *  frame; entries are pushed (not spliced) so the order is the order
 *  cannon-es fired them in. Dedup happens at drain time on the
 *  canonical (a, b) pair. */
const pendingCollisionEvents: Array<{ a: string; b: string }> = [];

/** Lazily create the world. Gravity = -9.81 on Y, real-world-ish. */
export function getPhysicsWorld(): CANNON.World {
  if (!world) {
    world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
    // Phase 4e: ONE world-level 'beginContact' listener. cannon-es
    // fires this event on the WORLD (not on the bodies) — see its
    // emitContactEvents(). Each event has bodyA and bodyB; we look
    // both up in assetIdByBody to translate to our asset ids.
    //
    // Attaching once on the world is cleaner than per-body listeners:
    // the listener doesn't move with bodies (bodies get rebuilt on
    // shape/dynamic changes), and we don't have to track listener
    // lifecycle as bodies come and go.
    world.addEventListener('beginContact', onBeginContact);
  }
  return world;
}

/** Tear down the world and all bodies. Test-only escape hatch. */
export function resetPhysicsWorld(): void {
  if (world) {
    while (world.bodies.length > 0) {
      world.removeBody(world.bodies[0]);
    }
  }
  bodyByAssetId.clear();
  assetIdByBody.clear();
  lastShapeKey.clear();
  pendingCollisionEvents.length = 0;
  world = null;
}

/** For tests / debugging: get the body attached to an asset, if any. */
export function getBodyForAsset(assetId: string): CANNON.Body | null {
  return bodyByAssetId.get(assetId) ?? null;
}

/** Number of assets that currently have a body in the world. */
export function getBodyCount(): number {
  return bodyByAssetId.size;
}

/**
 * Reconcile the physics world against the current asset list.
 *
 * For each asset with a collider:
 *   • no body OR shape / dynamicity changed since last sync → build
 *     a new body (cheap for our handful of bodies; avoids fiddly
 *     per-shape in-place mutation across the four shape types)
 *   • body exists with same shape and dynamicity →
 *     - in edit mode: update the body's transform to follow the
 *       asset (one-way: editor → physics)
 *     - in play mode: leave the body alone (it's the source of
 *       truth; the asset reads from it after each step)
 *
 * For each body whose asset no longer exists or no longer has a
 * collider → remove it.
 */
export function syncBodies(assets: readonly AssetRef[], dynamic: boolean): void {
  const w = getPhysicsWorld();
  // Track asset IDs that should have a body (i.e. have a non-null
  // collider). After the pass, any body whose asset isn't in this set
  // is removed — covers both "asset deleted" and "collider cleared".
  const shouldHaveBody = new Set<string>();

  for (const asset of assets) {
    if (!asset.collider) continue;
    shouldHaveBody.add(asset.id);

    const key = shapeKey(asset.collider, asset.transform.scale, dynamic);
    let body = bodyByAssetId.get(asset.id);
    const prevKey = lastShapeKey.get(asset.id);

    if (!body || prevKey !== key) {
      // Shape / dynamicity changed (or first time) → rebuild
      if (body) {
        w.removeBody(body);
        // Phase 4e: drop the reverse-map entry for the old body.
        // The body is unreachable after this; its 'beginContact'
        // listener will GC with it.
        assetIdByBody.delete(body);
      }
      body = buildBody(asset.collider, asset.transform, dynamic);
      w.addBody(body);
      bodyByAssetId.set(asset.id, body);
      assetIdByBody.set(body, asset.id);
      lastShapeKey.set(asset.id, key);
    } else if (!dynamic) {
      // Edit mode: same shape, just update transform to track the asset.
      updateBodyTransform(body, asset.transform);
    }
    // Play mode: same shape, dynamic body — leave the body's own
    // transform alone; syncBodiesFromWorld() will read it back.
  }

  // Remove bodies for assets that disappeared, OR for assets still
  // in the list but with no collider (cleared via the sidebar).
  for (const [id, body] of bodyByAssetId) {
    if (!shouldHaveBody.has(id)) {
      w.removeBody(body);
      bodyByAssetId.delete(id);
      assetIdByBody.delete(body);
      lastShapeKey.delete(id);
    }
  }
}

/**
 * For play mode: read each body's position and rotation out of the
 * world and return them keyed by asset id. Caller is responsible for
 * writing the returned values into the store (via
 * setAssetTransformFromPlay). Scale is intentionally omitted — the
 * body never owns scale, and the store keeps the existing scale
 * intact when position/rotation are written.
 *
 * Returns an empty array when there are no bodies, so callers can
 * unconditionally iterate.
 *
 * The rotation is extracted from the body's quaternion via three's
 * Euler with the XYZ order. This is lossy when the body's quaternion
 * didn't come from an XYZ decomposition in the first place, but
 * the play-mode body always starts from a known XYZ Euler (the
 * asset's pre-play rotation), and dynamic motion under gravity
 * doesn't accumulate order errors in a way that matters for the
 * user. If we ever need to preserve the original order, we'd need
 * to store the body→asset relationship as a quaternion and convert
 * back at use sites — but that's out of scope for phase 4d.
 */
export function readBodiesToAssets(): ReadonlyArray<{
  assetId: string;
  position: [number, number, number];
  rotation: [number, number, number, EulerOrder];
}> {
  const out: Array<{
    assetId: string;
    position: [number, number, number];
    rotation: [number, number, number, EulerOrder];
  }> = [];
  for (const [assetId, body] of bodyByAssetId) {
    const q = new Quaternion(
      body.quaternion.x,
      body.quaternion.y,
      body.quaternion.z,
      body.quaternion.w,
    );
    const e = new Euler().setFromQuaternion(q, 'XYZ');
    out.push({
      assetId,
      position: [body.position.x, body.position.y, body.position.z],
      rotation: [e.x, e.y, e.z, 'XYZ'],
    });
  }
  return out;
}

/** Step the world forward by `dt` seconds. Fixed-timestep with internal
 *  substepping keeps the simulation stable under variable frame rates. */
export function stepWorld(dt: number): void {
  if (!world) return;
  // Clamp dt to avoid spiral-of-death after a tab regains focus.
  const clampedDt = Math.min(dt, 0.1);
  world.step(FIXED_STEP, clampedDt, MAX_SUB_STEPS);
}

/**
 * Phase 4e: drain the beginContact buffer accumulated during the
 * most recent stepWorld(s). Returns the dedup'd list of pairs in
 * the order cannon-es fired them (with duplicates collapsed to the
 * first occurrence). Clears the buffer so the next call returns
 * only events fired AFTER this drain.
 *
 * Dedup is on the canonical pair (a < b by string compare). cannon-es
 * fires one beginContact per body per contact, so a single "A touched
 * B" produces two events; we collapse to one entry.
 *
 * The buffer is intentionally not drained inside stepWorld — we want
 * the caller (PhysicsTicker) to push the events into the store ONCE
 * per frame, not once per body. Per-frame batching keeps React
 * re-render storms at bay even when many bodies collide at once.
 */
export function drainCollisionEvents(): ReadonlyArray<{ a: string; b: string }> {
  const seen = new Set<string>();
  const out: Array<{ a: string; b: string }> = [];
  for (const e of pendingCollisionEvents) {
    const key = `${e.a}|${e.b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  pendingCollisionEvents.length = 0;
  return out;
}

/* ─── internals ───────────────────────────────────────────────────── */

/**
 * Phase 4e: cannon-es world-level beginContact handler. cannon-es
 * dispatches beginContact ON THE WORLD (not on the bodies); the
 * event has `bodyA` and `bodyB`. We look both up in assetIdByBody
 * to translate to our asset ids and push a canonical (a < b) pair.
 *
 * Attached once in getPhysicsWorld() so it survives body rebuilds.
 * If either body is missing from the map (the world has a body that
 * we don't know about — shouldn't happen in normal use), we skip the
 * event rather than emit a partial entry.
 */
function onBeginContact(event: {
  bodyA: CANNON.Body;
  bodyB: CANNON.Body;
}): void {
  const aId = assetIdByBody.get(event.bodyA);
  const bId = assetIdByBody.get(event.bodyB);
  if (!aId || !bId) return;
  const [a, b] = aId < bId ? [aId, bId] : [bId, aId];
  pendingCollisionEvents.push({ a, b });
}

function shapeKey(
  spec: ColliderSpec,
  scale: readonly [number, number, number],
  dynamic: boolean,
): string {
  // JSON.stringify gives a stable, allocation-free-ish key for our
  // small value objects. (Two calls per asset per frame at worst.)
  // `dynamic` is part of the key so flipping play mode rebuilds all
  // bodies with the right mass / type.
  return JSON.stringify([spec, scale, dynamic]);
}

function updateBodyTransform(
  body: CANNON.Body,
  transform: ObjectTransform,
): void {
  body.position.set(
    transform.position[0],
    transform.position[1],
    transform.position[2],
  );
  // The store's rotation tuple carries the Euler order so we don't
  // have to assume 'XYZ' here. cannon-es setFromEuler takes the same
  // order strings three does ('XYZ' | 'YZX' | 'ZXY' | 'XZY' | 'YXZ'
  // | 'ZYX'), so the value round-trips exactly.
  body.quaternion.setFromEuler(
    transform.rotation[0],
    transform.rotation[1],
    transform.rotation[2],
    transform.rotation[3],
  );
}

function buildBody(
  spec: ColliderSpec,
  transform: ObjectTransform,
  dynamic: boolean,
): CANNON.Body {
  // Phase 4d: play mode makes the body dynamic (mass > 0) so
  // world.step() actually moves it. Edit mode keeps the
  // phase-4b contract (mass = 0, STATIC) — the body mirrors
  // the asset but never moves on its own.
  //
  // Phase 4e note: we do NOT attach a beginContact listener per
  // body. cannon-es dispatches that event on the WORLD, not on
  // bodies — see getPhysicsWorld() for the single world-level
  // listener. Attaching to bodies is a no-op for beginContact
  // (would work for the per-body 'collide' event, but that's a
  // different event with different semantics).
  const body = new CANNON.Body({
    mass: dynamic ? 1 : 0,
    type: dynamic ? CANNON.Body.DYNAMIC : CANNON.Body.STATIC,
  });
  updateBodyTransform(body, transform);

  const [sx, sy, sz] = transform.scale;

  switch (spec.type) {
    case 'box': {
      const shape = new CANNON.Box(
        new CANNON.Vec3(
          spec.halfExtents[0] * sx,
          spec.halfExtents[1] * sy,
          spec.halfExtents[2] * sz,
        ),
      );
      body.addShape(shape);
      break;
    }
    case 'sphere': {
      // Use the max axis scale so the sphere fully encloses a stretched
      // mesh — a uniform-scale sphere approximation is the standard
      // choice when the visual is non-uniform.
      const shape = new CANNON.Sphere(spec.radius * Math.max(sx, sy, sz));
      body.addShape(shape);
      break;
    }
    case 'cylinder': {
      // Cylinder is along its local Y. The visual CylinderGeometry
      // under non-uniform X/Z scale becomes an elliptical cross-section
      // (X = r*sx, Z = r*sz), NOT a truncated cone. cannon-es Cylinder
      // is circular, so we use max(sx, sz) for both top and bottom —
      // the body becomes a uniform Y-cylinder that contains the
      // visual's elliptical cross-section in both X and Z. See
      // verify-physics.mts "non-uniform scale" cases.
      const r = spec.radius * Math.max(sx, sz);
      const shape = new CANNON.Cylinder(r, r, spec.height * sy, 16);
      body.addShape(shape);
      break;
    }
    case 'capsule': {
      // Compound: cylinder (middle) + 2 spheres (ends), aligned along Y.
      // Not a primitive in cannon-es; this is the textbook construction.
      // The radius uses max(sx, sz) so the body's circular cross-section
      // contains the visual's elliptical cross-section in X and Z. The
      // end-sphere radius inherits the same value, so the body's Y extent
      // (sphere radius extends in Y too) is an envelope — it can stick
      // out past the visual's Y extent when sy < max(sx, sz). That's
      // acceptable for phase 4b (capsule as envelope); a future phase
      // could swap spheres for ellipsoids if exactness matters.
      const r = spec.radius * Math.max(sx, sz);
      const h = spec.height * sy;
      body.addShape(new CANNON.Cylinder(r, r, h, 16));
      body.addShape(new CANNON.Sphere(r), new CANNON.Vec3(0, h / 2, 0));
      body.addShape(new CANNON.Sphere(r), new CANNON.Vec3(0, -h / 2, 0));
      break;
    }
  }

  return body;
}
