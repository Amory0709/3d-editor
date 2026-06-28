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

/* ───────────────────────── colliders (phase 4a) ───────────────────────── */

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
 * Phase 4a: colliders are visual-only markers. They have a fixed default
 * size per type. Custom halfExtents / radius / height will be added in
 * phase 4b when physics integration ships.
 */
export interface ColliderSpec {
  type: ColliderType;
}