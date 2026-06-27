import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from '@react-three/drei';

export function Viewport() {
  return (
    <div className="viewport">
      <Canvas
        camera={{ position: [3, 3, 5], fov: 45, near: 0.1, far: 1000 }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['#0a0c12']} />
        <ambientLight intensity={0.4} />
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

        {/* asset rendering slotted in by Mesh / Gaussian renderer components later */}

        <OrbitControls makeDefault enableDamping dampingFactor={0.1} />

        <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
          <GizmoViewport axisColors={['#ff7676', '#5ce0c5', '#6da7ff']} labelColor="#0a0c12" />
        </GizmoHelper>
      </Canvas>
      <div className="overlay">
        Drag to orbit · Right-drag to pan · Scroll to zoom
      </div>
    </div>
  );
}