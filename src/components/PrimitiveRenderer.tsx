import { useEffect, useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { BoxGeometry, CylinderGeometry, SphereGeometry } from 'three';
import type { AssetRef } from '@/store/editor';
import type { PrimitiveType } from '@/lib/formats';

interface Props {
  asset: AssetRef;
  onSelect?: (e: ThreeEvent<MouseEvent>) => void;
}

/** Build a BufferGeometry for a given primitive type. */
function makeGeometry(type: PrimitiveType) {
  switch (type) {
    case 'cube':
      return new BoxGeometry(1, 1, 1);
    case 'sphere':
      return new SphereGeometry(0.6, 32, 24);
    case 'cylinder':
      return new CylinderGeometry(0.5, 0.5, 1.2, 32);
  }
}

/**
 * Procedural mesh geometry for primitive assets (cube / sphere / cylinder).
 * Geometry is created once per primitive type via useMemo and disposed
 * on unmount to keep GPU buffers clean.
 *
 * Transform is applied by the TransformableAsset wrapper, not here —
 * so the mesh's world position/rotation/scale stays at identity and the
 * wrapper group's transform drives everything.
 */
export function PrimitiveRenderer({ asset, onSelect }: Props) {
  const geometry = useMemo(() => {
    if (!asset.primitiveType) return null;
    return makeGeometry(asset.primitiveType);
  }, [asset.primitiveType]);

  useEffect(() => {
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);

  if (!geometry) return null;

  return (
    <mesh onClick={onSelect} castShadow receiveShadow>
      <primitive object={geometry} attach="geometry" />
      <meshStandardMaterial color="#6da7ff" metalness={0.15} roughness={0.4} />
    </mesh>
  );
}