import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { BufferGeometry, Object3D } from 'three';
import type { AssetRef } from '@/store/editor';
import type { PrimitiveType } from '@/lib/formats';
import { useEditor } from '@/store/editor';
import { applyOffsets, readPositions } from '@/lib/meshEdit';
import { makeFaceOnAsset } from '@/lib/meshOps';
import { GeometryRegistrar } from './MeshGeometryBridge';
import { makeGeometry } from './PrimitiveRenderer';

interface Props {
  asset: AssetRef;
  onSelect?: () => void;
}

/**
 * Phase 3.2a — vertex-level mesh editing.
 *
 * Renders an asset's geometry with `vertexOffsets` applied on top of the
 * base positions, shows every vertex as a yellow point in the viewport
 * for picking, and exposes a "selected vertex" handle the user can drag
 * via the keyboard arrow keys or by clicking-and-dragging the handle.
 *
 * Used as a drop-in replacement for the inner mesh of `<MeshRenderer>`
 * when in Edit mode. Does NOT handle the transform wrapper or the
 * collider marker -- those live in TransformableAsset.
 *
 * Dispatch design (rules-of-hooks fix):
 *   `useAssetGeometry` previously called different numbers of hooks
 *   depending on asset.source — 1 (useMemo) for primitives, 2
 *   (useGLTF + useMemo) for glb/gltf, 2 (useLoader + useMemo) for
 *   obj. React requires the same hook count per render, and even
 *   though asset.type is stable for a given EditableMesh instance,
 *   the useFrame hook interleaving + React Strict Mode + Suspense
 *   boundaries made this throw #310 in production.
 *
 *   The fix is to keep `EditableMesh` itself hook-free and dispatch
 *   to one of three per-type child components (`PrimitiveEditable`,
 *   `GLBEditable`, `OBJEditable`), each with its own stable hook
 *   count. Each child then renders the shared `EditableMeshBody`,
 *   which holds the rest of the logic and gets `geometry` as a prop.
 */
export function EditableMesh({ asset, onSelect }: Props) {
  if (asset.source === 'primitive' && asset.primitiveType) {
    return (
      <PrimitiveEditable
        asset={asset}
        onSelect={onSelect}
        primitiveType={asset.primitiveType}
      />
    );
  }
  if (asset.format === 'glb' || asset.format === 'gltf') {
    if (!asset.url) return null;
    return (
      <GLBEditable asset={asset} onSelect={onSelect} url={asset.url} />
    );
  }
  if (asset.format === 'obj') {
    if (!asset.url) return null;
    return (
      <OBJEditable asset={asset} onSelect={onSelect} url={asset.url} />
    );
  }
  return null;
}

/** Per-type dispatch target for primitive assets. */
function PrimitiveEditable({
  asset,
  onSelect,
  primitiveType,
}: {
  asset: AssetRef;
  onSelect: Props['onSelect'];
  primitiveType: PrimitiveType;
}) {
  const geometry = useMemo(
    () => makeGeometry(primitiveType),
    [primitiveType],
  );
  return <EditableMeshBody asset={asset} onSelect={onSelect} geometry={geometry} />;
}

/** Per-type dispatch target for glTF / GLB assets. */
function GLBEditable({
  asset,
  onSelect,
  url,
}: {
  asset: AssetRef;
  onSelect: Props['onSelect'];
  url: string;
}) {
  const gltf = useGLTF(url);
  const geometry = useMemo(() => firstMeshGeometry(gltf?.scene), [gltf]);
  return <EditableMeshBody asset={asset} onSelect={onSelect} geometry={geometry} />;
}

/** Per-type dispatch target for OBJ assets. */
function OBJEditable({
  asset,
  onSelect,
  url,
}: {
  asset: AssetRef;
  onSelect: Props['onSelect'];
  url: string;
}) {
  const obj = useLoader(OBJLoader, url);
  const geometry = useMemo(() => firstMeshGeometry(obj), [obj]);
  return <EditableMeshBody asset={asset} onSelect={onSelect} geometry={geometry} />;
}

/** Walk a loaded root and return the first mesh's geometry (or null). */
function firstMeshGeometry(root: Object3D | null | undefined): BufferGeometry | null {
  if (!root) return null;
  let result: BufferGeometry | null = null;
  root.traverse((child) => {
    if (result) return;
    const m = child as unknown as { isMesh?: boolean; geometry?: BufferGeometry };
    if (m.isMesh && m.geometry) {
      result = m.geometry;
    }
  });
  return result;
}

/**
 * Shared body — runs the actual edit-mode UI (vertex overlay, F-hotkey,
 * per-frame offset application). Receives `geometry` from one of the
 * per-type dispatch components above so its own hook count is stable
 * regardless of asset type.
 */
function EditableMeshBody({
  asset,
  onSelect,
  geometry,
}: {
  asset: AssetRef;
  onSelect: Props['onSelect'];
  geometry: BufferGeometry | null;
}) {
  const vertexOffsets = asset.vertexOffsets;
  const commitMakeFace = useEditor((s) => s.commitMakeFace);
  const axisLock = useEditor((s) => s.axisLock);
  const mode = useEditor((s) => s.mode);
  const selectedVertices = useEditor((s) => s.selectedVertices);
  const toggleSelectedVertex = useEditor((s) => s.toggleSelectedVertex);
  const isEditMode = mode === 'edit';

  // Apply offsets to the geometry every frame.
  useFrame(() => {
    if (!geometry) return;
    const positions = readPositions(geometry);
    if (!positions) return;
    const next = applyOffsets(positions, vertexOffsets);
    const attr = geometry.getAttribute('position');
    if (!attr) return;
    attr.array.set(next);
    attr.needsUpdate = true;
    geometry.computeBoundingSphere();
  });

  const vertexCount = useMemo(() => {
    if (!geometry) return 0;
    const p = readPositions(geometry);
    return p ? p.length / 3 : 0;
  }, [geometry]);

  // Phase 3.2c — F hotkey to make face from selectedVertices.
  useEffect(() => {
    if (!isEditMode) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'f' && e.key !== 'F') return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      const sel = useEditor.getState().selectedVertices;
      if (sel.length < 3) return;
      e.preventDefault();
      const preAssets = useEditor.getState().assets;
      const newTris = makeFaceOnAsset(asset.id, sel);
      commitMakeFace(asset.id, preAssets, newTris);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isEditMode, asset.id, commitMakeFace]);

  if (!geometry) {
    return null;
  }

  return (
    <group>
      <GeometryRegistrar assetId={asset.id} geometry={geometry} />
      <mesh onClick={onSelect}>
        <primitive object={geometry} attach="geometry" />
        <meshStandardMaterial color="#6da7ff" metalness={0.15} roughness={0.4} />
      </mesh>
      {isEditMode && vertexCount > 0 && (
        <VertexOverlay
          geometry={geometry}
          assetId={asset.id}
          selectedVertices={selectedVertices}
          onToggle={toggleSelectedVertex}
          vertexOffsets={vertexOffsets}
          axisLock={axisLock}
        />
      )}
    </group>
  );
}

/**
 * Phase 3.2a/c — yellow dots overlaid on every vertex of the geometry.
 *
 * - Click a dot: toggles it in the global `selectedVertices` list.
 * - Drag a selected dot: free-move (axis-lock honored). The drag
 *   supports moving all selected vertices together (Ctrl/Cmd-drag
 *   would be the explicit way, but for MVP just moving whichever dot
 *   was clicked is simpler — users can re-select if they want group
 *   movement). To avoid that footgun, we restrict drag to the clicked
 *   vertex only; selected-but-not-dragged dots stay put.
 * - Arrow keys nudge all currently-selected vertices by the same delta.
 *
 * `selectedVertices` is an array (not Set) so the order is stable
 * across re-renders — important for the F-face fan triangulation,
 * which fans from vertex 0.
 *
 * Hooks-order fix: previous version had `if (!positions) return null`
 * BEFORE the useRef / useEditor / useEffect calls. If `positions`
 * became null between renders (e.g. during a fillHoles / makeFace
 * snapshot dance that briefly removes the position attribute), the
 * hook count would change and React would throw #310. The early
 * return now lives after the hooks.
 */
function VertexOverlay({
  geometry,
  assetId,
  selectedVertices,
  onToggle,
  vertexOffsets,
  axisLock,
}: {
  geometry: BufferGeometry;
  assetId: string;
  selectedVertices: number[];
  onToggle: (idx: number) => void;
  vertexOffsets: number[] | null;
  axisLock: 'x' | 'y' | 'z' | null;
}) {
  // All hooks unconditionally — see note above about hooks-order.
  const dragRef = useRef<{
    vertexIdx: number;
    startScreen: { x: number; y: number };
    startVert: [number, number, number];
    preDragAssets: AssetRef[];
  } | null>(null);
  const commitVertexEdit = useEditor((s) => s.commitVertexEdit);
  const setVertexOffsets = useEditor((s) => s.setVertexOffsets);

  // Arrow key nudging — applies to ALL selected vertices.
  useEffect(() => {
    if (selectedVertices.length === 0) return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      const step = e.shiftKey ? 0.5 : 0.05;
      let dx = 0;
      let dy = 0;
      let dz = 0;
      switch (e.key) {
        case 'ArrowLeft':
          dx = -step;
          break;
        case 'ArrowRight':
          dx = step;
          break;
        case 'ArrowUp':
          dy = step;
          break;
        case 'ArrowDown':
          dy = -step;
          break;
        case 'PageUp':
          dz = step;
          break;
        case 'PageDown':
          dz = -step;
          break;
        default:
          return;
      }
      if (axisLock === 'x') dx = 0;
      if (axisLock === 'y') dy = 0;
      if (axisLock === 'z') dz = 0;
      e.preventDefault();
      const sel = useEditor.getState().selectedVertices;
      const positions = readPositions(geometry);
      if (!positions) return;
      const preAssets = useEditor.getState().assets;
      const offs =
        vertexOffsets && vertexOffsets.length === positions.length
          ? vertexOffsets.slice()
          : new Array(positions.length).fill(0);
      for (const idx of sel) {
        const cur = [
          positions[idx * 3] + (offs[idx * 3] ?? 0),
          positions[idx * 3 + 1] + (offs[idx * 3 + 1] ?? 0),
          positions[idx * 3 + 2] + (offs[idx * 3 + 2] ?? 0),
        ];
        const next: [number, number, number] = [
          cur[0] + dx,
          cur[1] + dy,
          cur[2] + dz,
        ];
        offs[idx * 3] = next[0] - positions[idx * 3];
        offs[idx * 3 + 1] = next[1] - positions[idx * 3 + 1];
        offs[idx * 3 + 2] = next[2] - positions[idx * 3 + 2];
      }
      setVertexOffsets(assetId, offs);
      commitVertexEdit(preAssets);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    selectedVertices,
    axisLock,
    geometry,
    assetId,
    vertexOffsets,
    setVertexOffsets,
    commitVertexEdit,
  ]);

  // Early return goes AFTER all hooks.
  const positions = readPositions(geometry);
  if (!positions) return null;
  const N = positions.length / 3;

  return (
    <group>
      {Array.from({ length: N }, (_, i) => {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        const isSelected = selectedVertices.includes(i);
        return (
          <mesh
            key={i}
            position={[x, y, z]}
            onPointerDown={(e) => {
              e.stopPropagation();
              onToggle(i);
              dragRef.current = {
                vertexIdx: i,
                startScreen: { x: e.clientX, y: e.clientY },
                startVert: [x, y, z],
                preDragAssets: useEditor.getState().assets,
              };
              (e.target as Element)?.setPointerCapture?.(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!dragRef.current || dragRef.current.vertexIdx !== i) return;
              const dxPx = e.clientX - dragRef.current.startScreen.x;
              const dyPx = e.clientY - dragRef.current.startScreen.y;
              const dxWorld = dxPx * 0.01;
              const dyWorld = -dyPx * 0.01;
              let dx = dxWorld;
              let dy = dyWorld;
              let dz = 0;
              if (axisLock === 'x') {
                dy = 0;
                dz = 0;
              } else if (axisLock === 'y') {
                dx = 0;
                dz = 0;
              } else if (axisLock === 'z') {
                dx = 0;
                dy = 0;
              }
              const positions = readPositions(geometry);
              if (!positions) return;
              const offs =
                vertexOffsets && vertexOffsets.length === positions.length
                  ? vertexOffsets.slice()
                  : new Array(positions.length).fill(0);
              const cur = [
                positions[i * 3] + (offs[i * 3] ?? 0),
                positions[i * 3 + 1] + (offs[i * 3 + 1] ?? 0),
                positions[i * 3 + 2] + (offs[i * 3 + 2] ?? 0),
              ];
              const next: [number, number, number] = [
                cur[0] + dx,
                cur[1] + dy,
                cur[2] + dz,
              ];
              offs[i * 3] = next[0] - positions[i * 3];
              offs[i * 3 + 1] = next[1] - positions[i * 3 + 1];
              offs[i * 3 + 2] = next[2] - positions[i * 3 + 2];
              setVertexOffsets(assetId, offs);
            }}
            onPointerUp={(e) => {
              if (dragRef.current) {
                const pre = dragRef.current.preDragAssets;
                dragRef.current = null;
                commitVertexEdit(pre);
              }
              (e.target as Element)?.releasePointerCapture?.(e.pointerId);
            }}
          >
            <sphereGeometry args={[isSelected ? 0.04 : 0.025, 8, 8]} />
            <meshBasicMaterial color={isSelected ? '#ff5e5e' : '#ffeb3b'} />
          </mesh>
        );
      })}
    </group>
  );
}