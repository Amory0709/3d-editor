/**
 * Single source of truth for supported file formats and primitive / collider
 * vocabulary. Toolbar's <input accept> attribute, upload validation, renderer
 * dispatch, primitive buttons, and collider buttons all read from here —
 * never hardcode the list elsewhere.
 */

export type AssetFormat =
  | 'glb'
  | 'gltf'
  | 'obj'
  | 'splat'
  | 'ply'
  | 'spz'
  | 'unknown';

export type AssetKind = 'mesh' | 'gaussian';

export type PrimitiveType = 'cube' | 'sphere' | 'cylinder';

export const PRIMITIVE_TYPES: readonly PrimitiveType[] = [
  'cube',
  'sphere',
  'cylinder',
] as const;

export function primitiveLabel(t: PrimitiveType): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Formats the mesh renderer (phase 2) can show today. */
export const MESH_FORMATS: ReadonlySet<AssetFormat> = new Set<AssetFormat>([
  'glb',
  'gltf',
  'obj',
]);

/** Formats deferred to phase 5 (gaussian editor). */
export const GAUSSIAN_FORMATS: ReadonlySet<AssetFormat> = new Set<AssetFormat>([
  'splat',
  'ply',
  'spz',
]);

/**
 * HTML accept attribute for the file input.
 * Keep narrow: only formats we actually render right now.
 * Expand when phase 5 ships.
 */
export const ACCEPT_ATTR = '.glb,.gltf,.obj';

/** Detect format from file name; falls back to 'unknown'. */
export function detectFormat(name: string): AssetFormat {
  const lower = name.toLowerCase();
  if (lower.endsWith('.glb')) return 'glb';
  if (lower.endsWith('.gltf')) return 'gltf';
  if (lower.endsWith('.obj')) return 'obj';
  if (lower.endsWith('.splat')) return 'splat';
  if (lower.endsWith('.ply')) return 'ply';
  if (lower.endsWith('.spz')) return 'spz';
  return 'unknown';
}

/** Map a format to its renderer bucket. */
export function classifyKind(format: AssetFormat): AssetKind {
  return GAUSSIAN_FORMATS.has(format) ? 'gaussian' : 'mesh';
}

/* ───────────────────────── colliders (phase 4a / 4b) ───────────────────────── */

export type ColliderType = 'box' | 'sphere' | 'capsule' | 'cylinder';

export const COLLIDER_TYPES: readonly ColliderType[] = [
  'box',
  'sphere',
  'capsule',
  'cylinder',
] as const;

export function colliderLabel(t: ColliderType): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Phase 4b: each collider spec carries the size parameters it needs.
 * Discriminated union — TypeScript narrows on `type` so the right
 * fields are required for the right shape. No more empty `{ type }`.
 *
 * Sizing convention (units = scene units, ~meters):
 *   - box:      halfExtents in local space (full size = 2 × halfExtents)
 *   - sphere:   radius
 *   - capsule:  radius + height of the cylinder portion (hemispheres
 *               add `radius` on each end → total length = height + 2r)
 *   - cylinder: radius + height along Y
 */
export type ColliderSpec =
  | { type: 'box'; halfExtents: [number, number, number] }
  | { type: 'sphere'; radius: number }
  | { type: 'capsule'; radius: number; height: number }
  | { type: 'cylinder'; radius: number; height: number };

/** Default sizes per type — chosen to match the visible primitive
 *  defaults so a freshly-assigned collider hugs the mesh. */
export const DEFAULT_COLLIDER: Record<ColliderType, ColliderSpec> = {
  box:      { type: 'box',      halfExtents: [0.5, 0.5, 0.5] },
  sphere:   { type: 'sphere',   radius: 0.6 },
  capsule:  { type: 'capsule',  radius: 0.4, height: 1.2 },
  cylinder: { type: 'cylinder', radius: 0.5, height: 1.2 },
};