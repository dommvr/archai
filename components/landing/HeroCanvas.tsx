'use client'

/**
 * HeroCanvas — R3F 3D background for the hero section.
 *
 * Loaded with `dynamic(() => import('./HeroCanvas'), { ssr: false })` in Hero.tsx.
 * The ssr:false is MANDATORY — R3F uses window/WebGL at import time and will
 * crash Next.js SSR without it.
 *
 * The scene renders a soft wireframe architectural geometry to evoke blueprint
 * drafting aesthetics without being distracting.
 */

import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Wireframe, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

function RotatingGeometry() {
  const meshRef = useRef<THREE.Mesh>(null)
  const mesh2Ref = useRef<THREE.Mesh>(null)

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.08
      meshRef.current.rotation.x += delta * 0.03
    }
    if (mesh2Ref.current) {
      mesh2Ref.current.rotation.y -= delta * 0.05
      mesh2Ref.current.rotation.z += delta * 0.02
    }
  })

  return (
    <>
      {/* Primary — large wireframe box (architectural volume) */}
      <mesh ref={meshRef} position={[2, 0, -3]}>
        <boxGeometry args={[2.5, 3.5, 2]} />
        <meshBasicMaterial color="#2E2E2E" wireframe />
      </mesh>

      {/* Secondary — smaller rotated cube */}
      <mesh ref={mesh2Ref} position={[-2.5, -0.5, -4]}>
        <boxGeometry args={[1.5, 1.5, 1.5]} />
        <meshBasicMaterial color="#C15D2E" wireframe opacity={0.3} transparent />
      </mesh>

      {/* Ground plane grid */}
      <gridHelper args={[20, 20, '#2E2E2E', '#1F1F1F']} position={[0, -2.5, 0]} />
    </>
  )
}

export default function HeroCanvas() {
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 6], fov: 55 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 1.5]}
      >
        <ambientLight intensity={0.2} />
        <RotatingGeometry />
      </Canvas>
    </div>
  )
}
