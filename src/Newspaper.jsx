import React, { useMemo, useState, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Text, Environment, Float, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';

function PaperSheet({ color = "#f4f1ea", position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1], frontContent, backContent }) {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh receiveShadow castShadow>
        <boxGeometry args={[3, 4, 0.02]} />
        <meshStandardMaterial color={color} roughness={0.9} metalness={0.05} />
      </mesh>
      {frontContent && <group position={[0, 0, 0.02]}>{frontContent}</group>}
      {backContent && (
        <group position={[0, 0, -0.02]} rotation={[0, Math.PI, 0]}>
          {backContent}
        </group>
      )}
    </group>
  );
}

function FoldedPaper({ headline, subhead, countryName }) {
  const [isOpen, setIsOpen] = useState(false);
  const groupRef = useRef();
  const leftPanelRef = useRef();
  
  // Smooth animation state
  useFrame((state, delta) => {
    const easing = 4 * delta;
    
    // Left Panel Rotation: Closed (Math.PI - 0.3) vs Open (0.3)
    const targetLeftRot = isOpen ? 0.15 : (Math.PI - 0.25);
    leftPanelRef.current.rotation.y = THREE.MathUtils.lerp(leftPanelRef.current.rotation.y, targetLeftRot, easing);
    
    // Group Rotation: Center the view based on state
    // Closed: Look at Spine/Cover (Rot Y ~ -1.5)
    // Open: Look at Spread (Rot Y ~ 0)
    const targetGroupRot = isOpen ? 0 : -1.5;
    groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, targetGroupRot, easing);
  });

  const dateString = useMemo(() => {
    return new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }, []);

  // --- Content Components ---

  const CoverContent = (
    <group>
      <Text
        position={[0, 1.2, 0]}
        fontSize={0.35}
        maxWidth={2.5}
        color="#1a1a1a"
        anchorX="center"
        anchorY="middle"
        font="./fonts/PlayfairDisplay-Regular.woff"
        textAlign="center"
      >
        THE GLOBAL TIMES
      </Text>
      <mesh position={[0, 0.5, 0]}>
        <planeGeometry args={[2.6, 0.01]} />
        <meshBasicMaterial color="#1a1a1a" />
      </mesh>
      <Text
        position={[0, 0, 0]}
        fontSize={0.15}
        maxWidth={2.6}
        color="#4a4a4a"
        textAlign="center"
        anchorX="center"
        anchorY="top"
        font="./fonts/Merriweather-Regular.woff"
      >
        SPECIAL REPORT: {countryName ? countryName.toUpperCase() : "WORLD"}
      </Text>
      <Text
        position={[0, -1.6, 0]}
        fontSize={0.08}
        color="#666"
        anchorX="center"
        anchorY="bottom"
        font="./fonts/Merriweather-Regular.woff"
      >
        {dateString} • VOL. CCLIV
      </Text>
    </group>
  );

  const InsideLeftContent = (
    <group>
        <Text
            position={[0, 1.8, 0]}
            fontSize={0.12}
            color="#666"
            anchorX="center"
            anchorY="top"
            font="./fonts/Merriweather-Regular.woff"
        >
            ANALYSIS
        </Text>
        <Text
            position={[0, 1.5, 0]}
            fontSize={0.22}
            maxWidth={2.6}
            color="#1a1a1a"
            textAlign="center"
            anchorX="center"
            anchorY="top"
            lineHeight={1.2}
            font="./fonts/PlayfairDisplay-Regular.woff"
        >
            {headline || "Global Trends Analysis"}
        </Text>
        <Text
            position={[0, 0.8, 0]}
            fontSize={0.11}
            maxWidth={2.2}
            color="#4a4a4a"
            textAlign="center"
            anchorX="center"
            anchorY="top"
            font="./fonts/Merriweather-Regular.woff"
            lineHeight={1.4}
        >
            {subhead || "Data reveals shifting patterns in international discourse."}
        </Text>
        <group position={[0, -0.2, 0]}>
            <mesh>
                <planeGeometry args={[2.4, 1.2]} />
                <meshStandardMaterial color="#e5e5e5" />
            </mesh>
            <Text position={[0, 0, 0.01]} fontSize={0.1} color="#999" font="./fonts/Merriweather-Regular.woff">
                [Data Visualization]
            </Text>
        </group>
    </group>
  );

  const InsideRightContent = (
    <group>
        <Text
            position={[0, 1.8, 0]}
            fontSize={0.12}
            color="#666"
            anchorX="center"
            anchorY="top"
            font="./fonts/Merriweather-Regular.woff"
        >
            MARKET WATCH
        </Text>
        <group position={[0, 1.4, 0]}>
            <Text position={[-0.8, 0, 0]} fontSize={0.09} color="#222" maxWidth={0.9} textAlign="justify" anchorX="center" anchorY="top" font="./fonts/Merriweather-Regular.woff">
                "The interconnectedness of global media narratives has reached unprecedented levels, as shown by recent data."
            </Text>
            <Text position={[0.8, 0, 0]} fontSize={0.09} color="#222" maxWidth={0.9} textAlign="justify" anchorX="center" anchorY="top" font="./fonts/Merriweather-Regular.woff">
                "Observers note that while some nations dominate the conversation, emerging voices are reshaping the landscape."
            </Text>
        </group>
        <group position={[0, 0, 0]}>
             <Text position={[-0.8, 0, 0]} fontSize={0.09} color="#222" maxWidth={0.9} textAlign="justify" anchorX="center" anchorY="top" font="./fonts/Merriweather-Regular.woff">
                Lorum ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
            </Text>
            <Text position={[0.8, 0, 0]} fontSize={0.09} color="#222" maxWidth={0.9} textAlign="justify" anchorX="center" anchorY="top" font="./fonts/Merriweather-Regular.woff">
                Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
            </Text>
        </group>
    </group>
  );

  return (
    <group 
        position={[0, -0.5, 0]} 
        rotation={[-0.1, 0, 0]} 
        onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
        onPointerOver={() => document.body.style.cursor = 'pointer'}
        onPointerOut={() => document.body.style.cursor = 'auto'}
    >
      <Float speed={2} rotationIntensity={0.05} floatIntensity={0.1}>
        <group ref={groupRef}>
          {/* Left Panel (Animated) */}
          {/* Pivot point is 0,0,0. Panel is offset so its right edge is at 0 */}
          <group ref={leftPanelRef} position={[0, 0, 0]} rotation={[0, Math.PI - 0.25, 0]}>
             {/* The mesh itself needs to be offset to the LEFT of the pivot */}
             <PaperSheet 
                position={[-1.5, 0, 0]} // Center of left page is -1.5 from spine
                frontContent={InsideLeftContent} 
                backContent={CoverContent} 
             />
          </group>

          {/* Right Panel (Static Base) */}
          <group position={[0, 0, 0]} rotation={[0, -0.15, 0]}>
             {/* The mesh needs to be offset to the RIGHT of the pivot */}
             <PaperSheet 
                position={[1.5, 0, 0]} // Center of right page is +1.5 from spine
                frontContent={InsideRightContent}
             />
          </group>
        </group>
      </Float>
      
      <ContactShadows 
        opacity={0.4} 
        scale={10} 
        blur={2.5} 
        far={4} 
        resolution={256} 
        color="#000000" 
        position={[0, -2, 0]}
      />
    </group>
  );
}

export default function NewspaperOverlay({ headline, subhead, countryName }) {
  return (
    <div style={{ 
      position: 'absolute', 
      bottom: 0, 
      left: '50%', 
      transform: 'translateX(-50%)', 
      width: '800px', 
      height: '600px', 
      pointerEvents: 'auto', // Enable interaction
      zIndex: 50
    }}>
      <Canvas camera={{ position: [0, 0, 9], fov: 35 }}>
        <ambientLight intensity={0.9} />
        <spotLight position={[5, 5, 5]} angle={0.3} penumbra={0.5} intensity={1} castShadow />
        <pointLight position={[-5, 0, 5]} intensity={0.5} />
        <FoldedPaper headline={headline} subhead={subhead} countryName={countryName} />
        <Environment preset="city" />
      </Canvas>
    </div>
  );
}
