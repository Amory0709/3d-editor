import { useEffect } from 'react';
import { useGLTF } from '@react-three/drei';
import { useLoader } from '@react-three/fiber';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MeshStandardMaterial } from 'three';
import type { AssetRef } from '@/store/editor';
import { useEditor } from '@/store/editor';
import { disposeObject3D } from '@/lib/dispose';
import { PrimitiveRenderer } from './PrimitiveRenderer';

function GLTFMesh({ asset }: { asset: AssetRef }) {
  const gltf = useGLTF(asset.url!);
  // Free GPU buffers when the component unmounts (asset removed / switched).
  useEffect(() => {
    return () => disposeObject3D(gltf.scene);
  }, [gltf.scene]);
  // Transform is applied by the TransformableAsset wrapper, not here.
  return <primitive object={gltf.scene} />;
}

function OBJMesh({ asset }: { asset: AssetRef }) {
  const obj = useLoader(OBJLoader, asset.url!);

  // OBJLoader yields meshes with no material assigned — give them a neutral
  // PBR look so the asset isn't pitch black. MTL loading is a phase-3 item.
  useEffect(() => {
    const fallback = new MeshStandardMaterial({ color: '#cccccc' });
    obj.traverse((child) => {
      const mesh = child as unknown as {
        isMesh?: boolean;
        material?: unknown;
      };
      if (mesh.isMesh && !mesh.material) {
        mesh.material = fallback;
      }
    });
    return () => {
      fallback.dispose();
      disposeObject3D(obj);
    };
  }, [obj]);

  // Transform is applied by the TransformableAsset wrapper, not here.
  return <primitive object={obj} />;
}

/**
 * Renders a mesh asset. Dispatches between:
 *  - file assets (glb / gltf / obj)
 *  - primitive assets (cube / sphere / cylinder)
 *
 * Must be rendered inside a Canvas, inside a Suspense boundary.
 *
 * Transform is NOT applied here — the wrapping <TransformableAsset>
 * applies it, so the same mesh can be controlled by TransformControls
 * without compositing transforms.
 *
 * TODO(phase 3.1): <primitive object={scene}> bypasses R3F reconciliation;
 * vertex-level picking will need to traverse and recreate meshes in JSX.
 */
export function MeshRenderer({ asset }: { asset: AssetRef }) {
  const setLoading = useEditor((s) => s.setLoading);

  // Clear the global `loading` flag only once this renderer has actually
  // mounted with the new asset. For useGLTF / useLoader children that
  // suspend, this effect runs after the loader resolves — exactly when
  // we want the toolbar "Loading…" to disappear.
  useEffect(() => {
    setLoading(false);
  }, [asset.id, setLoading]);

  if (asset.source === 'primitive') {
    return <PrimitiveRenderer asset={asset} />;
  }
  if (asset.format === 'glb' || asset.format === 'gltf') {
    return <GLTFMesh asset={asset} />;
  }
  if (asset.format === 'obj') {
    return <OBJMesh asset={asset} />;
  }
  return null;
}