import React, { useMemo, useState, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Text, Environment, Float, ContactShadows, Image } from '@react-three/drei';
import * as THREE from 'three';
import MERRIWEATHER_FONT from './assets/fonts/Merriweather/static/Merriweather_120pt-Regular.ttf';
import MERRIWEATHER_BOLD_FONT from './assets/fonts/Merriweather/static/Merriweather_120pt-Bold.ttf';
import PLAYFAIR_FONT from './assets/fonts/Playfair_Display/static/PlayfairDisplay-Regular.ttf';

const formatList = (items) => {
    if (!items || items.length === 0) return "";
    const names = items.slice(0, 3).map(i => i.name);
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
};

function HorizontalBarChart({ data, width = 2.0, height = 1.2 }) {
  if (!data || !data.length) return null;
  
  const maxVal = Math.max(...data.map(d => d.egoToPartner)) || 1;
  const rowHeight = height / data.length;
  const barThickness = rowHeight * 0.65;
  
  return (
    <group position={[0, 0, 0.005]}> 
        <Text
             position={[0, height/2 + 0.15, 0.001]}
             fontSize={0.12}
             color="#1a1a1a"
             anchorX="center"
             anchorY="bottom"
             font={PLAYFAIR_FONT}
        >
            Other 'Hot' Countries
        </Text>

        {data.map((item, i) => {
            const barLen = (item.egoToPartner / maxVal) * width;
            // Top to bottom
            const y = (height / 2) - (i * rowHeight) - (rowHeight / 2);
            
            return (
                <group key={i} position={[0, y, 0]}>
                    {/* Left Group: Flag + ISO */}
                    <group position={[-width/2 - 0.08, 0, 0]}>
                         <Text
                            position={[0, 0, 0.001]} 
                            fontSize={0.10}
                            color="#444"
                            anchorX="right"
                            anchorY="middle"
                            font={MERRIWEATHER_BOLD_FONT}
                         >
                            {item.iso}
                         </Text>
                         <Image 
                            url={`https://flagcdn.com/w80/${item.iso.toLowerCase()}.png`}
                            position={[-0.28, 0, 0.001]}
                            scale={[0.22, 0.15, 1]}
                            transparent
                         />
                    </group>

                    {/* Bar */}
                    <mesh position={[-width/2 + barLen/2, 0, 0]}>
                        <planeGeometry args={[barLen, barThickness]} />
                        <meshBasicMaterial color="#333" />
                    </mesh>

                    {/* Value */}
                     <Text
                        position={[-width/2 + barLen + 0.05, 0, 0.001]}
                        fontSize={0.08}
                        color="#666"
                        anchorX="left"
                        anchorY="middle"
                        font={MERRIWEATHER_BOLD_FONT}
                    >
                         {item.egoToPartner > 1000 ? (item.egoToPartner/1000).toFixed(1) + 'k' : item.egoToPartner}
                    </Text>
                </group>
            );
        })}
    </group>
  );
}

function PaperSheet({ color = "#f4f1ea", position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1], frontContent, backContent, onClick }) {
  // Helper to toggle canvas pointer-events
  const setPointerEvents = (enabled) => {
    const canvas = document.querySelector('#newspaper-canvas');
    if (canvas) {
        canvas.style.pointerEvents = enabled ? 'auto' : 'none';
    }
  };

  return (
    <group 
      position={position} 
      rotation={rotation} 
      scale={scale}
      onClick={onClick}
      onPointerOver={(e) => { 
          e.stopPropagation(); 
          document.body.style.cursor = 'pointer'; 
          setPointerEvents(true);
      }}
      onPointerOut={(e) => { 
          e.stopPropagation(); 
          document.body.style.cursor = 'auto'; 
          // We don't immediately set to none, because we might be moving to another part of the paper.
          // The parent container is 'none', so if we leave the mesh, we want to fall back to that.
          // BUT, if the mouse leaves the mesh, it is now over the "empty" canvas.
          // If we set pointer-events: none here, the canvas ignores the mouse,
          // so the mouse is now "over" the map behind it.
          // This creates the desired passthrough effect!
          setPointerEvents(false);
      }}
    >
      <mesh 
        receiveShadow 
        castShadow 
      >
        <boxGeometry args={[3, 4, 0.02]} />
        <meshStandardMaterial color={color} roughness={0.9} metalness={0.05} />
      </mesh>
      
      {/* Invisible Hitbox for reliable clicking across all child content */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[3, 4, 0.15]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
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

function FoldedPaper({ headline, subhead, countryName, topMentions, leaderboardData, isDraggingRef }) {
  const [isOpen, setIsOpen] = useState(false);
  const groupRef = useRef();
  const leftPanelRef = useRef();
  
  // Logic for paragraphs
  const egoName = countryName || "The country";
  const outboundList = [...(leaderboardData?.blue || []), ...(leaderboardData?.green || [])]
      .sort((a, b) => b.egoToPartner - a.egoToPartner)
      .slice(0, 5);
  
  const outboundText = outboundList.length 
    ? `Recent analysis reveals that the press in ${egoName} has been particularly fixated on ${formatList(outboundList)}, driving a significant portion of outbound coverage.`
    : `${egoName} has maintained a relatively quiet profile regarding specific foreign nations, with no dominant outbound narratives emerging.`;

  const inboundList = (leaderboardData?.orange || []).slice(0, 3);
  const inboundText = inboundList.length
    ? `In contrast, ${egoName} finds itself a frequent topic abroad, appearing prominently in the headlines of ${formatList(inboundList)}, suggesting strong external scrutiny or interest.`
    : `Externally, ${egoName} has not been a primary focus of concentrated media attention from any single partner nation in this period.`;

  const mutualList = (leaderboardData?.purple || []).slice(0, 3);
  const mutualText = mutualList.length
    ? `Meanwhile, a more balanced exchange defines relationships with ${formatList(mutualList)}, where mention volumes indicate a reciprocal dialogue.`
    : `Reciprocal media exchanges were less common, with few partners showing balanced mention ratios with ${egoName}.`;

  // Smooth animation state
  useFrame((state, delta) => {
    const easing = 3 * delta; 
    
    const targetLeftRot = isOpen ? 0 : (Math.PI - 0.005);
    leftPanelRef.current.rotation.y = THREE.MathUtils.lerp(leftPanelRef.current.rotation.y, targetLeftRot, easing);
    
    const targetX = isOpen ? 0 : -1.5;
    groupRef.current.position.x = THREE.MathUtils.lerp(groupRef.current.position.x, targetX, easing);
    
    groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, 0, easing);
  });

  const dateString = useMemo(() => {
    return new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }, []);

  const toggleOpen = (e) => {
    if (isDraggingRef?.current) return; // Prevent toggle if dragging
    e.stopPropagation();
    setIsOpen(s => !s);
  };

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
        font={PLAYFAIR_FONT}
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
        font={MERRIWEATHER_FONT}
      >
        SPECIAL REPORT:
        {'\n'}
        {countryName ? countryName.toUpperCase() : "WORLD"}
      </Text>
      <Text
        position={[0, -2.5, 0]}
        fontSize={0.08}
        color="#666"
        anchorX="center"
        anchorY="bottom"
        font={MERRIWEATHER_FONT}
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
            font={MERRIWEATHER_FONT}
        >
            JUST IN
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
            font={PLAYFAIR_FONT}
        >
            {headline || "Global Trends Analysis"}
        </Text>
        <Text
            position={[0, 0.6, 0]}
            fontSize={0.11}
            maxWidth={2.2}
            color="#4a4a4a"
            textAlign="center"
            anchorX="center"
            anchorY="top"
            font={MERRIWEATHER_FONT}
            lineHeight={1.4}
        >
            {subhead || "Data reveals shifting patterns in international discourse."}
        </Text>
        <group position={[0, 0.1, 0]}>
             <mesh position={[0, 0.15, 0]}>
                <planeGeometry args={[2.4, 0.01]} />
                <meshBasicMaterial color="#ccc" />
            </mesh>
            
            <Text
                position={[0, 0, 0]}
                fontSize={0.10}
                color="#222"
                maxWidth={2.2}
                textAlign="justify"
                anchorX="center"
                anchorY="top"
                font={MERRIWEATHER_FONT}
                lineHeight={1.5}
            >
                "{outboundText}"
            </Text>
             <Text
                position={[0, -0.65, 0]}
                fontSize={0.10}
                color="#222"
                maxWidth={2.2}
                textAlign="justify"
                anchorX="center"
                anchorY="top"
                font={MERRIWEATHER_FONT}
                lineHeight={1.5}
            >
                "{inboundText}"
            </Text>
             <Text
                position={[0, -1.3, 0]}
                fontSize={0.10}
                color="#222"
                maxWidth={2.2}
                textAlign="justify"
                anchorX="center"
                anchorY="top"
                font={MERRIWEATHER_FONT}
                lineHeight={1.5}
            >
                "{mutualText}"
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
            font={MERRIWEATHER_FONT}
        >
            MARKET WATCH
        </Text>
        <group position={[0, 1.4, 0]}>
            <Text position={[-0.8, 0, 0]} fontSize={0.10} color="#222" maxWidth={0.9} textAlign="justify" anchorX="center" anchorY="top" font={MERRIWEATHER_FONT}>
                "The interconnectedness of global media narratives has reached unprecedented levels, as shown by recent data."
            </Text>
            <Text position={[0.8, 0, 0]} fontSize={0.10} color="#222" maxWidth={0.9} textAlign="justify" anchorX="center" anchorY="top" font={MERRIWEATHER_FONT}>
                "Observers note that while some nations dominate the conversation, emerging voices are reshaping the landscape."
            </Text>
        </group>
        
        {/* Horizontal Chart on Right Page */}
        <group position={[0, -0.8, 0]}>
             <HorizontalBarChart data={topMentions} width={1.5} height={1.4} />
        </group>
    </group>
  );

  return (
    <group 
        position={[0, -0.5, 0]} 
        rotation={[-0.1, 0, 0]} 
    >
      <Float speed={2} rotationIntensity={0.05} floatIntensity={0.1}>
        <group ref={groupRef}>
          {/* Left Panel (Animated Pivot) */}
          <group ref={leftPanelRef} position={[0, 0, 0.01]}> 
             <PaperSheet 
                position={[-1.5, 0, 0]} 
                frontContent={InsideLeftContent} 
                backContent={CoverContent} 
                onClick={toggleOpen}
             />
          </group>

          {/* Right Panel (Static Base) */}
          <group position={[0, 0, -0.01]}> 
             <PaperSheet 
                position={[1.5, 0, 0]} 
                frontContent={InsideRightContent}
                onClick={toggleOpen}
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

export default function NewspaperOverlay({ headline, subhead, countryName, topMentions, leaderboardData }) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const initialPos = useRef({ x: 0, y: 0 });

  const handlePointerDown = (e) => {
    // Only start drag if we clicked on the canvas (which means we clicked a mesh, thanks to RaycastManager)
    // But wait, RaycastManager sets pointerEvents: auto on the canvas when hovering a mesh.
    // So if we get an event here, it bubbled from the canvas, so we are clicking the newspaper.
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    initialPos.current = { ...position };
    
    const handlePointerMove = (moveEvent) => {
      if (!isDragging.current) return;
      const dx = moveEvent.clientX - dragStart.current.x;
      const dy = moveEvent.clientY - dragStart.current.y; // Note: positive y is down in DOM, up in CSS transform usually... 
      // Actually transform translate(x, y) moves element down for +y.
      // coordinate system matches screen.
      
      setPosition({
        x: initialPos.current.x + dx,
        y: initialPos.current.y + dy 
      });
    };

    const handlePointerUp = () => {
      isDragging.current = false;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      
      // Small timeout to allow the click event to fire/be suppressed in children if needed
      setTimeout(() => {
          // Reset logic if needed
      }, 50);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  return (
    <div 
      onPointerDown={handlePointerDown}
      style={{ 
      position: 'absolute', 
      bottom: 0, 
      left: '50%', 
      // Apply drag translation on top of centering
      transform: `translate(calc(-50% + ${position.x}px), ${position.y}px)`, 
      width: '800px', 
      height: '600px', 
      pointerEvents: 'none', // Container ignores clicks, but children (Canvas) can capture and bubble
      zIndex: 50,
      // Ensure the container itself doesn't block if pointer-events: auto happens
      // Actually, if we add onPointerDown, we need the element to receive it.
      // If pointerEvents is none, it won't.
      // But the Canvas inside has pointerEvents: auto (conditionally).
      // Events from Canvas bubble to this div. So this works for dragging the NEWSPAPER.
    }}>
      <Canvas 
        id="newspaper-canvas"
        camera={{ position: [0, 0, 9], fov: 35 }}
        style={{ pointerEvents: 'none' }} // Default: pass through. We enable 'auto' on hover of meshes.
        // We need a way to catch the INITIAL hover to enable pointer events?
        // Wait, if pointer-events is none, the canvas NEVER receives the mouseover event to trigger the R3F raycaster.
        // This circular dependency is the problem.
        
        // CORRECTION:
        // To support "passthrough empty space but catch objects", we usually need to:
        // 1. Keep pointer-events: auto on the canvas.
        // 2. In onPointerMove (DOM event on canvas), check if R3F raycaster hits anything.
        // 3. If it hits, stop propagation? No, that doesn't help clicks passing through to DOM elements behind.
        
        // Actually, the standard solution for "Click through transparent canvas" is:
        // Set pointer-events: none on the canvas.
        // Track mouse position globally.
        // Use a raycaster from the camera to the mouse position manually in a loop.
        // If an intersection is found, set pointer-events: auto on the canvas.
        // If no intersection, set pointer-events: none.
        
        onCreated={(state) => {
            state.gl.domElement.id = "newspaper-canvas";
        }}
      >
        <ambientLight intensity={0.9} />
        <spotLight position={[5, 5, 5]} angle={0.3} penumbra={0.5} intensity={1} castShadow />
        <pointLight position={[-5, 0, 5]} intensity={0.5} />
        <RaycastManager />
        <FoldedPaper isDraggingRef={isDragging} headline={headline} subhead={subhead} countryName={countryName} topMentions={topMentions} leaderboardData={leaderboardData} />
        <Environment preset="city" />
      </Canvas>
    </div>
  );
}

function RaycastManager() {
  const { camera, scene, gl } = useThree();
  
  // Ref to store latest mouse position
  const mouse = useRef(new THREE.Vector2());
  const raycaster = useRef(new THREE.Raycaster());

  React.useEffect(() => {
      const handleMouseMove = (event) => {
          const canvas = gl.domElement;
          if (!canvas) return;
          
          const rect = canvas.getBoundingClientRect();
          
          const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
          
          mouse.current.set(x, y);
          raycaster.current.setFromCamera(mouse.current, camera);
          
          const intersects = raycaster.current.intersectObjects(scene.children, true);
          const hit = intersects.find(i => i.object.visible && i.object.type === 'Mesh');
          
          if (hit) {
              canvas.style.pointerEvents = 'auto';
          } else {
              canvas.style.pointerEvents = 'none';
          }
      };
      
      window.addEventListener('mousemove', handleMouseMove);
      return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [camera, scene, gl]);

  return null;
}

function RaycastController() { return null; }
