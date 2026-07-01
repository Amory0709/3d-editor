import { Suspense, useCallback, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  Bounds,
  Center,
  GizmoHelper,
  GizmoViewport,
  Grid,
  OrbitControls,
  TransformControls,
} from '@react-three/drei';
import type { Group } from 'three';
import { useEditor, type AssetRef, type ObjectTransform } from '@/store/editor';
import { handleFiles } from '@/lib/upload';
import { TransformableAsset } from './TransformableAsset';
import { ErrorBoundary } from './ErrorBoundary';
import { PhysicsTicker } from './PhysicsTicker';
import { useEditorShortcuts } from '@/lib/keyboard';
import { GeometryUndoBridge } from './MeshGeometryBridge';

function LoadingHint() {
  return (
    <Center>
      <mesh>
        <sphereGeometry args={[0.25, 16, 16]} />
        <meshBasicMaterial color="#5ce0c5" wireframe />
      </mesh>
    </Center>
  );
}

function Scene({ refitNonce }: { refitNonce: number }) {
  const assets = useEditor((s) => s.assets);
  const activeAsset = useEditor((s) =>
    s.activeAssetId ? s.assets.find((a) => a.id === s.activeAssetId) ?? null : null,
  );
  const setActiveAsset = useEditor((s) => s.setActiveAsset);
  const transformMode = useEditor((s) => s.transformMode);
  const axisLock = useEditor((s) => s.axisLock);
  const mode = useEditor((s) => s.mode);
  const playMode = useEditor((s) => s.playMode);
  // Phase 3.2a — locked while the user is dragging a vertex in edit
  // mode. See EditableMesh for the full reasoning; tl;dr OrbitControls
  // listens to canvas pointermove (separate from R3F's event tree), so
  // it would otherwise rotate the camera mid-drag and the vertex would
  // fly away from the cursor.
  const vertexDragging = useEditor((s) => s.vertexDragging);
  const setAssetTransform = useEditor((s) => s.setAssetTransform);
  const setAssetTransformLive = useEditor((s) => s.setAssetTransformLive);
  const commitTransformDrag = useEditor((s) => s.commitTransformDrag);

  // Ref to the controlled group so TransformControls can attach to it.
  // We use a callback ref that triggers a state update so TransformControls
  // renders AFTER the group has mounted (otherwise its `object` prop is null).
  const [groupObj, setGroupObj] = useState<Group | null>(null);

  // Gizmo drag state. onObjectChange fires every frame while the user is
  // dragging the gizmo, so we route those updates through the "live" action
  // (no history push). The pre-drag assets snapshot is captured on mouseDown
  // and pushed onto the undo stack once on mouseUp — see commitTransformDrag.
  const isDraggingRef = useRef(false);
  const preDragAssetsRef = useRef<AssetRef[] | null>(null);

  const readGroupTransform = useCallback(
    (g: Group): ObjectTransform => ({
      position: [g.position.x, g.position.y, g.position.z],
      // rotation includes the Euler order so downstream consumers
      // (physics) don't have to re-assert XYZ. THREE's default order
      // is 'XYZ' — the gizmo currently doesn't change it, but if a
      // future numeric inspector or shortcut rotates via a different
      // order, the body will follow exactly.
      rotation: [g.rotation.x, g.rotation.y, g.rotation.z, g.rotation.order],
      scale: [g.scale.x, g.scale.y, g.scale.z],
    }),
    [],
  );

  // The Bounds key only changes when refitNonce changes — i.e. on the very
  // first asset load (set by parent) or when the user presses F. Asset
  // switches no longer trigger a camera snap.
  const boundsKey = `fit-${refitNonce}`;

  return (
    <>
      <color attach="background" args={['#0a0c12']} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 8, 5]} intensity={1} />
      <directionalLight position={[-3, 2, -3]} intensity={0.3} />

      <GeometryUndoBridge />

      <Grid
        args={[20, 20]}
        cellSize={0.5}
        cellThickness={0.5}
        cellColor="#2a3142"
        sectionSize={2}
        sectionThickness={1}
        sectionColor="#4a5a78"
        fadeDistance={25}
        fadeStrength={1.5}
        infiniteGrid
      />
      <axesHelper args={[1.5]} />

      <Suspense fallback={<LoadingHint />}>
        <Bounds key={boundsKey} fit clip margin={1.4}>
          {/*
            Render ALL assets, not just the active one. The
            click-to-select handler changes activeAssetId so the
            gizmo follows the user's pick. Without this, only the
            selected asset is in the scene at any time — every
            other one is invisible despite being in the store.
          */}
          {assets.map((a) => (
            <TransformableAsset
              key={a.id}
              asset={a}
              onSelect={() => setActiveAsset(a.id)}
              ref={a.id === activeAsset?.id ? setGroupObj : undefined}
              editable={a.id === activeAsset?.id}
            />
          ))}
        </Bounds>
      </Suspense>

      {/*
        TransformControls sits OUTSIDE Bounds so the gizmo helpers don't
        inflate the bounding-box calculation. It attaches to the same group
        that Bounds is fitting to, so transforms happen in the same frame.
        Edit mode: the translate/rotate/scale gizmo would overlap the
        yellow vertex handles and steal pointer events from vertex drags.
        Vertex editing IS the transform in edit mode, so the gizmo is
        hidden here. The underlying group transform is preserved — exit
        edit mode and the gizmo comes back at the same position/rotation.
      */}
      {mode !== 'edit' && groupObj && activeAsset && (
        <TransformControls
          object={groupObj}
          mode={transformMode}
          size={1.2}
          showX={axisLock === null || axisLock === 'x'}
          showY={axisLock === null || axisLock === 'y'}
          showZ={axisLock === null || axisLock === 'z'}
          // Phase 4d: gizmo stays visible in play mode (so the user
          // sees where the asset ended up) but is disabled. Physics
          // is the source of truth during play.
          enabled={!playMode}
          onMouseDown={() => {
            // Capture the pre-drag assets snapshot. Read from the store
            // directly (not from a React selector) to avoid stale-closure
            // issues on rapid consecutive drags.
            isDraggingRef.current = true;
            preDragAssetsRef.current = useEditor.getState().assets;
          }}
          onMouseUp={() => {
            isDraggingRef.current = false;
            if (preDragAssetsRef.current) {
              commitTransformDrag(preDragAssetsRef.current);
              preDragAssetsRef.current = null;
            }
          }}
          onObjectChange={() => {
            const t = readGroupTransform(groupObj);
            if (isDraggingRef.current) {
              // During a drag: live update, no history push.
              setAssetTransformLive(activeAsset.id, t);
            } else {
              // External mutation path (e.g. reset button or future
              // keyboard nudge): normal setAssetTransform with one
              // history entry.
              setAssetTransform(activeAsset.id, t);
            }
          }}
        />
      )}

      <OrbitControls makeDefault enableDamping dampingFactor={0.1} enabled={!vertexDragging} />

      {/*
        Phase 4b: headless tick that reconciles + steps the physics
        world each frame. Must be inside <Canvas> to access useFrame.
      */}
      <PhysicsTicker />

      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport
          axisColors={['#ff7676', '#5ce0c5', '#6da7ff']}
          labelColor="#0a0c12"
        />
      </GizmoHelper>
    </>
  );
}

export function Viewport() {
  const [isDragging, setDragging] = useState(false);
  const [localRefitNonce, setLocalRefitNonce] = useState(0);
  const error = useEditor((s) => s.error);
  const loading = useEditor((s) => s.loading);
  const setError = useEditor((s) => s.setError);
  const storeRefitNonce = useEditor((s) => s.refitRequestNonce);
  const mode = useEditor((s) => s.mode);

  // Combine store-driven refits (every new asset upload) with
  // local F-key refits. The Bounds key changes whenever either ticks.
  const refitNonce = storeRefitNonce + localRefitNonce;

  // F key → manual re-fit.
  useEditorShortcuts({
    onRefit: () => setLocalRefitNonce((n) => n + 1),
  });

  return (
    <div
      className={`viewport${isDragging ? ' dragging' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void handleFiles(e.dataTransfer.files);
      }}
    >
      <ErrorBoundary
        fallback={(err) => <div className="canvas-crash">⚠ Canvas error: {err.message}</div>}
        onError={(err) => setError(`Load failed: ${err.message}`)}
      >
        <Canvas
          camera={{ position: [3, 3, 5], fov: 45, near: 0.1, far: 1000 }}
          dpr={[1, 2]}
        >
          <Scene refitNonce={refitNonce} />
        </Canvas>
      </ErrorBoundary>

      <div className="overlay">
        {mode === 'edit' ? (
          <span>Arrow keys nudge (Shift = 0.5) · X/Y/Z lock axis · F make face · ⌘Z undo · Esc deselect</span>
        ) : (
          <span>W/E/R mode · X/Y/Z lock · F refit · Esc deselect · ⌘Z undo · Drop to upload</span>
        )}
        {loading && <span className="loading-tag">· loading…</span>}
      </div>

      {error && (
        <div className="error-banner" onClick={() => setError(null)}>
          ⚠ {error} <span className="error-dismiss">(click to dismiss)</span>
        </div>
      )}

      {isDragging && <div className="dropzone-overlay">Drop to upload</div>}
    </div>
  );
}