import { useEffect } from 'react';
import { useGLTF } from '@react-three/drei';
import { useLoader } from '@react-three/fiber';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MeshStandardMaterial } from 'three';
import type { AssetRef } from '@/store/editor';
import { useEditor } from '@/store/editor';
import { disposeObject3D } from '@/lib/dispose';

function GLTFMesh({ url }: { url: string }) {
  const gltf = useGLTF(url);
  // Free GPU buffers when the component unmounts (asset removed / switched).
  useEffect(() => {
    return () => disposeObject3D(gltf.scene);
  }, [gltf.scene]);
  return <primitive object={gltf.scene} />;
}

function OBJMesh({ url }: { url: string }) {
  const obj = useLoader(OBJLoader, url);

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

  return <primitive object={obj} />;
}

/**
 * Renders a mesh asset via GLTFLoader (.glb/.gltf) or OBJLoader (.obj).
 * Must be rendered inside a Canvas, inside a Suspense boundary.
 *
 * TODO(phase 3): <primitive object={scene}> bypasses R3F reconciliation;
 * will need to traverse and recreate meshes in JSX for transform tools.
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

  if (asset.format === 'glb' || asset.format === 'gltf') {
    return <GLTFMesh url={asset.url} />;
  }
  if (asset.format === 'obj') {
    return <OBJMesh url={asset.url} />;
  }
  // unsupported format — caller should have filtered via MESH_FORMATS
  return null;
}