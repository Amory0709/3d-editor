import { Suspense, useEffect, useRef, useState } from 'react';
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
import { useEditor } from '@/store/editor';
import { handleFiles } from '@/lib/upload';
import { TransformableAsset } from './TransformableAsset';
import { DemoCube } from './DemoCube';
import { ErrorBoundary } from './ErrorBoundary';
import { useEditorShortcuts } from '@/lib/keyboard';

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
  const activeAsset = useEditor((s) =>
    s.activeAssetId ? s.assets.find((a) => a.id === s.activeAssetId) ?? null : null,
  );
  const transformMode = useEditor((s) => s.transformMode);
  const setAssetTransform = useEditor((s) => s.setAssetTransform);
  const showDemo = !activeAsset;

  // Ref to the controlled group so TransformControls can attach to it.
  // We use a callback ref that triggers a state update so TransformControls
  // renders AFTER the group has mounted (otherwise its `object` prop is null).
  const [groupObj, setGroupObj] = useState<Group | null>(null);

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
          {showDemo ? (
            <DemoCube />
          ) : (
            <TransformableAsset asset={activeAsset} ref={setGroupObj} />
          )}
        </Bounds>
      </Suspense>

      {/*
        TransformControls sits OUTSIDE Bounds so the gizmo helpers don't
        inflate the bounding-box calculation. It attaches to the same group
        that Bounds is fitting to, so transforms happen in the same frame.
      */}
      {groupObj && activeAsset && (
        <TransformControls
          object={groupObj}
          mode={transformMode}
          size={0.8}
          onObjectChange={() => {
            setAssetTransform(activeAsset.id, {
              position: [
                groupObj.position.x,
                groupObj.position.y,
                groupObj.position.z,
              ],
              rotation: [
                groupObj.rotation.x,
                groupObj.rotation.y,
                groupObj.rotation.z,
              ],
              scale: [groupObj.scale.x, groupObj.scale.y, groupObj.scale.z],
            });
          }}
        />
      )}

      <OrbitControls makeDefault enableDamping dampingFactor={0.1} />

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
  const [refitNonce, setRefitNonce] = useState(0);
  const error = useEditor((s) => s.error);
  const loading = useEditor((s) => s.loading);
  const setError = useEditor((s) => s.setError);
  const activeAssetId = useEditor((s) => s.activeAssetId);

  // Auto-fit camera on the first asset upload (not on every switch).
  // See README follow-up "Bounds camera flash" — this is the phase-3 fix.
  const hasFitFirstAssetRef = useRef(false);
  useEffect(() => {
    if (activeAssetId && !hasFitFirstAssetRef.current) {
      hasFitFirstAssetRef.current = true;
      setRefitNonce((n) => n + 1);
    }
  }, [activeAssetId]);

  // F key → manual re-fit.
  useEditorShortcuts({
    onRefit: () => setRefitNonce((n) => n + 1),
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
        <span>W/E/R translate/rotate/scale · F refit · Esc deselect · Drop file to upload</span>
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