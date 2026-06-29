import { useEffect, useMemo } from 'react';
import {
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  EdgesGeometry,
  SphereGeometry,
  type BufferGeometry,
} from 'three';
import type { ColliderSpec } from '@/lib/formats';

/**
 * Visual collider marker. Renders a wireframe primitive matching the
 * collider spec's size parameters (cyan edges, depth-test off so the
 * marker stays visible through the asset mesh).
 *
 * Phase 4b: the marker is sized from the same `ColliderSpec` that the
 * physics body uses, so what the user sees and what the physics sees
 * stay in sync. Scale is intentionally NOT applied here — the marker
 * lives inside the asset's TransformableAsset group, so the group
 * transform handles scale automatically.
 */
export function ColliderMarker({ spec }: { spec: ColliderSpec }) {
  // Build the underlying geometry once per spec, derive an EdgesGeometry
  // for the wireframe, and dispose both on unmount to keep GPU memory
  // tight (CapsuleGeometry in particular allocates a lot of vertices).
  const { source, edges } = useMemo(() => buildMarker(spec), [spec]);

  useEffect(() => {
    return () => {
      source.dispose();
      edges.dispose();
    };
  }, [source, edges]);

  return (
    <lineSegments>
      <primitive object={edges} attach="geometry" />
      <lineBasicMaterial
        color="#5ce0c5"
        transparent
        opacity={0.75}
        depthTest={false}
        toneMapped={false}
      />
    </lineSegments>
  );
}

function buildMarker(spec: ColliderSpec): {
  source: BufferGeometry;
  edges: EdgesGeometry;
} {
  let source: BufferGeometry;
  switch (spec.type) {
    case 'box': {
      // BoxGeometry's size arg is the full side length, not halfExtents.
      const [hx, hy, hz] = spec.halfExtents;
      source = new BoxGeometry(hx * 2, hy * 2, hz * 2);
      break;
    }
    case 'sphere':
      source = new SphereGeometry(spec.radius, 24, 16);
      break;
    case 'capsule':
      // CapsuleGeometry is along Y. Length arg is the cylinder portion;
      // hemispheres add `radius` on each end.
      source = new CapsuleGeometry(spec.radius, spec.height, 8, 16);
      break;
    case 'cylinder':
      source = new CylinderGeometry(spec.radius, spec.radius, spec.height, 24);
      break;
  }
  // 1° threshold so flat-shaded faces still get edges (capsule + cylinder).
  const edges = new EdgesGeometry(source, 1);
  return { source, edges };
}
