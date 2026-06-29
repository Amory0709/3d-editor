/**
 * Physics world (phase 4b).
 *
 * Owns a single cannon-es World that mirrors the editor's asset graph:
 *   • every asset with a `collider` gets a static body in the world
 *   • body position / rotation track the asset's transform each frame
 *   • body shape (radius / halfExtents / height) tracks the collider
 *     spec × asset scale
 *   • when an asset is removed or its collider cleared, the body is
 *     removed too
 *
 * Sync is one-way: editor → physics. Bodies are static (mass=0) so the
 * world's step() does not mutate them. Phase 4d (play mode) will flip
 * them dynamic; phase 4e (collision events) will surface beginContact.
 * For now the world is just a live in-memory representation that those
 * future features can hook into without restructuring the loop.
 *
 * The world is a module-level singleton. There is one editor, so one
 * world is correct. `resetPhysicsWorld()` is exposed for test isolation
 * (and for a future "Clear physics" debug action).
 */
import * as CANNON from 'cannon-es';
import type { AssetRef, ObjectTransform } from '@/store/editor';
import type { ColliderSpec } from '@/lib/formats';

const FIXED_STEP = 1 / 60;
const MAX_SUB_STEPS = 3;

let world: CANNON.World | null = null;
/** assetId → body. We keep the lookup table outside the world so it
 *  survives world rebuilds and so callers can introspect bodies
 *  without scanning world.bodies every frame. */
const bodyByAssetId = new Map<string, CANNON.Body>();
/** assetId → last shape spec key. Used to avoid rebuilding a body
 *  when only its position/rotation changed (the common case). */
const lastShapeKey = new Map<string, string>();

/** Lazily create the world. Gravity = -9.81 on Y, real-world-ish. */
export function getPhysicsWorld(): CANNON.World {
  if (!world) {
    world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
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
  lastShapeKey.clear();
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
 *   • no body OR shape changed since last sync → build a new body
 *     (cheap for our handful of bodies; avoids fiddly per-shape
 *     in-place mutation across the four shape types)
 *   • body exists with same shape → just update position / quaternion
 *
 * For each body whose asset no longer exists or no longer has a
 * collider → remove it.
 */
export function syncBodies(assets: readonly AssetRef[]): void {
  const w = getPhysicsWorld();
  // Track asset IDs that should have a body (i.e. have a non-null
  // collider). After the pass, any body whose asset isn't in this set
  // is removed — covers both "asset deleted" and "collider cleared".
  const shouldHaveBody = new Set<string>();

  for (const asset of assets) {
    if (!asset.collider) continue;
    shouldHaveBody.add(asset.id);

    const key = shapeKey(asset.collider, asset.transform.scale);
    let body = bodyByAssetId.get(asset.id);
    const prevKey = lastShapeKey.get(asset.id);

    if (!body || prevKey !== key) {
      // Shape changed (or first time) → rebuild
      if (body) {
        w.removeBody(body);
      }
      body = buildBody(asset.collider, asset.transform);
      w.addBody(body);
      bodyByAssetId.set(asset.id, body);
      lastShapeKey.set(asset.id, key);
    } else {
      // Same shape, just update transform
      updateBodyTransform(body, asset.transform);
    }
  }

  // Remove bodies for assets that disappeared, OR for assets still
  // in the list but with no collider (cleared via the sidebar).
  for (const [id, body] of bodyByAssetId) {
    if (!shouldHaveBody.has(id)) {
      w.removeBody(body);
      bodyByAssetId.delete(id);
      lastShapeKey.delete(id);
    }
  }
}

/** Step the world forward by `dt` seconds. Fixed-timestep with internal
 *  substepping keeps the simulation stable under variable frame rates. */
export function stepWorld(dt: number): void {
  if (!world) return;
  // Clamp dt to avoid spiral-of-death after a tab regains focus.
  const clampedDt = Math.min(dt, 0.1);
  world.step(FIXED_STEP, clampedDt, MAX_SUB_STEPS);
}

/* ─── internals ───────────────────────────────────────────────────── */

function shapeKey(
  spec: ColliderSpec,
  scale: readonly [number, number, number],
): string {
  // JSON.stringify gives a stable, allocation-free-ish key for our
  // small value objects. (Two calls per asset per frame at worst.)
  return JSON.stringify([spec, scale]);
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
): CANNON.Body {
  const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC });
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
