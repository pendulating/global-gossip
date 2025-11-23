import React from 'react';
import { Canvas } from '@react-three/fiber';
import { Text, Environment, Float } from '@react-three/drei';

function FoldedPaper({ headline, subhead }) {
  // Folded card geometry: two planes angled like a tent card (V-shape inverted)
  // Left panel (front face)
  // Right panel (back face, visible from side)
  // We rotate it slightly so it faces the camera but shows depth

  return (
    <group position={[0, -0.5, 0]} rotation={[-0.15, 0, 0]}>
      <Float speed={2} rotationIntensity={0.05} floatIntensity={0.1}>
        
        {/* Main Group: Rotated to show the fold */}
        <group rotation={[0, 0, 0]}>
          
          {/* Left Panel (Front Page) */}
          <group position={[-1.38, 0, 0.58]} rotation={[0, 0.4, 0]}>
            <mesh receiveShadow castShadow>
              <boxGeometry args={[3, 4, 0.05]} />
              <meshStandardMaterial color="#f4f1ea" roughness={0.8} metalness={0.1} />
            </mesh>
            
            {/* Content Layer - Slightly offset to avoid z-fighting */}
            <group position={[0, 0, 0.03]}>
              {/* Masthead */}
              <Text
                position={[0, 1.85, 0]}
                fontSize={0.22}
                maxWidth={2.8}
                color="#1a1a1a"
                anchorX="center"
                anchorY="top"
                font="./fonts/Merriweather-Regular.woff"
              >
                THE GLOBAL TIMES
              </Text>
              <mesh position={[0, 1.6, 0]}>
                 <planeGeometry args={[2.6, 0.01]} />
                 <meshBasicMaterial color="#1a1a1a" />
              </mesh>

              {/* Headline */}
              <Text
                position={[0, 1.3, 0]}
                fontSize={0.22}
                maxWidth={2.6}
                color="#1a1a1a"
                textAlign="center"
                anchorX="center"
                anchorY="top"
                lineHeight={1.2}
                font="./fonts/Merriweather-Regular.woff"
              >
                {headline || "BREAKING NEWS"}
              </Text>

              {/* Subhead */}
              <Text
                position={[0, 0.0, 0]}
                fontSize={0.12}
                maxWidth={2.6}
                color="#4a4a4a"
                textAlign="center"
                anchorX="center"
                anchorY="top"
                font="./fonts/Merriweather-Regular.woff"
              >
                {subhead || "Global analysis reveals new trends in cross-border mentions."}
              </Text>

              {/* Fake Columns */}
              <group position={[0, -0.8, 0]}>
                 <Text
                   position={[-0.65, 0, 0]}
                   fontSize={0.08}
                   maxWidth={1.1}
                   color="#666"
                   textAlign="justify"
                   anchorX="center"
                   anchorY="top"
                   lineHeight={1.5}
                   font="./fonts/Merriweather-Regular.woff"
                 >
                   {"Lorum ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation."}
                 </Text>
                 <Text
                   position={[0.65, 0, 0]}
                   fontSize={0.08}
                   maxWidth={1.1}
                   color="#666"
                   textAlign="justify"
                   anchorX="center"
                   anchorY="top"
                   lineHeight={1.5}
                   font="./fonts/Merriweather-Regular.woff"
                 >
                   {"Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia."}
                 </Text>
              </group>
            </group>
          </group>

          {/* Right Panel (Back Page/Fold) */}
          <group position={[1.38, 0, 0.58]} rotation={[0, -0.4, 0]}>
            <mesh receiveShadow castShadow>
              <boxGeometry args={[3, 4, 0.05]} />
              <meshStandardMaterial color="#e8e5de" roughness={0.9} metalness={0.0} />
            </mesh>
            {/* Fake text on the other side just for texture */}
             <group position={[0, 0, 0.03]}>
               <Text
                 position={[0, 1.5, 0]}
                 fontSize={0.15}
                 maxWidth={2.6}
                 color="#888"
                 textAlign="left"
                 anchorX="center"
                 anchorY="top"
                 font="./fonts/Merriweather-Regular.woff"
               >
                 MARKET WATCH
               </Text>
                <group position={[0, 0.5, 0]}>
                 <Text
                   position={[-0.65, 0, 0]}
                   fontSize={0.08}
                   maxWidth={1.1}
                   color="#999"
                   textAlign="justify"
                   anchorX="center"
                   anchorY="top"
                   font="./fonts/Merriweather-Regular.woff"
                 >
                   {"Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat."}
                 </Text>
                 <Text
                   position={[0.65, 0, 0]}
                   fontSize={0.08}
                   maxWidth={1.1}
                   color="#999"
                   textAlign="justify"
                   anchorX="center"
                   anchorY="top"
                   font="./fonts/Merriweather-Regular.woff"
                 >
                   {"Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur."}
                 </Text>
              </group>
             </group>
          </group>

        </group>
      </Float>
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
      pointerEvents: 'none',
      zIndex: 50
    }}>
      <Canvas camera={{ position: [0, 0, 9], fov: 35 }}>
        <ambientLight intensity={0.8} />
        <spotLight position={[5, 5, 5]} angle={0.3} penumbra={0.5} intensity={0.8} castShadow />
        <pointLight position={[-5, 0, 5]} intensity={0.3} />
        <FoldedPaper headline={headline} subhead={subhead} />
        <Environment preset="city" />
      </Canvas>
    </div>
  );
}
