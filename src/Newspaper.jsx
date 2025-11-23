import React, { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Text, Environment, Float, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';

function PaperSheet({ color = "#f4f1ea", position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1], children }) {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* Left Panel (Front) */}
      <group position={[-1.38, 0, 0.58]} rotation={[0, 0.4, 0]}>
        <mesh receiveShadow castShadow>
          <boxGeometry args={[3, 4, 0.02]} />
          <meshStandardMaterial color={color} roughness={0.9} metalness={0.05} />
        </mesh>
        {children && <group position={[0, 0, 0.02]}>{children}</group>}
      </group>

      {/* Right Panel (Back) */}
      <group position={[1.38, 0, 0.58]} rotation={[0, -0.4, 0]}>
        <mesh receiveShadow castShadow>
          <boxGeometry args={[3, 4, 0.02]} />
          <meshStandardMaterial color={color === "#f4f1ea" ? "#e8e5de" : color} roughness={0.9} metalness={0.05} />
        </mesh>
      </group>
    </group>
  );
}

function FoldedPaper({ headline, subhead }) {
  // Get current date for the paper
  const dateString = useMemo(() => {
    return new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }, []);

  return (
    <group position={[0, -0.5, 0]} rotation={[-0.15, 0, 0]}>
      <Float speed={2} rotationIntensity={0.05} floatIntensity={0.1}>
        
        <group rotation={[0, 0, 0]}>
          {/* Inner Sheets (to create volume) */}
          <PaperSheet position={[0, -0.01, -0.05]} scale={[0.99, 0.99, 0.99]} color="#e6e2d8" />
          <PaperSheet position={[0, -0.02, -0.1]} scale={[0.98, 0.98, 0.98]} color="#dcd8ce" />

          {/* Main Sheet */}
          <PaperSheet>
            {/* Masthead */}
            <Text
              position={[0, 1.85, 0]}
              fontSize={0.22}
              maxWidth={2.8}
              color="#1a1a1a"
              anchorX="center"
              anchorY="top"
              font="./fonts/Merriweather-Regular.woff"
              letterSpacing={0.05}
            >
              THE GLOBAL TIMES
            </Text>
            
            {/* Date Line */}
            <group position={[0, 1.68, 0]}>
                <mesh position={[0, 0, 0]}>
                    <planeGeometry args={[2.6, 0.005]} />
                    <meshBasicMaterial color="#1a1a1a" />
                </mesh>
                <Text
                    position={[-1.25, -0.06, 0]}
                    fontSize={0.06}
                    color="#4a4a4a"
                    anchorX="left"
                    anchorY="middle"
                    font="./fonts/Merriweather-Regular.woff"
                >
                    {dateString}
                </Text>
                <Text
                    position={[1.25, -0.06, 0]}
                    fontSize={0.06}
                    color="#4a4a4a"
                    anchorX="right"
                    anchorY="middle"
                    font="./fonts/Merriweather-Regular.woff"
                >
                    VOL. CCLIV • NO. 128 • $3.00
                </Text>
                <mesh position={[0, -0.12, 0]}>
                    <planeGeometry args={[2.6, 0.002]} />
                    <meshBasicMaterial color="#ccc" />
                </mesh>
            </group>

            {/* Headline */}
            <Text
              position={[0, 1.35, 0]}
              fontSize={0.22}
              maxWidth={2.6}
              color="#1a1a1a"
              textAlign="center"
              anchorX="center"
              anchorY="top"
              lineHeight={1.1}
              font="./fonts/Merriweather-Regular.woff"
            >
              {headline || "BREAKING NEWS"}
            </Text>

            {/* Subhead */}
            <Text
              position={[0, 0.95, 0]}
              fontSize={0.11}
              maxWidth={2.0}
              color="#4a4a4a"
              textAlign="center"
              anchorX="center"
              anchorY="top"
              font="./fonts/Merriweather-Regular.woff"
              lineHeight={1.4}
            >
              {subhead || "Global analysis reveals new trends in cross-border mentions."}
            </Text>

            {/* Main Image Placeholder */}
            <group position={[0, 0.1, 0]}>
                <mesh>
                    <planeGeometry args={[2.4, 1.2]} />
                    <meshStandardMaterial color="#ddd" roughness={0.6} />
                </mesh>
                <mesh position={[0, 0, 0.001]}>
                     <planeGeometry args={[2.3, 1.1]} />
                     <meshStandardMaterial color="#cdcdcd" roughness={0.8} />
                </mesh>
                {/* Image Caption */}
                <Text
                    position={[-1.15, -0.65, 0]}
                    fontSize={0.06}
                    maxWidth={2.3}
                    color="#666"
                    anchorX="left"
                    anchorY="top"
                    font="./fonts/Merriweather-Regular.woff"
                    fontStyle="italic"
                >
                    Figure 1: Visualization of cross-border media attention.
                </Text>
            </group>

            {/* Columns */}
            <group position={[0, -0.9, 0]}>
               {/* Column 1 */}
               <Text
                 position={[-0.85, 0, 0]}
                 fontSize={0.07}
                 maxWidth={0.8}
                 color="#222"
                 textAlign="justify"
                 anchorX="center"
                 anchorY="top"
                 lineHeight={1.6}
                 font="./fonts/Merriweather-Regular.woff"
               >
                 {"Lorum ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat."}
               </Text>
               
               {/* Column 2 */}
               <Text
                 position={[0, 0, 0]}
                 fontSize={0.07}
                 maxWidth={0.8}
                 color="#222"
                 textAlign="justify"
                 anchorX="center"
                 anchorY="top"
                 lineHeight={1.6}
                 font="./fonts/Merriweather-Regular.woff"
               >
                 {"Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum."}
               </Text>

               {/* Column 3 */}
               <Text
                 position={[0.85, 0, 0]}
                 fontSize={0.07}
                 maxWidth={0.8}
                 color="#222"
                 textAlign="justify"
                 anchorX="center"
                 anchorY="top"
                 lineHeight={1.6}
                 font="./fonts/Merriweather-Regular.woff"
               >
                 {"Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo."}
               </Text>
            </group>
          </PaperSheet>

        </group>
      </Float>
      
      {/* Contact Shadow for grounding */}
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
      pointerEvents: 'none', 
      zIndex: 50
    }}>
      <Canvas camera={{ position: [0, 0, 9], fov: 35 }}>
        <ambientLight intensity={0.9} />
        <spotLight position={[5, 5, 5]} angle={0.3} penumbra={0.5} intensity={1} castShadow />
        <pointLight position={[-5, 0, 5]} intensity={0.5} />
        <FoldedPaper headline={headline} subhead={subhead} />
        <Environment preset="city" />
      </Canvas>
    </div>
  );
}
