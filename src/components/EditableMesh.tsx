import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import {
  EdgesGeometry,
  FrontSide,
  DoubleSide,
  type BufferAttribute,
  type BufferGeometry,
  type Camera,
  type LineSegments,
  type Object3D,
  type PerspectiveCamera,
  WireframeGeometry,
} from 'three';
import { Vector3 } from 'three';
import type { ThreeEvent } from '@react-three/fiber';
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

/**
 * Phase 3.2a — wireframe that follows the live (mutated) geometry.
 *
 * drei's `<Edges>` uses useLayoutEffect to build EdgesGeometry ONCE
 * and caches it as long as the geometry *reference* is unchanged.
 * In EditableMesh, the geometry's position attribute is mutated
 * in place every frame by useFrame to apply vertexOffsets. Same
 * BufferGeometry reference, different positions — drei's cache
 * stays stale and the wireframe renders against the *original*
 * (pre-drag) positions, not the current visual shape.
 *
 * User-visible symptoms this caused:
 *   - "看不到三角": EdgesGeometry with threshold=1 only shows
 *     hard (≥1° dihedral) edges, so quad→triangle diagonals (0°)
 *     are hidden. We pass `includeDiagonals=true` and rebuild
 *     via WireframeGeometry to expose the triangulation.
 *   - "拖得时间久面片越来越大": cube deforms as the user drags
 *     a vertex, but the cached edges stay at the original
 *     positions, so the visual wireframe appears to lag behind
 *     the mesh. User perceives the cube face as 'growing' past
 *     its wireframe.
 *
 * Fix: rebuild the wireframe geometry every frame from the
 * CURRENT position attribute (which useFrame has just written).
 * Cost is trivial for our meshes (cube = 24 verts, complex GLB
 * typically <10k). If we ever ship a mesh with >50k verts this
 * becomes a hot spot and we should switch to dirty-flag rebuild.
 */
function LiveWireframe({
  geometry,
  color,
  includeDiagonals,
}: {
  geometry: BufferGeometry;
  color: string;
  includeDiagonals: boolean;
}) {
  const lineRef = useRef<LineSegments>(null);
  const lastGeomRef = useRef<BufferGeometry | null>(null);
  const lastVersionRef = useRef<number>(-1);

  useFrame(() => {
    if (!lineRef.current) return;
    const attr = geometry.getAttribute('position');
    if (!attr) return;

    // Skip rebuild when the position attribute hasn't changed.
    // BufferAttribute.version increments each time needsUpdate=true
    // (set by useFrame in EditableMeshBody when applying offsets) —
    // a cheap integer compare beats rebuilding 60 BufferGeometries per
    // second. User reported intermittent jank; for complex GLBs the
    // build cost (walk all triangles, allocate Float32 arrays, push to
    // GPU) was the hotspot.
    //
    // Cast is needed because PositionAttr is typed as
    // BufferAttribute | InterleavedBufferAttribute; the former has
    // version, the latter doesn't. We only assign from
    // geometry.getAttribute('position') which on a regular mesh is
    // always BufferAttribute.
    const posAttr = attr as BufferAttribute;
    if (posAttr.version === lastVersionRef.current && lastGeomRef.current) {
      return;
    }
    lastVersionRef.current = posAttr.version;

    // Rebuild from the live geometry (positions reflect current
    // vertexOffsets because useFrame just wrote them). EdgesGeometry
    // hides coplanar edges (threshold default 1°); WireframeGeometry
    // shows every edge of every triangle, including the diagonals
    // that split each quad face into 2 triangles.
    const next = includeDiagonals
      ? new WireframeGeometry(geometry)
      : new EdgesGeometry(geometry, 1);
    if (lastGeomRef.current) lastGeomRef.current.dispose();
    lineRef.current.geometry = next;
    lastGeomRef.current = next;
  });

  return (
    <lineSegments ref={lineRef}>
      <lineBasicMaterial color={color} />
    </lineSegments>
  );
}

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

  // Phase 3.2a — snapshot the ORIGINAL base positions once per geometry.
  // The useFrame below applies vertexOffsets to the base on every frame.
  // Without this snapshot, useFrame would read its own previous output
  // (attr.array is mutated in place) and the offsets would compound
  // every frame, drifting the vertex to infinity within ~1s of dragging
  // by 0.3 units. See repro in scripts/cumulative-bug-repro.mts.
  //
  // The ref is keyed on `geometry` (object identity), so when a new
  // geometry replaces the old one (model reload, CSG result, etc.) we
  // re-snapshot. BufferGeometry is a mutable object, but we treat the
  // first observation as the canonical base; later external mutations
  // (e.g. boolean CSG replacing the geometry entirely) will swap the
  // object reference and we'll snapshot the new one.
  const basePositionsRef = useRef<{
    base: Float32Array;
    geom: BufferGeometry;
  } | null>(null);
  if (geometry && basePositionsRef.current?.geom !== geometry) {
    const positions = readPositions(geometry);
    if (positions) {
      basePositionsRef.current = {
        base: new Float32Array(positions), // copy, not alias
        geom: geometry,
      };
    }
  }

  // Apply offsets to the geometry every frame. Reads from the snapshotted
  // base (NOT from attr.array) so the operation is idempotent and the
  // vertex stays exactly where the user dragged it instead of drifting
  // away at +offset/frame.
  useFrame(() => {
    if (!geometry) return;
    const snap = basePositionsRef.current;
    if (!snap) return;
    const attr = geometry.getAttribute('position');
    if (!attr) return;
    const next = applyOffsets(snap.base, vertexOffsets);
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
        {/*
          DoubleSide in edit mode: when the user drags a vertex, the
          geometry can become non-convex and some faces flip inside-out.
          FrontSide (the default) culls those back-facing triangles, so
          the user would see "missing" faces at certain camera angles —
          "转到菜个角度的时候有些面看不到" report.

          Outside edit mode the gizmo user can still rotate the mesh
          freely, but normal viewing keeps FrontSide for correct lighting.
        */}
        <meshStandardMaterial
          color="#6da7ff"
          metalness={0.15}
          roughness={0.4}
          side={isEditMode ? DoubleSide : FrontSide}
        />
      </mesh>
      {/*
        Live wireframe (sibling, not child) so it has its own geometry
        pipeline. See LiveWireframe above for why drei's <Edges> doesn't
        work here — it caches against the geometry reference, but our
        useFrame mutates the position attribute in place, so drei never
        re-reads it. The wireframe would be stuck on the original
        pre-drag shape.

        includeDiagonals=true: shows every triangle edge, including
        the diagonal that splits each cube face into 2 triangles.
        EdgesGeometry(threshold=1) only shows ≥1° dihedral edges and
        hides those 0° diagonals.
      */}
      <LiveWireframe
        geometry={geometry}
        color="#1a2540"
        includeDiagonals={true}
      />
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
    /** World units per screen pixel at drag start — derived from the
     *  camera-to-vertex distance so 1px of cursor movement ≈ 1px worth
     *  of screen-plane movement in world space. See onPointerDown. */
    worldPerPixel: number;
    /** Camera right/up basis in world space at drag start, used to
     *  project the screen delta onto world axes (incl. axis-lock). */
    cameraRight: Vector3;
    cameraUp: Vector3;
    preDragAssets: AssetRef[];
  } | null>(null);
  const commitVertexEdit = useEditor((s) => s.commitVertexEdit);
  const setVertexOffsets = useEditor((s) => s.setVertexOffsets);
  const setVertexDragging = useEditor((s) => s.setVertexDragging);

  // R3F provides camera + viewport size for the camera-distance-aware
  // drag scale. Captured via useThree so we don't recompute on every
  // pointermove (size.height changes only on window resize).
  const { camera, size } = useThree();

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

  // Robustness: catch ⌘Z (or ⌘⇧Z) mid-drag. Without this, undo restores
  // the asset to pre-drag state, but our `dragRef.current` still holds
  // the OLD startScreen/startVert. The next pointermove would then
  // compute delta from a stale origin and the vertex would "teleport"
  // — looking like undo is broken even though the store is correct.
  // Fix: subscribe to history changes; if the past/future stack mutates
  // mid-drag, drop the in-progress drag silently. We do NOT commit
  // again — undo already restored pre-drag state and a second push would
  // just create a redundant history entry.
  useEffect(() => {
    let prevPastLen = useEditor.getState().history.past.length;
    let prevFutureLen = useEditor.getState().history.future.length;
    const unsub = useEditor.subscribe((state) => {
      const pastLen = state.history.past.length;
      const futureLen = state.history.future.length;
      if (pastLen !== prevPastLen || futureLen !== prevFutureLen) {
        if (dragRef.current) {
          dragRef.current = null;
        }
      }
      prevPastLen = pastLen;
      prevFutureLen = futureLen;
    });
    return unsub;
  }, []);

  // Robustness: pointer that leaves the canvas (off the dot, off the
  // viewport, into a sidebar input) never fires pointerup on the dot,
  // so dragRef.current would stay armed forever — corrupting every
  // subsequent drag. Fix: window-level pointerup + pointercancel
  // listeners that commit whatever was in flight. The local
  // onPointerUp is a no-op when dragRef is already null, so double-fire
  // is harmless.
  useEffect(() => {
    function onWindowPointerUp() {
      if (dragRef.current) {
        const pre = dragRef.current.preDragAssets;
        dragRef.current = null;
        commitVertexEdit(pre);
      }
      // Always release the OrbitControls lock — even if dragRef was
      // already null, the local mesh pointerUp might have raced
      // and left setVertexDragging(true) lingering. Clearing it on
      // ANY pointerup is the safest invariant.
      setVertexDragging(false);
    }
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerUp);
    return () => {
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerUp);
    };
  }, [commitVertexEdit, setVertexDragging]);

  // Robustness: when VertexOverlay unmounts (mode switch out of edit,
  // asset deletion, route change) with a drag in flight, commit the
  // in-progress edit so undo can still rewind it. Without this, the
  // user could drag a vertex, click "Mesh" tab, and lose the ability
  // to undo that edit (the live BufferGeometry shows the offset, but
  // history never recorded it).
  useEffect(() => {
    return () => {
      if (dragRef.current) {
        const pre = dragRef.current.preDragAssets;
        dragRef.current = null;
        commitVertexEdit(pre);
      }
      // Make sure OrbitControls re-enables even if the user was mid-drag
      // when mode / asset changed (which unmounts VertexOverlay).
      setVertexDragging(false);
    };
  }, [commitVertexEdit, setVertexDragging]);

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
              // Lock OrbitControls while dragging a vertex — otherwise
              // it listens to canvas pointermove (separate from R3F's
              // event tree) and rotates the camera, which makes the
              // captured cameraRight / cameraUp basis stale and the
              // vertex "flies out" of the cursor. Viewport reads this
              // flag and passes it to <OrbitControls enabled={...}>.
              setVertexDragging(true);
              // Compute screen→world scale from camera distance to the
              // vertex so the drag feels 1:1 with the cursor no matter
              // how zoomed in/out the viewport is.
              const vertexWorld = new Vector3();
              e.object.getWorldPosition(vertexWorld);
              const d = camera.position.distanceTo(vertexWorld);
              // camera from useThree is typed as Camera; only PerspectiveCamera
              // has `fov`. We use a PerspectiveCamera in the Canvas (camera={{
              // position: [3,3,5], fov: 45, ... }} in Viewport.tsx), so this
              // cast is safe but we still narrow via `isPerspectiveCamera` so
              // tsc is happy.
              const persp = camera as PerspectiveCamera;
              const fovRad = (persp.fov * Math.PI) / 180;
              // For a perspective camera: at distance d, the visible
              // height spans 2 * d * tan(fov/2); worldPerPixel = visible
              // height / viewport height (in CSS px).
              const worldPerPixel =
                (d * Math.tan(fovRad / 2) * 2) / Math.max(1, size.height);
              // Camera basis in world space: column 0 = right, column 1 = up.
              // We capture these once at drag start so a mid-drag camera
              // orbit doesn't make the vertex dance.
              const cameraRight = new Vector3().setFromMatrixColumn(
                (camera as Camera).matrixWorld,
                0,
              );
              const cameraUp = new Vector3().setFromMatrixColumn(
                (camera as Camera).matrixWorld,
                1,
              );
              dragRef.current = {
                vertexIdx: i,
                startScreen: { x: e.clientX, y: e.clientY },
                startVert: [x, y, z],
                worldPerPixel,
                cameraRight,
                cameraUp,
                preDragAssets: useEditor.getState().assets,
              };
              // R3F-specific pointer capture. Plain DOM setPointerCapture
              // (via e.target.setPointerCapture) makes the canvas keep
              // receiving DOM events, but R3F's intersect() then
              // raycasts to dispatch — and the cursor is no longer over
              // the small (~13px) vertex sphere, so onPointerMove stops
              // firing even though DOM events keep coming. The R3F-wrapped
              // setPointerCapture (e.setPointerCapture) ALSO populates
              // R3F's internal capturedMap, which intersect() consults
              // to keep dispatching to captured objects regardless of
              // raycast.
              //
              // Without this fix the vertex visually snaps to wherever
              // the raycast happens to land each frame (or stops
              // moving entirely once the cursor exits the sphere),
              // producing the "doesn't follow mouse" symptom.
              // R3F adds setPointerCapture / releasePointerCapture to
              // the event object at runtime (see
              // node_modules/@react-three/fiber/.../events.js). The
              // wrapped method populates R3F's internal capturedMap
              // so the raycast in intersect() doesn't need to find the
              // sphere on every subsequent pointermove. The DOM's
              // setPointerCapture alone is not enough — it keeps DOM
              // events flowing on the canvas, but R3F's intersect()
              // then raycasts, misses the small sphere, and the
              // onPointerMove stops firing → vertex doesn't follow
              // cursor.
              (e as ThreeEvent<PointerEvent> & {
                setPointerCapture: (id: number) => void;
              }).setPointerCapture?.(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!dragRef.current || dragRef.current.vertexIdx !== i) return;
              const drag = dragRef.current;
              const dxPx = e.clientX - drag.startScreen.x;
              const dyPx = e.clientY - drag.startScreen.y;
              const dxWorld_units = dxPx * drag.worldPerPixel;
              const dyWorld_units = -dyPx * drag.worldPerPixel;
              // Project screen-space delta onto the world axis using the
              // camera basis captured at drag start. This makes the drag
              // feel 1:1 with the cursor regardless of camera distance
              // (zoom) or camera angle (orbit).
              const r = drag.cameraRight;
              const u = drag.cameraUp;
              // World-space delta vector (no axis lock applied yet):
              const worldDx = r.x * dxWorld_units + u.x * dyWorld_units;
              const worldDy = r.y * dxWorld_units + u.y * dyWorld_units;
              const worldDz = r.z * dxWorld_units + u.z * dyWorld_units;
              // With axis lock, keep only the component along the locked
              // world axis. e.g. lock X means only motion projected onto
              // world X (not screen X) counts.
              let dx = 0;
              let dy = 0;
              let dz = 0;
              if (axisLock === null) {
                dx = worldDx;
                dy = worldDy;
                dz = worldDz;
              } else if (axisLock === 'x') {
                dx = worldDx;
              } else if (axisLock === 'y') {
                dy = worldDy;
              } else if (axisLock === 'z') {
                dz = worldDz;
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
              setVertexDragging(false);
              (e as ThreeEvent<PointerEvent> & {
                releasePointerCapture: (id: number) => void;
              }).releasePointerCapture?.(e.pointerId);
            }}
          >
            {/*
              Sphere sizes: 0.025 unselected, 0.04 selected.
              With R3F pointer capture working, the drag follows the
              cursor regardless of hit-testing (see fix c013dd1), so
              we don't need the bigger 0.04/0.07 hit target. User
              reported '红色编辑的点很大' — the 0.07 selected size was
              visually overwhelming the cube. ~6px unselected /
              ~10px selected on default 1080px viewport keeps the
              spheres easy to grab (capture means the raycast miss on
              subsequent frames is fine) without clutter.
            */}
            <sphereGeometry args={[isSelected ? 0.04 : 0.025, 8, 8]} />
            <meshBasicMaterial color={isSelected ? '#ff5e5e' : '#ffeb3b'} />
          </mesh>
        );
      })}
    </group>
  );
}