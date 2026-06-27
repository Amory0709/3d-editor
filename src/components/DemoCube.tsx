/** A friendly placeholder shown when no asset is loaded. */
export function DemoCube() {
  return (
    <group>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1.2, 1.2, 1.2]} />
        <meshStandardMaterial color="#6da7ff" metalness={0.15} roughness={0.35} />
      </mesh>
      {/* wireframe overlay gives a "construction" feel that reads as placeholder */}
      <mesh>
        <boxGeometry args={[1.22, 1.22, 1.22]} />
        <meshBasicMaterial color="#5ce0c5" wireframe transparent opacity={0.35} />
      </mesh>
    </group>
  );
}