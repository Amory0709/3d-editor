import { useEffect, useMemo } from 'react';
import {
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  EdgesGeometry,
  SphereGeometry,
  type BufferGeometry,
} from 'three';
import type { ColliderType } from '@/lib/formats';

/**
 * Visual collider marker (phase 4a). Renders a wireframe primitive
 * sized to match the type's default extents. The marker has no
 * collider of its own — collisions are computed externally. Its only
 * job is to show "this is where the collider would be" with a clear
 * visual that doesn't fight the asset's own material.
 *
 * Sizing convention (units = scene units, ~meters):
 *   - box:      1.0 × 1.0 × 1.0  (matches primitive cube default)
 *   - sphere:   radius 0.6        (matches primitive sphere default)
 *   - capsule:  radius 0.4, length 1.2 (axis = Y, hemispheres included)
 *   - cylinder: radius 0.5, height 1.2 (matches primitive cylinder default)
 *
 * Custom halfExtents / radius / height will arrive in phase 4b when
 * physics integration needs them; for now the default size keeps the
 * marker roughly aligned with the visible mesh bounds for primitives.
 */
export function ColliderMarker({ type }: { type: ColliderType }) {
  // Build the underlying geometry once per type, derive an EdgesGeometry
  // for the wireframe, and dispose both on unmount to keep GPU memory
  // tight (CapsuleGeometry in particular allocates a lot of vertices).
  const { source, edges } = useMemo(() => buildMarker(type), [type]);

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

function buildMarker(type: ColliderType): {
  source: BufferGeometry;
  edges: EdgesGeometry;
} {
  let source: BufferGeometry;
  switch (type) {
    case 'box':
      source = new BoxGeometry(1, 1, 1);
      break;
    case 'sphere':
      source = new SphereGeometry(0.6, 24, 16);
      break;
    case 'capsule':
      // Capsule is along Y; length is the cylinder portion, hemispheres
      // add `radius` on each end.
      source = new CapsuleGeometry(0.4, 1.2, 8, 16);
      break;
    case 'cylinder':
      source = new CylinderGeometry(0.5, 0.5, 1.2, 24);
      break;
  }
  // 1° threshold so flat-shaded faces still get edges (capsule + cylinder).
  const edges = new EdgesGeometry(source, 1);
  return { source, edges };
}
