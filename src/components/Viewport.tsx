import { Suspense, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Bounds, Center, GizmoHelper, GizmoViewport, Grid, OrbitControls } from '@react-three/drei';
import { useEditor } from '@/store/editor';
import { handleFiles } from '@/lib/upload';
import { MeshRenderer } from './MeshRenderer';
import { DemoCube } from './DemoCube';
import { ErrorBoundary } from './ErrorBoundary';

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

function Scene() {
  const activeAsset = useEditor((s) =>
    s.activeAssetId ? s.assets.find((a) => a.id === s.activeAssetId) ?? null : null,
  );
  const showDemo = !activeAsset;

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
        {/* key={assetId} forces remount → re-fits camera on asset switch */}
        <Bounds key={activeAsset?.id ?? 'demo'} fit clip margin={1.4}>
          {showDemo ? <DemoCube /> : <MeshRenderer asset={activeAsset} />}
        </Bounds>
      </Suspense>

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
  const error = useEditor((s) => s.error);
  const loading = useEditor((s) => s.loading);
  const setError = useEditor((s) => s.setError);

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
        // only clear when leaving the viewport itself, not when crossing child boundaries
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void handleFiles(e.dataTransfer.files);
      }}
    >
      {/*
        ErrorBoundary wraps the <Canvas> from OUTSIDE so a thrown loader
        error tears down the whole Canvas (R3F's reconciler doesn't always
        unwind cleanly when the boundary lives inside the Canvas tree).
      */}
      <ErrorBoundary
        fallback={(err) => <div className="canvas-crash">⚠ Canvas error: {err.message}</div>}
        onError={(err) => setError(`Load failed: ${err.message}`)}
      >
        <Canvas
          camera={{ position: [3, 3, 5], fov: 45, near: 0.1, far: 1000 }}
          dpr={[1, 2]}
        >
          <Scene />
        </Canvas>
      </ErrorBoundary>

      <div className="overlay">
        Drag to orbit · Right-drag to pan · Scroll to zoom · Drop file to upload
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