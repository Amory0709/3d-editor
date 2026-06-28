import type { Object3D, Mesh, Material, Texture } from 'three';

/**
 * Recursively dispose GPU resources owned by a Three.js scene graph.
 *
 * Three.js does NOT garbage-collect geometry/material/texture GPU buffers.
 * If you remove an asset without calling this, the buffers leak until
 * the page reloads. Call from a `useEffect` cleanup tied to the
 * scene/asset you want to free.
 *
 * Known limits (acceptable for phase 2):
 * - Does not dispose SkinnedMesh skeletons.
 * - Does not dispose RenderTargets (none in typical GLBs).
 */
export function disposeObject3D(root: Object3D): void {
  root.traverse((obj) => {
    if (!(obj as Mesh).isMesh) return;
    const mesh = obj as Mesh;

    mesh.geometry?.dispose();

    const mats: Material[] = mesh.material
      ? Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material]
      : [];

    for (const mat of mats) {
      for (const key of TEXTURE_SLOTS) {
        const tex = (mat as unknown as Record<string, unknown>)[key] as
          | Texture
          | null
          | undefined;
        if (tex && (tex as { isTexture?: boolean }).isTexture) {
          tex.dispose();
        }
      }
      mat.dispose();
    }
  });
}

/** Material texture slots worth checking for disposal. */
const TEXTURE_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'bumpMap',
  'displacementMap',
  'alphaMap',
  'envMap',
] as const;