import { BoxGeometry, CylinderGeometry, SphereGeometry } from 'three';
import type { PrimitiveType } from '@/lib/formats';

/**
 * Build a BufferGeometry for a given primitive type.
 *
 * Used by `<EditableMesh>` via `PrimitiveEditable` — both active and
 * inactive primitive assets now share the same geometry pipeline
 * (always-mounted EditableMesh), so this is the single place that
 * creates primitive geometries.
 *
 * Geometry lifecycle: created in `useMemo([primitiveType])` inside
 * PrimitiveEditable, disposed via the `useEffect` cleanup in
 * EditableMeshBody.
 */
export function makeGeometry(type: PrimitiveType) {
  switch (type) {
    case 'cube':
      return new BoxGeometry(1, 1, 1);
    case 'sphere':
      return new SphereGeometry(0.6, 32, 24);
    case 'cylinder':
      return new CylinderGeometry(0.5, 0.5, 1.2, 32);
  }
}