import { forwardRef, useImperativeHandle, useRef, useLayoutEffect } from 'react';
import type { Group } from 'three';
import type { AssetRef } from '@/store/editor';
import { MeshRenderer } from './MeshRenderer';
import { ColliderMarker } from './ColliderMarker';

interface Props {
  asset: AssetRef;
}

/**
 * Wraps MeshRenderer in a <group> that owns the world transform.
 *
 * Splitting the transform onto the group (instead of the mesh) means:
 *  - TransformControls can attach to this group via the forwarded ref
 *    and read/move position/rotation/scale directly.
 *  - MeshRenderer doesn't need to know about transforms.
 *  - Loading effect inside MeshRenderer fires on mount, regardless of
 *    whether the mesh is a primitive or a loaded file.
 *
 * The collider marker is a sibling of the mesh inside the same group,
 * so it inherits the asset's transform automatically. Toggling the
 * collider on/off in the sidebar just adds or removes this child.
 *
 * Rotation handling: the store stores `[x, y, z, order]` so the body
 * can rebuild a quaternion without assuming XYZ. R3F's `rotation`
 * prop only accepts a 3-tuple, and three's `Euler` defaults `order`
 * to 'XYZ' — if we passed `[x, y, z]` directly, R3F would call
 * `g.rotation.set(x, y, z, g.rotation.order)` and the group would be
 * reinterpreted under whatever order the group happens to have.
 * To make the order authoritative we drive position / scale via
 * props (R3F handles them fine) and drive rotation through a
 * useLayoutEffect that sets Euler + order on the ref BEFORE the
 * next paint, so the very first frame is correct.
 */
export const TransformableAsset = forwardRef<Group, Props>(
  ({ asset }, ref) => {
    const groupRef = useRef<Group>(null);
    useImperativeHandle(ref, () => groupRef.current as Group);

    useLayoutEffect(() => {
      const g = groupRef.current;
      if (!g) return;
      g.rotation.set(
        asset.transform.rotation[0],
        asset.transform.rotation[1],
        asset.transform.rotation[2],
        asset.transform.rotation[3],
      );
    });

    return (
      <group
        ref={groupRef}
        position={asset.transform.position}
        scale={asset.transform.scale}
      >
        <MeshRenderer asset={asset} />
        {asset.collider && <ColliderMarker spec={asset.collider} />}
      </group>
    );
  },
);

TransformableAsset.displayName = 'TransformableAsset';
