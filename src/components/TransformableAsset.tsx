import { forwardRef } from 'react';
import type { Group } from 'three';
import type { AssetRef } from '@/store/editor';
import { MeshRenderer } from './MeshRenderer';

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
 */
export const TransformableAsset = forwardRef<Group, Props>(
  ({ asset }, ref) => (
    <group
      ref={ref}
      position={asset.transform.position}
      rotation={asset.transform.rotation}
      scale={asset.transform.scale}
    >
      <MeshRenderer asset={asset} />
    </group>
  ),
);

TransformableAsset.displayName = 'TransformableAsset';