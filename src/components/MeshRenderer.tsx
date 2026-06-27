import { useGLTF } from '@react-three/drei';
import { useLoader } from '@react-three/fiber';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { AssetRef } from '@/store/editor';

function GLTFMesh({ url }: { url: string }) {
  const gltf = useGLTF(url);
  // gltf.scene is the root Object3D; render as primitive
  return <primitive object={gltf.scene} />;
}

function OBJMesh({ url }: { url: string }) {
  const obj = useLoader(OBJLoader, url);
  // OBJLoader returns a Group
  return <primitive object={obj} />;
}

/**
 * Renders a mesh asset via GLTFLoader (.glb/.gltf) or OBJLoader (.obj).
 * Must be rendered inside a Canvas, inside a Suspense + error boundary.
 */
export function MeshRenderer({ asset }: { asset: AssetRef }) {
  if (asset.format === 'glb' || asset.format === 'gltf') {
    return <GLTFMesh url={asset.url} />;
  }
  if (asset.format === 'obj') {
    return <OBJMesh url={asset.url} />;
  }
  // unsupported format — caller should have filtered via PHASE5_FORMATS
  return null;
}