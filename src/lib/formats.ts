/**
 * Single source of truth for supported file formats.
 * Toolbar's <input accept> attribute, upload validation, and renderer dispatch
 * all read from here — never hardcode the list elsewhere.
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

/** Procedural geometry types (phase 3). */
export type PrimitiveType = 'cube' | 'sphere' | 'cylinder';

export const PRIMITIVE_TYPES: readonly PrimitiveType[] = [
  'cube',
  'sphere',
  'cylinder',
] as const;

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

/** Display label for a primitive type. */
export function primitiveLabel(p: PrimitiveType): string {
  return p.charAt(0).toUpperCase() + p.slice(1);
}