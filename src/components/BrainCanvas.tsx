import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Plus, Minus, Maximize2, Eye, EyeOff, Compass } from 'lucide-react';
import { MindprintNode, MindprintProfile, BrainVisualStyle } from '../types';
import {
  generateAnatomicalBrainNetwork,
  fitNodeToBrainAnatomy,
} from '../utils/brainGeometry';

interface BrainCanvasProps {
  profile: MindprintProfile;
  selectedNode: MindprintNode | null;
  onSelectNode: (node: MindprintNode | null) => void;
  activeCategory: string;
  autoRotate: boolean;
  visualStyle: BrainVisualStyle;
  resetCameraTrigger: number;
}

interface ProjectedLabel {
  id: string;
  label: string;
  isCore: boolean;
  isSelected: boolean;
  isConnected: boolean;
  isFilteredOut: boolean;
  x: number;
  y: number;
  depth: number;
  visible: boolean;
}

export const BrainCanvas: React.FC<BrainCanvasProps> = ({
  profile,
  selectedNode,
  onSelectNode,
  activeCategory,
  autoRotate,
  visualStyle,
  resetCameraTrigger,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  const brainRootRef = useRef<THREE.Group | null>(null);
  const plexusGroupRef = useRef<THREE.Group | null>(null);
  const mindprintGroupRef = useRef<THREE.Group | null>(null);
  const nodeMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const pulsePointsRef = useRef<THREE.Points | null>(null);
  const pulseCurvesRef = useRef<{ start: THREE.Vector3; end: THREE.Vector3; speed: number; offset: number }[]>([]);

  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [projectedLabels, setProjectedLabels] = useState<ProjectedLabel[]>([]);

  // Mutable refs for animation loop access without re-mounting WebGL
  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const selectedNodeRef = useRef(selectedNode);
  selectedNodeRef.current = selectedNode;
  const activeCategoryRef = useRef(activeCategory);
  activeCategoryRef.current = activeCategory;
  const onSelectNodeRef = useRef(onSelectNode);
  onSelectNodeRef.current = onSelectNode;

  // Generate the anatomical 3D human brain network once and memoize
  const brainNet = useMemo(() => generateAnatomicalBrainNetwork(), []);

  // Pre-compute anatomically fitted positions for the current profile's Mindprint nodes
  const anatomicalNodePositions = useMemo(() => {
    const map = new Map<string, THREE.Vector3>();
    profile.nodes.forEach((node) => {
      const fitted = fitNodeToBrainAnatomy(node.x, node.y, node.z);
      map.set(node.id, fitted);
    });
    return map;
  }, [profile]);

  // 1. Initialize Three.js Scene, Camera, Renderer, and Controls once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const isSoftwareGl = (() => {
      try {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera positioned to frame the iconic lateral/slightly-3/4 human brain profile
    const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 100);
    camera.position.set(-0.25, 0.15, 6.35);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.maxDistance = 12;
    controls.minDistance = 2.4;
    controls.target.set(0.05, -0.08, 0);
    controls.update();
    controlsRef.current = controls;

    // Unified Root Group that holds both the 3D Anatomical Brain Plexus AND Mindprint Nodes
    const brainRoot = new THREE.Group();
    // Slight initial angle so both the lateral brain silhouette and longitudinal depth are visible
    brainRoot.rotation.y = 0.12;
    brainRoot.rotation.x = 0.04;
    scene.add(brainRoot);
    brainRootRef.current = brainRoot;

    const plexusGroup = new THREE.Group();
    brainRoot.add(plexusGroup);
    plexusGroupRef.current = plexusGroup;

    const mindprintGroup = new THREE.Group();
    brainRoot.add(mindprintGroup);
    mindprintGroupRef.current = mindprintGroup;

    // Raycasting for clicking & hovering 3D Mindprint nodes
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let downX = 0;
    let downY = 0;

    const handlePointerDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const meshes = Array.from(nodeMeshesRef.current.values());
      const intersects = raycaster.intersectObjects(meshes, false);

      if (intersects.length > 0) {
        const hitMesh = intersects[0].object as THREE.Mesh;
        const nodeId = hitMesh.userData.nodeId;
        const found = profileRef.current.nodes.find((n) => n.id === nodeId);
        if (found) {
          onSelectNodeRef.current(found);
        }
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const meshes = Array.from(nodeMeshesRef.current.values());
      const intersects = raycaster.intersectObjects(meshes, false);

      if (intersects.length > 0) {
        const hitMesh = intersects[0].object as THREE.Mesh;
        setHoveredNodeId(hitMesh.userData.nodeId || null);
        renderer.domElement.style.cursor = 'pointer';
      } else {
        setHoveredNodeId(null);
        renderer.domElement.style.cursor = 'grab';
      }
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);
    renderer.domElement.addEventListener('pointermove', handlePointerMove);

    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Reusable vector for projecting 3D node coordinates to 2D overlay labels
    const projVec = new THREE.Vector3();
    let frameId = 0;
    const clock = new THREE.Clock();
    let labelFrameCounter = 0;

    const animate = () => {
      const delta = Math.min(clock.getDelta(), 0.1);
      const elapsed = clock.getElapsedTime();

      if (autoRotateRef.current && brainRootRef.current) {
        brainRootRef.current.rotation.y += delta * 0.14;
      }

      // Animate synaptic pulse particles traveling along active Mindprint connections
      if (pulsePointsRef.current && pulseCurvesRef.current.length > 0) {
        const posAttr = pulsePointsRef.current.geometry.getAttribute(
          'position'
        ) as THREE.BufferAttribute;
        const curves = pulseCurvesRef.current;
        for (let i = 0; i < curves.length; i++) {
          const c = curves[i];
          const t = (elapsed * c.speed + c.offset) % 1.0;
          posAttr.setXYZ(
            i,
            c.start.x + (c.end.x - c.start.x) * t,
            c.start.y + (c.end.y - c.start.y) * t,
            c.start.z + (c.end.z - c.start.z) * t
          );
        }
        posAttr.needsUpdate = true;
      }

      controls.update();
      renderer.render(scene, camera);

      // Update projected 2D coordinates for Mindprint node labels
      labelFrameCounter++;
      if (labelFrameCounter % (isSoftwareGl ? 2 : 1) === 0 && containerRef.current) {
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        const curProfile = profileRef.current;
        const selNode = selectedNodeRef.current;
        const actCat = activeCategoryRef.current;

        const nextLabels: ProjectedLabel[] = [];
        curProfile.nodes.forEach((node) => {
          const mesh = nodeMeshesRef.current.get(node.id);
          if (!mesh) return;
          mesh.getWorldPosition(projVec);
          projVec.project(camera);

          const sx = (projVec.x * 0.5 + 0.5) * w;
          const sy = (-(projVec.y * 0.5) + 0.5) * h;
          const isFilteredOut = actCat !== 'All patterns' && node.category !== actCat;
          const isSelected = selNode?.id === node.id;
          const isConnected =
            Boolean(selNode) &&
            (selNode!.connections.includes(node.id) || node.connections.includes(selNode!.id));

          nextLabels.push({
            id: node.id,
            label: node.label,
            isCore: node.significance === 'Core',
            isSelected,
            isConnected,
            isFilteredOut,
            x: sx,
            y: sy,
            depth: projVec.z,
            visible: projVec.z < 1.0 && sx > 20 && sx < w - 20 && sy > 40 && sy < h - 40,
          });
        });
        setProjectedLabels(nextLabels);
      }

      frameId = requestAnimationFrame(animate);
    };

    frameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.dispose();
      if (container) {
        container.innerHTML = '';
      }
    };
  }, []);

  // 2. Build / Update the Anatomical 3D Human Brain Plexus whenever visualStyle changes
  useEffect(() => {
    const scene = sceneRef.current;
    const plexusGroup = plexusGroupRef.current;
    if (!scene || !plexusGroup) return;

    // Clear previous plexus children
    while (plexusGroup.children.length > 0) {
      const child = plexusGroup.children[0] as THREE.Mesh | THREE.LineSegments | THREE.Points;
      plexusGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      }
    }

    const isLight = visualStyle === 'light-stencil';
    const isAdobeGlow = visualStyle === 'adobe-glow';

    // Set scene background and fog
    const bgHex = isLight ? 0xf8f9fa : 0x030304;
    scene.background = new THREE.Color(bgHex);
    scene.fog = new THREE.FogExp2(bgHex, isLight ? 0.035 : 0.045);

    // Build vertex-colored Cortical Surface Triangulated Plexus
    const coreGeo = new THREE.BufferGeometry();
    coreGeo.setAttribute('position', new THREE.BufferAttribute(brainNet.coreLinePositions, 3));

    const numVerts = brainNet.coreLineWeights.length;
    const lineColors = new Float32Array(numVerts * 3);
    const posArr = brainNet.coreLinePositions;

    for (let i = 0; i < numVerts; i++) {
      const w = brainNet.coreLineWeights[i];
      const py = posArr[i * 3 + 1];
      const pz = posArr[i * 3 + 2];
      // Subtle depth & gyri shading so the temporal lobe, Sylvian fissure, and cerebellum folds stand out
      const depthShade = 0.55 + 0.45 * Math.min(1, Math.max(0, (Math.abs(pz) + 0.35) / 1.35));
      const lum = w * depthShade;

      if (isLight) {
        // Ink on white background (matches Adobe Stock #268829311)
        const ink = Math.max(0.08, 0.52 - lum * 0.42);
        lineColors[i * 3] = ink * 0.92;
        lineColors[i * 3 + 1] = ink * 0.96;
        lineColors[i * 3 + 2] = ink * 1.05;
      } else if (isAdobeGlow) {
        // Warm Ivory Core + Cyan Rim (matches Adobe Stock #464881935)
        const rim = Math.max(0, Math.min(1, (py + 0.9) * 0.35));
        lineColors[i * 3] = Math.min(1, lum * 1.15);
        lineColors[i * 3 + 1] = Math.min(1, lum * (0.96 + rim * 0.08));
        lineColors[i * 3 + 2] = Math.min(1, lum * (0.76 + rim * 0.32));
      } else {
        // Pure Black & White Stencil
        const bw = Math.min(1, lum * 1.12);
        lineColors[i * 3] = bw;
        lineColors[i * 3 + 1] = bw;
        lineColors[i * 3 + 2] = bw;
      }
    }

    coreGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));

    const coreLineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: isLight ? 0.44 : 0.48,
      blending: isLight ? THREE.NormalBlending : THREE.AdditiveBlending,
      depthWrite: false,
    });
    const coreLinesMesh = new THREE.LineSegments(coreGeo, coreLineMat);
    plexusGroup.add(coreLinesMesh);

    // Internal White-Matter Tract Filaments
    const innerGeo = new THREE.BufferGeometry();
    innerGeo.setAttribute('position', new THREE.BufferAttribute(brainNet.innerLinePositions, 3));
    const innerMat = new THREE.LineBasicMaterial({
      color: isLight ? 0x334155 : isAdobeGlow ? 0xfde68a : 0xd4d4d8,
      transparent: true,
      opacity: isLight ? 0.20 : 0.18,
      blending: isLight ? THREE.NormalBlending : THREE.AdditiveBlending,
      depthWrite: false,
    });
    const innerLinesMesh = new THREE.LineSegments(innerGeo, innerMat);
    plexusGroup.add(innerLinesMesh);

    // Outer Halo Synaptic Tendrils (Triangulated struts around the brain perimeter)
    const haloLineGeo = new THREE.BufferGeometry();
    haloLineGeo.setAttribute('position', new THREE.BufferAttribute(brainNet.haloLinePositions, 3));
    const haloLineMat = new THREE.LineBasicMaterial({
      color: isLight ? 0x64748b : isAdobeGlow ? 0x38bdf8 : 0x71717a,
      transparent: true,
      opacity: isLight ? 0.22 : isAdobeGlow ? 0.28 : 0.22,
      blending: isLight ? THREE.NormalBlending : THREE.AdditiveBlending,
      depthWrite: false,
    });
    const haloLinesMesh = new THREE.LineSegments(haloLineGeo, haloLineMat);
    plexusGroup.add(haloLinesMesh);

    // Cortical Surface Pinpoint Vertices
    const surfPtGeo = new THREE.BufferGeometry();
    surfPtGeo.setAttribute('position', new THREE.BufferAttribute(brainNet.surfacePositions, 3));
    const surfPtMat = new THREE.PointsMaterial({
      color: isLight ? 0x1e293b : isAdobeGlow ? 0xfef3c7 : 0xffffff,
      size: isLight ? 0.024 : 0.028,
      transparent: true,
      opacity: isLight ? 0.65 : 0.78,
      blending: isLight ? THREE.NormalBlending : THREE.AdditiveBlending,
      depthWrite: false,
    });
    const surfPoints = new THREE.Points(surfPtGeo, surfPtMat);
    plexusGroup.add(surfPoints);

    // Outer Halo Floating Synaptic Vertices
    const haloPtGeo = new THREE.BufferGeometry();
    haloPtGeo.setAttribute('position', new THREE.BufferAttribute(brainNet.haloPositions, 3));
    const haloPtMat = new THREE.PointsMaterial({
      color: isLight ? 0x475569 : isAdobeGlow ? 0x7dd3fc : 0xa1a1aa,
      size: 0.032,
      transparent: true,
      opacity: isLight ? 0.48 : 0.62,
      blending: isLight ? THREE.NormalBlending : THREE.AdditiveBlending,
      depthWrite: false,
    });
    const haloPoints = new THREE.Points(haloPtGeo, haloPtMat);
    plexusGroup.add(haloPoints);
  }, [brainNet, visualStyle]);

  // 3. Build / Update Interactive Mindprint Nodes & Synaptic Pathways inside brainRoot
  useEffect(() => {
    const mindprintGroup = mindprintGroupRef.current;
    if (!mindprintGroup) return;

    while (mindprintGroup.children.length > 0) {
      const child = mindprintGroup.children[0] as THREE.Object3D & {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material | THREE.Material[];
      };
      mindprintGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      }
    }
    nodeMeshesRef.current.clear();
    pulseCurvesRef.current = [];
    pulsePointsRef.current = null;

    const isLight = visualStyle === 'light-stencil';

    // Create 3D Mindprint Node Spheres & Rings
    profile.nodes.forEach((node) => {
      const pos = anatomicalNodePositions.get(node.id) || new THREE.Vector3(node.x, node.y, node.z);
      const isCore = node.significance === 'Core';
      const isSelected = selectedNode?.id === node.id;
      const isHovered = hoveredNodeId === node.id;
      const isConnected =
        Boolean(selectedNode) &&
        (selectedNode!.connections.includes(node.id) ||
          node.connections.includes(selectedNode!.id));
      const isFilteredOut =
        activeCategory !== 'All patterns' && node.category !== activeCategory && !isCore;

      const radius = isCore ? 0.095 : isSelected || isHovered ? 0.075 : 0.052;
      const sphereGeo = new THREE.SphereGeometry(radius, 20, 20);
      const sphereMat = new THREE.MeshBasicMaterial({
        color: isLight
          ? isSelected || isCore
            ? 0x000000
            : 0x1e293b
          : isSelected || isHovered || isCore
          ? 0xffffff
          : isConnected
          ? 0xe4e4e7
          : 0xd4d4d8,
        transparent: true,
        opacity: isFilteredOut ? 0.18 : 1.0,
      });

      const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
      sphereMesh.position.copy(pos);
      sphereMesh.userData = { nodeId: node.id };
      mindprintGroup.add(sphereMesh);
      nodeMeshesRef.current.set(node.id, sphereMesh);

      // Add outer stencil ring for Core hub and Selected nodes (matches Screenshot 1 "Thinking Core")
      if ((isCore || isSelected || isHovered) && !isFilteredOut) {
        const ringGeo = new THREE.RingGeometry(radius * 1.45, radius * 1.75, 32);
        const ringMat = new THREE.MeshBasicMaterial({
          color: isLight ? 0x000000 : 0xffffff,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: isSelected || isCore ? 0.95 : 0.65,
        });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.position.copy(pos);
        mindprintGroup.add(ringMesh);
      }
    });

    // Create Synaptic Pathways between Mindprint Nodes (Solid + Dashed stencil lines)
    const drawnPairs = new Set<string>();
    const pulseStarts: number[] = [];

    profile.nodes.forEach((node) => {
      const startPos = anatomicalNodePositions.get(node.id);
      if (!startPos) return;

      node.connections.forEach((targetId) => {
        const pairKey = [node.id, targetId].sort().join('--');
        if (drawnPairs.has(pairKey)) return;
        drawnPairs.add(pairKey);

        const endPos = anatomicalNodePositions.get(targetId);
        if (!endPos) return;

        const targetNode = profile.nodes.find((n) => n.id === targetId);
        const isCoreLink =
          node.significance === 'Core' || targetNode?.significance === 'Core';
        const isHighlighted =
          selectedNode && (selectedNode.id === node.id || selectedNode.id === targetId);
        const isHoveredLink =
          hoveredNodeId && (hoveredNodeId === node.id || hoveredNodeId === targetId);

        const lineGeo = new THREE.BufferGeometry().setFromPoints([startPos, endPos]);

        if (isCoreLink && !isHighlighted) {
          // Dashed line from Thinking Core hub (matches Screenshot 1)
          const dashMat = new THREE.LineDashedMaterial({
            color: isLight ? 0x0f172a : 0xffffff,
            dashSize: 0.08,
            gapSize: 0.05,
            transparent: true,
            opacity: selectedNode ? 0.25 : 0.55,
          });
          const line = new THREE.Line(lineGeo, dashMat);
          line.computeLineDistances();
          mindprintGroup.add(line);
        } else {
          const solidMat = new THREE.LineBasicMaterial({
            color: isLight
              ? isHighlighted || isHoveredLink
                ? 0x000000
                : 0x475569
              : isHighlighted || isHoveredLink
              ? 0xffffff
              : 0xa1a1aa,
            transparent: true,
            opacity: isHighlighted || isHoveredLink ? 0.95 : selectedNode ? 0.16 : 0.42,
          });
          const line = new THREE.Line(lineGeo, solidMat);
          mindprintGroup.add(line);
        }

        // Register animated synaptic signal pulses along active pathways
        if (isHighlighted || isHoveredLink || (!selectedNode && isCoreLink)) {
          pulseCurvesRef.current.push({
            start: startPos,
            end: endPos,
            speed: 0.45 + (pulseCurvesRef.current.length % 5) * 0.08,
            offset: (pulseCurvesRef.current.length * 0.23) % 1.0,
          });
          pulseStarts.push(startPos.x, startPos.y, startPos.z);
        }
      });
    });

    if (pulseStarts.length > 0) {
      const pulseGeo = new THREE.BufferGeometry();
      pulseGeo.setAttribute('position', new THREE.Float32BufferAttribute(pulseStarts, 3));
      const pulseMat = new THREE.PointsMaterial({
        color: isLight ? 0x000000 : 0xffffff,
        size: 0.065,
        transparent: true,
        opacity: 0.95,
      });
      const pulsePoints = new THREE.Points(pulseGeo, pulseMat);
      mindprintGroup.add(pulsePoints);
      pulsePointsRef.current = pulsePoints;
    }
  }, [profile, anatomicalNodePositions, activeCategory, selectedNode, hoveredNodeId, visualStyle]);

  // 4. Camera controls: Zoom / Fit Graph / Reset
  useEffect(() => {
    if (!cameraRef.current || !controlsRef.current || !brainRootRef.current) return;
    if (resetCameraTrigger > 0) {
      cameraRef.current.position.set(-0.25, 0.15, 6.35);
      controlsRef.current.target.set(0.05, -0.08, 0);
      brainRootRef.current.rotation.set(0.04, 0.12, 0);
      controlsRef.current.update();
    }
  }, [resetCameraTrigger]);

  const handleZoom = (factor: number) => {
    if (!cameraRef.current || !controlsRef.current) return;
    const dir = new THREE.Vector3()
      .subVectors(cameraRef.current.position, controlsRef.current.target)
      .multiplyScalar(factor);
    const dist = dir.length();
    if (dist >= 2.4 && dist <= 12) {
      cameraRef.current.position.copy(controlsRef.current.target).add(dir);
      controlsRef.current.update();
    }
  };

  const handleFitGraph = () => {
    if (!cameraRef.current || !controlsRef.current || !brainRootRef.current) return;
    onSelectNode(null);
    cameraRef.current.position.set(-0.25, 0.15, 6.35);
    controlsRef.current.target.set(0.05, -0.08, 0);
    brainRootRef.current.rotation.set(0.04, 0.12, 0);
    controlsRef.current.update();
  };

  const setCameraPreset = (preset: 'lateral' | 'three-quarter' | 'superior') => {
    if (!cameraRef.current || !controlsRef.current || !brainRootRef.current) return;
    controlsRef.current.target.set(0.05, -0.08, 0);
    if (preset === 'lateral') {
      // Exact side profile matching the Adobe Stock reference images
      cameraRef.current.position.set(0, 0.05, 6.3);
      brainRootRef.current.rotation.set(0, 0, 0);
    } else if (preset === 'three-quarter') {
      cameraRef.current.position.set(-0.6, 0.35, 6.1);
      brainRootRef.current.rotation.set(0.06, 0.42, 0);
    } else if (preset === 'superior') {
      // Top view showing Left & Right Cerebral Hemispheres and Longitudinal Fissure
      cameraRef.current.position.set(0, 6.2, 0.8);
      brainRootRef.current.rotation.set(0, 0, 0);
    }
    controlsRef.current.update();
  };

  const isLight = visualStyle === 'light-stencil';

  return (
    <div className="relative w-full h-full overflow-hidden select-none">
      {/* Dedicated WebGL Mount Container */}
      <div
        ref={containerRef}
        className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing"
      />

      {/* Top-Left Mindprint Graph Toolbar (+ / - / Fit graph / View Angles / Labels toggle) */}
      <div className="absolute top-3 left-3 z-20 flex flex-wrap items-center gap-1.5 font-mono">
        <button
          onClick={() => handleZoom(0.84)}
          title="Zoom In"
          className={`w-8 h-8 flex items-center justify-center border text-xs transition-colors ${
            isLight
              ? 'bg-white/90 border-zinc-300 text-zinc-900 hover:bg-zinc-100'
              : 'bg-zinc-950/90 border-white/15 text-zinc-200 hover:border-white/50 hover:text-white'
          }`}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => handleZoom(1.18)}
          title="Zoom Out"
          className={`w-8 h-8 flex items-center justify-center border text-xs transition-colors ${
            isLight
              ? 'bg-white/90 border-zinc-300 text-zinc-900 hover:bg-zinc-100'
              : 'bg-zinc-950/90 border-white/15 text-zinc-200 hover:border-white/50 hover:text-white'
          }`}
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleFitGraph}
          className={`px-3 h-8 flex items-center space-x-1.5 border text-xs transition-colors ${
            isLight
              ? 'bg-white/90 border-zinc-300 text-zinc-900 hover:bg-zinc-100'
              : 'bg-zinc-950/90 border-white/15 text-zinc-200 hover:border-white/50 hover:text-white'
          }`}
        >
          <Maximize2 className="w-3.5 h-3.5" />
          <span>Fit graph</span>
        </button>

        {/* Camera Angle Quick Presets */}
        <div
          className={`hidden sm:flex items-center border h-8 px-1 space-x-1 ${
            isLight ? 'bg-white/90 border-zinc-300' : 'bg-zinc-950/90 border-white/15'
          }`}
        >
          <Compass className={`w-3.5 h-3.5 mx-1 ${isLight ? 'text-zinc-500' : 'text-zinc-400'}`} />
          <button
            onClick={() => setCameraPreset('lateral')}
            className={`px-2 py-0.5 text-[11px] transition-colors ${
              isLight
                ? 'text-zinc-700 hover:bg-zinc-200'
                : 'text-zinc-300 hover:bg-white/10 hover:text-white'
            }`}
          >
            Side Profile
          </button>
          <button
            onClick={() => setCameraPreset('three-quarter')}
            className={`px-2 py-0.5 text-[11px] transition-colors ${
              isLight
                ? 'text-zinc-700 hover:bg-zinc-200'
                : 'text-zinc-300 hover:bg-white/10 hover:text-white'
            }`}
          >
            3D Oblique
          </button>
          <button
            onClick={() => setCameraPreset('superior')}
            className={`px-2 py-0.5 text-[11px] transition-colors ${
              isLight
                ? 'text-zinc-700 hover:bg-zinc-200'
                : 'text-zinc-300 hover:bg-white/10 hover:text-white'
            }`}
          >
            Hemispheres
          </button>
        </div>

        <button
          onClick={() => setShowLabels(!showLabels)}
          className={`px-2.5 h-8 flex items-center space-x-1.5 border text-xs transition-colors ${
            isLight
              ? 'bg-white/90 border-zinc-300 text-zinc-900 hover:bg-zinc-100'
              : 'bg-zinc-950/90 border-white/15 text-zinc-200 hover:border-white/50 hover:text-white'
          }`}
        >
          {showLabels ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          <span className="hidden md:inline">{showLabels ? 'Node Labels' : 'Pure Brain'}</span>
        </button>
      </div>

      {/* Projected 3D Mindprint Node Labels & Interactive Target Rings (Matches Screenshot 1) */}
      {showLabels && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
          {projectedLabels.map((lbl) => {
            if (!lbl.visible) return null;
            const nodeObj = profile.nodes.find((n) => n.id === lbl.id);
            if (!nodeObj) return null;

            return (
              <div
                key={lbl.id}
                style={{
                  transform: `translate3d(${lbl.x}px, ${lbl.y}px, 0)`,
                }}
                className={`absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 pointer-events-auto cursor-pointer group transition-opacity duration-150 ${
                  lbl.isFilteredOut ? 'opacity-20' : 'opacity-100'
                }`}
                onClick={() => onSelectNode(nodeObj)}
                onMouseEnter={() => setHoveredNodeId(lbl.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
              >
                {lbl.isCore ? (
                  /* Iconic Double-Ring "Thinking Core" Marker from Mindprint Screenshot */
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-transform group-hover:scale-110 ${
                        isLight
                          ? 'border-black bg-white/80 shadow-md'
                          : 'border-white bg-black/75 shadow-[0_0_16px_rgba(255,255,255,0.45)]'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded-full border ${
                          isLight ? 'border-black bg-black/10' : 'border-white bg-white/15'
                        }`}
                      />
                    </div>
                    <span
                      className={`mt-1 px-1.5 py-0.5 text-xs font-mono font-bold tracking-tight whitespace-nowrap ${
                        isLight
                          ? 'text-black bg-white/85 border border-black/20'
                          : 'text-white bg-black/80 border border-white/20'
                      }`}
                    >
                      {lbl.label}
                    </span>
                  </div>
                ) : (
                  /* Standard Mindprint Pattern Node + Stencil Label */
                  <div className="flex flex-col items-center">
                    <span
                      className={`mb-1.5 px-1.5 py-0.5 text-[11px] font-mono tracking-tight whitespace-nowrap transition-all ${
                        lbl.isSelected
                          ? isLight
                            ? 'bg-black text-white font-bold shadow-md scale-105'
                            : 'bg-white text-black font-bold shadow-[0_0_12px_rgba(255,255,255,0.6)] scale-105'
                          : lbl.isConnected
                          ? isLight
                            ? 'bg-white/95 text-black font-semibold border border-black/30'
                            : 'bg-black/85 text-white font-semibold border border-white/30'
                          : isLight
                          ? 'text-zinc-800 bg-white/75 group-hover:bg-black group-hover:text-white'
                          : 'text-zinc-300 bg-black/65 group-hover:bg-white group-hover:text-black'
                      }`}
                    >
                      {lbl.label}
                    </span>
                    <div
                      className={`w-2.5 h-2.5 rounded-full border transition-transform group-hover:scale-125 ${
                        lbl.isSelected
                          ? isLight
                            ? 'bg-black border-white scale-125'
                            : 'bg-white border-black scale-125 shadow-[0_0_10px_#fff]'
                          : isLight
                          ? 'bg-zinc-900 border-white'
                          : 'bg-zinc-200 border-black'
                      }`}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
