"use client";

import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

export type CoreState =
  | "idle"
  | "searching"
  | "retrieving"
  | "reasoning"
  | "generating"
  | "error";

const STATE_COLOR: Record<CoreState, string> = {
  idle: "#5B6472",
  searching: "#F0A857",
  retrieving: "#F0A857",
  reasoning: "#F0A857",
  generating: "#4FD1C5",
  error: "#F0685C",
};

const STATE_SPEED: Record<CoreState, number> = {
  idle: 0.06,
  searching: 0.35,
  retrieving: 0.3,
  reasoning: 0.22,
  generating: 0.18,
  error: 0.5,
};

function Rings({ state }: { state: CoreState }) {
  const groupRef = useRef<THREE.Group>(null);
  const ring1 = useRef<THREE.Mesh>(null);
  const ring2 = useRef<THREE.Mesh>(null);
  const ring3 = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);

  const color = useMemo(() => new THREE.Color(STATE_COLOR[state]), [state]);
  const speed = STATE_SPEED[state];

  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * speed * 0.4;
    if (ring1.current) ring1.current.rotation.x += delta * speed;
    if (ring2.current) ring2.current.rotation.y += delta * speed * 0.8;
    if (ring3.current) ring3.current.rotation.z += delta * speed * 0.6;
    if (core.current) {
      const s = 1 + Math.sin(Date.now() * 0.002 * (speed * 3 + 0.5)) * 0.04;
      core.current.scale.setScalar(s);
    }
  });

  return (
    <group ref={groupRef}>
      <mesh ref={core}>
        <icosahedronGeometry args={[0.55, 1]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={0.9} />
      </mesh>
      <mesh ref={ring1} rotation={[Math.PI / 3, 0, 0]}>
        <torusGeometry args={[1.05, 0.008, 8, 96]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} />
      </mesh>
      <mesh ref={ring2} rotation={[0, Math.PI / 4, Math.PI / 6]}>
        <torusGeometry args={[1.3, 0.006, 8, 96]} />
        <meshBasicMaterial color={"#4FD1C5"} transparent opacity={0.35} />
      </mesh>
      <mesh ref={ring3} rotation={[Math.PI / 5, Math.PI / 3, 0]}>
        <torusGeometry args={[1.55, 0.005, 8, 96]} />
        <meshBasicMaterial color={color} transparent opacity={0.22} />
      </mesh>
    </group>
  );
}

export function KnowledgeCore({ state = "idle" as CoreState }: { state?: CoreState }) {
  return (
    <div className="h-full w-full" aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 4.2], fov: 42 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 1.5]}
      >
        <Rings state={state} />
      </Canvas>
    </div>
  );
}
