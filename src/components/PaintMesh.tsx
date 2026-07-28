import { useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { useLoader } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import type { Object3D, Material } from 'three';
import { Color } from 'three';
import type { AssetRef } from '@/store/editor';
import { useEditor } from '@/store/editor';
import { EditableMesh } from './EditableMesh';

interface Props {
  asset: AssetRef;
  /**
   * Whether this asset is the active one. Gates interactive features
   * (click-to-select-mesh, highlight). Color application ALWAYS runs
   * so paint edits persist across asset switches.
   */
  interactive?: boolean;
}

/**
 * Phase 4f / Paint \u2014 per-mesh color override renderer.
 *
 * Unlike EditableMesh (which collapses a GLB to its FIRST mesh via
 * `firstMeshGeometry()`), PaintMesh walks the entire loaded scene
 * graph and renders every child mesh as a separate <primitive>, so
 * the user can click any part of a multi-mesh asset and recolor only
 * that part.
 *
 * Color override strategy:
 *   - For each mesh with an override, clone the source material so
 *     siblings that share the GLB's shared material don't bleed.
 *   - Apply the override AFTER cloning so the source GLB material
 *     stays untouched (in case the user wants to undo back to it).
 *   - Missing key in `meshColors` \u2192 keep the source material.
 *
 * Click handling:
 *   - Stops propagation so a click on a small part doesn't bubble
 *     up to the asset wrapper (which would change activeAssetId).
 *   - Sets `paintSelectedMesh` to mesh.name.
 *
 * Why a separate component instead of nesting inside EditableMesh:
 *   EditableMesh assumes ONE BufferGeometry per asset (vertex
 *   handles, wireframe, all derived from that single geometry).
 *   Paint mode doesn't need any of that \u2014 just walk the scene and
 *   color. Separate component = independent code path, no risk of
 *   regressing edit / mesh / collision modes.
 *
 * Primitives: fall through to EditableMesh (single mesh, no
 * per-part selection; the color picker in the sidebar applies to
 * the whole primitive instead).
 */
export function PaintMesh({ asset, interactive = true }: Props) {
  if (asset.source === 'primitive') {
    // Primitives are single-mesh. Render via EditableMesh without
    // the interactive layer (no vertex handles in paint mode); the
    // sidebar's color picker applies to the whole primitive by
    // writing into a sentinel key ('__primitive__').
    return <EditableMesh asset={asset} interactive={false} />;
  }
  if (asset.format === 'glb' || asset.format === 'gltf') {
    if (!asset.url) return null;
    return <LoadedPaint asset={asset} url={url_glb(asset.url)} interactive={interactive} />;
  }
  if (asset.format === 'obj') {
    if (!asset.url) return null;
    return <OBJPaint asset={asset} url={asset.url} interactive={interactive} />;
  }
  return null;
}

function url_glb(url: string) { return url; }

function LoadedPaint({ asset, url, interactive }: { asset: AssetRef; url: string; interactive: boolean }) {
  const gltf = useGLTF(url);
  return <PaintBody root={gltf?.scene} asset={asset} interactive={interactive} />;
}

function OBJPaint({ asset, url, interactive }: { asset: AssetRef; url: string; interactive: boolean }) {
  const obj = useLoader(OBJLoader, url);
  return <PaintBody root={obj} asset={asset} interactive={interactive} />;
}

function PaintBody({
  root,
  asset,
  interactive,
}: {
  root: Object3D | null | undefined;
  asset: AssetRef;
  interactive: boolean;
}) {
  const setPaintSelectedMesh = useEditor((s) => s.setPaintSelectedMesh);
  const paintSelected = useEditor((s) => s.paintSelectedMesh);
  const setLoading = useEditor((s) => s.setLoading);

  // Match EditableMesh's loader-resolved UX: clear the global
  // 'Loading\u2026' flag once the GLB / OBJ loader has mounted.
  useEffect(() => {
    setLoading(false);
  }, [asset.id, setLoading]);

  const meshes = useMemo(() => collectMeshes(root), [root]);
  const colors = asset.meshColors ?? {};

  return (
    <group>
      {meshes.map(({ name, ref }) => {
        const override = colors[name];
        const isSelected = paintSelected === name && interactive;
        return (
          <PaintPart
            key={(ref as unknown as { uuid: string }).uuid}
            source={ref}
            name={name}
            overrideColor={override}
            isSelected={isSelected}
            interactive={interactive}
            onPick={() => interactive && setPaintSelectedMesh(name)}
          />
        );
      })}
    </group>
  );
}

function PaintPart({
  source,
  name,
  overrideColor,
  isSelected,
  interactive: _interactive,
  onPick,
}: {
  source: Object3D;
  name: string;
  overrideColor: string | undefined;
  isSelected: boolean;
  interactive: boolean;
  onPick: () => void;
}) {
  // `name` is reserved for future per-part tagging (sidebar already
  // shows it via the store). Keeping it on the prop signature so
  // PaintBody's call site reads naturally.
  void name;
  // Lazy-clone the material only when an override exists. The clone
  // is keyed on (overrideColor, source) \u2014 changing the color
  // rebuilds the clone. The source's own material stays untouched
  // so resetting all colors returns to the imported look exactly.
  const material = useMemo(() => {
    const src = source as unknown as { material: Material };
    if (!overrideColor) return src.material;
    const cloned = src.material.clone();
    if ('color' in cloned && cloned.color) {
      cloned.color = new Color(overrideColor);
    }
    return cloned;
  }, [overrideColor, source]);

  return (
    <primitive
      object={source}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        // Don't bubble \u2014 the wrapper's setActiveAsset would also fire.
        e.stopPropagation();
        onPick();
      }}
    >
      <primitive object={material} attach="material" />
      {isSelected && <SelectedRing source={source} />}
      {/*
        Selected-mesh name is shown in the sidebar Paint panel (see
        Sidebar.tsx PaintPanel), not as an in-scene overlay, so the
        viewport stays clean. The wireframe SelectedRing below is
        the in-viewport affordance for "which part did I just pick".
      */}
    </primitive>
  );
}

/** A subtle wireframe highlight on the selected mesh. Sibling of
 *  the source primitive so it has its own material pipeline. */
function SelectedRing({ source }: { source: Object3D }) {
  const geom = (source as unknown as { geometry: unknown }).geometry;
  if (!geom) return null;
  return (
    <lineSegments>
      <edgesGeometry args={[geom as never]} />
      <lineBasicMaterial color="#5ac8fa" />
    </lineSegments>
  );
}

function collectMeshes(root: Object3D | null | undefined) {
  const out: { name: string; ref: Object3D }[] = [];
  if (!root) return out;
  root.traverse((child) => {
    const m = child as unknown as { isMesh?: boolean };
    if (m.isMesh) {
      out.push({ name: child.name || '(unnamed)', ref: child });
    }
  });
  return out;
}