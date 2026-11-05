import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Plus, Minus, Maximize2, Eye, EyeOff, Compass, Activity } from 'lucide-react';
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
  heatmapMode?: boolean;
  onToggleHeatmap?: () => void;
}

interface ProjectedLabel {
  id: string;
  label: string;
  isCore: boolean;
  isSelected: boolean;
  isConnected: boolean;
  isFilteredOut: boolean;
  activityScore: number; // 0..1 normalized neural activity
  x: number;
  y: number;
  depth: number;
  visible: boolean;
}

/**
 * Evaluates the fMRI / Thermal Heatmap RGB color blended over the Black & White Stencil base.
 * Low intensity (< 0.12) preserves the crisp monochrome stencil look;
 * Higher intensities transition smoothly through Cyan -> Emerald -> Amber -> Crimson/White-Hot.
 */
function sampleStencilHeatmapColor(
  intensity: number,
  baseStencilLum: number,
  isLightMode: boolean,
  outColor: THREE.Color
): void {
  const t = Math.max(0, Math.min(1, intensity));

  // Base monochrome stencil RGB
  const baseVal = isLightMode
    ? Math.max(0.08, 0.54 - baseStencilLum * 0.42)
    : Math.min(1.0, baseStencilLum * 0.85);

  if (t < 0.10) {
    outColor.setRGB(baseVal, baseVal, baseVal);
    return;
  }

  // Normalize active range [0.10 .. 1.0] -> [0 .. 1]
  const u = (t - 0.10) / 0.90;
  let hr = 0;
  let hg = 0;
  let hb = 0;

  if (u < 0.28) {
    // Deep Electric Blue / Cyan (#0284c7 -> #06b6d4)
    const k = u / 0.28;
    hr = 0.01 + k * 0.03;
    hg = 0.52 + k * 0.20;
    hb = 0.78 + k * 0.18;
  } else if (u < 0.55) {
    // Cyan to Bio-Emerald / Lime (#06b6d4 -> #22c55e)
    const k = (u - 0.28) / 0.27;
    hr = 0.04 + k * 0.20;
    hg = 0.72 + k * 0.18;
    hb = 0.96 - k * 0.62;
  } else if (u < 0.80) {
    // Emerald to Radiant Amber / Orange (#22c55e -> #f59e0b -> #f97316)
    const k = (u - 0.55) / 0.25;
    hr = 0.24 + k * 0.74;
    hg = 0.90 - k * 0.32;
    hb = 0.34 - k * 0.26;
  } else {
    // Orange to Peak Crimson / White-Hot Core (#f97316 -> #ef4444 -> #fecdd3)
    const k = (u - 0.80) / 0.20;
    hr = 0.98 + k * 0.02;
    hg = 0.58 - k * 0.36 + (k > 0.7 ? (k - 0.7) * 1.4 : 0);
    hb = 0.08 + k * 0.28 + (k > 0.7 ? (k - 0.7) * 1.6 : 0);
  }

  // Blend smoothly from base stencil into heatmap color
  const blend = Math.min(1, u * 1.35);
  const boost = isLightMode ? 0.88 : 1.0 + u * 0.25;
  outColor.setRGB(
    Math.min(1, (baseVal * (1 - blend) + hr * blend) * boost),
    Math.min(1, (baseVal * (1 - blend) + hg * blend) * boost),
    Math.min(1, (baseVal * (1 - blend) + hb * blend) * boost)
  );
}

export const BrainCanvas: React.FC<BrainCanvasProps> = ({
  profile,
  selectedNode,
  onSelectNode,
  activeCategory,
  autoRotate,
  visualStyle,
  resetCameraTrigger,
  heatmapMode: externalHeatmapMode,
  onToggleHeatmap,
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
  const pulseCurvesRef = useRef<
    { start: THREE.Vector3; end: THREE.Vector3; speed: number; offset: number }[]
  >([]);

  const [internalHeatmap, setInternalHeatmap] = useState<boolean>(false);
  const isHeatmapActive =
    externalHeatmapMode !== undefined ? externalHeatmapMode : internalHeatmap;

  const handleToggleHeatmap = () => {
    if (onToggleHeatmap) {
      onToggleHeatmap();
    } else {
      setInternalHeatmap((prev) => !prev);
    }
  };

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

  // Pre-compute anatomically fitted positions and normalized neural activity scores for the profile's nodes
  const { anatomicalNodePositions, nodeActivityMap, neuralSources, peakNode } = useMemo(() => {
    const posMap = new Map<string, THREE.Vector3>();
    const actMap = new Map<string, number>();

    const maxCitations = Math.max(1, ...profile.nodes.map((n) => n.citations || 1));
    const maxConn = Math.max(1, ...profile.nodes.map((n) => n.connections.length || 1));

    const sources: {
      id: string;
      pos: THREE.Vector3;
      weight: number;
      invTwoSigmaSq: number;
    }[] = [];

    let highestScore = -1;
    let topNode: MindprintNode | null = null;

    profile.nodes.forEach((node) => {
      const fitted = fitNodeToBrainAnatomy(node.x, node.y, node.z);
      posMap.set(node.id, fitted);

      const citNorm = (node.citations || 1) / maxCitations;
      const connNorm = node.connections.length / maxConn;
      const sigBonus =
        node.significance === 'Core' ? 0.30 : node.significance === 'High' ? 0.18 : 0.05;

      const rawScore = Math.min(1.0, Math.max(0.18, citNorm * 0.55 + connNorm * 0.25 + sigBonus));
      actMap.set(node.id, rawScore);

      if (rawScore > highestScore) {
        highestScore = rawScore;
        topNode = node;
      }

      // Filter & selection modulation for the 3D spatial cortical heatmap
      const isFilteredOut =
        activeCategory !== 'All patterns' &&
        node.category !== activeCategory &&
        node.significance !== 'Core';
      const isSelected = selectedNode?.id === node.id;
      const isConnectedToSelected =
        Boolean(selectedNode) &&
        (selectedNode!.connections.includes(node.id) ||
          node.connections.includes(selectedNode!.id));

      let effectiveWeight = rawScore;
      if (isFilteredOut) {
        effectiveWeight *= 0.15;
      } else if (selectedNode) {
        effectiveWeight *= isSelected ? 1.35 : isConnectedToSelected ? 1.12 : 0.45;
      }

      const sigma =
        node.significance === 'Core'
          ? 0.68
          : node.significance === 'High'
          ? 0.56
          : 0.46;

      sources.push({
        id: node.id,
        pos: fitted,
        weight: effectiveWeight,
        invTwoSigmaSq: 1.0 / (2.0 * sigma * sigma),
      });
    });

    return {
      anatomicalNodePositions: posMap,
      nodeActivityMap: actMap,
      neuralSources: sources,
      peakNode: topNode as MindprintNode | null,
    };
  }, [profile, activeCategory, selectedNode]);

  // Helper to evaluate neural heatmap intensity at any 3D brain coordinate (x, y, z)
  const evaluateNeuralHeatAtPoint = useMemo(() => {
    return (x: number, y: number, z: number): number => {
      let sum = 0;
      for (let i = 0; i < neuralSources.length; i++) {
        const s = neuralSources[i];
        const dx = x - s.pos.x;
        const dy = y - s.pos.y;
        const dz = z - s.pos.z;
        const dSq = dx * dx + dy * dy + dz * dz;
        if (dSq < 1.8) {
          sum += s.weight * Math.exp(-dSq * s.invTwoSigmaSq);
        }
      }
      // Soft saturation curve so overlapping hotspots reach 1.0 smoothly
      return Math.min(1.0, sum * 0.78);
    };
  }, [neuralSources]);

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
            activityScore: mesh.userData.activityScore ?? 0.5,
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

  // 2. Build / Update the Anatomical 3D Human Brain Plexus (with Heatmap Overlay support)
  useEffect(() => {
    const scene = sceneRef.current;
    const plexusGroup = plexusGroupRef.current;
    if (!scene || !plexusGroup) return;

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

    const bgHex = isLight ? 0xf8f9fa : 0x030304;
    scene.background = new THREE.Color(bgHex);
    scene.fog = new THREE.FogExp2(bgHex, isLight ? 0.035 : 0.045);

    const tmpColor = new THREE.Color();

    const activeFocusId = hoveredNodeId || selectedNode?.id || null;
    const activeFocusPos = activeFocusId
      ? anatomicalNodePositions.get(activeFocusId) || null
      : null;

    // 2A. Cortical Surface Triangulated Plexus Lines
    const coreGeo = new THREE.BufferGeometry();
    coreGeo.setAttribute('position', new THREE.BufferAttribute(brainNet.coreLinePositions, 3));

    const numVerts = brainNet.coreLineWeights.length;
    const lineColors = new Float32Array(numVerts * 3);
    const posArr = brainNet.coreLinePositions;

    for (let i = 0; i < numVerts; i++) {
      const w = brainNet.coreLineWeights[i];
      const px = posArr[i * 3];
      const py = posArr[i * 3 + 1];
      const pz = posArr[i * 3 + 2];
      const depthShade = 0.55 + 0.45 * Math.min(1, Math.max(0, (Math.abs(pz) + 0.35) / 1.35));
      const lum = w * depthShade;

      if (isHeatmapActive) {
        const heat = evaluateNeuralHeatAtPoint(px, py, pz);
        sampleStencilHeatmapColor(heat, lum, isLight, tmpColor);
        lineColors[i * 3] = tmpColor.r;
        lineColors[i * 3 + 1] = tmpColor.g;
        lineColors[i * 3 + 2] = tmpColor.b;
      } else if (isLight) {
        const ink = Math.max(0.08, 0.52 - lum * 0.42);
        lineColors[i * 3] = ink * 0.92;
        lineColors[i * 3 + 1] = ink * 0.96;
        lineColors[i * 3 + 2] = ink * 1.05;
      } else if (isAdobeGlow) {
        const rim = Math.max(0, Math.min(1, (py + 0.9) * 0.35));
        lineColors[i * 3] = Math.min(1, lum * 1.15);
        lineColors[i * 3 + 1] = Math.min(1, lum * (0.96 + rim * 0.08));
        lineColors[i * 3 + 2] = Math.min(1, lum * (0.76 + rim * 0.32));
      } else {
        const bw = Math.min(1, lum * 1.12);
        lineColors[i * 3] = bw;
        lineColors[i * 3 + 1] = bw;
        lineColors[i * 3 + 2] = bw;
      }

      // Highlight the 3D cortical brain area around the hovered/selected node in Burnt Orange (#ea580c)
      if (activeFocusPos) {
        const dx = px - activeFocusPos.x;
        const dy = py - activeFocusPos.y;
        const dz = pz - activeFocusPos.z;
        const dSq = dx * dx + dy * dy + dz * dz;
        if (dSq < 0.32) {
          const falloff = 1.0 - Math.sqrt(dSq) / 0.565;
          const bBlend = Math.min(1, falloff * 1.35);
          // Burnt Orange RGB: (0.92, 0.35, 0.05)
          lineColors[i * 3] = lineColors[i * 3] * (1 - bBlend) + 0.95 * bBlend;
          lineColors[i * 3 + 1] = lineColors[i * 3 + 1] * (1 - bBlend) + 0.36 * bBlend;
          lineColors[i * 3 + 2] = lineColors[i * 3 + 2] * (1 - bBlend) + 0.05 * bBlend;
        }
      }
    }

    coreGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));

    const coreLineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: isHeatmapActive ? (isLight ? 0.62 : 0.68) : isLight ? 0.44 : 0.48,
      blending: isLight ? THREE.NormalBlending : THREE.AdditiveBlending,
      depthWrite: false,
    });
    const coreLinesMesh = new THREE.LineSegments(coreGeo, coreLineMat);
    plexusGroup.add(coreLinesMesh);

    // 2B. Internal White-Matter Tract Filaments
    const innerGeo = new THREE.BufferGeometry();
    innerGeo.setAttribute('position', new THREE.BufferAttribute(brainNet.innerLinePositions, 3));

    if (isHeatmapActive) {
      const innerCount = brainNet.innerLinePositions.length / 3;
      const innerColors = new Float32Array(innerCount * 3);
      const inArr = brainNet.innerLinePositions;
      for (let i = 0; i < innerCount; i++) {
        const heat = evaluateNeuralHeatAtPoint(
          inArr[i * 3],
          inArr[i * 3 + 1],
          inArr[i * 3 + 2]
        );
        sampleStencilHeatmapColor(heat, 0.45, isLight, tmpColor);
        innerColors[i * 3] = tmpColor.r;
        innerColors[i * 3 + 1] = tmpColor.g;
        innerColors[i * 3 + 2] = tmpColor.b;
      }
      innerGeo.setAttribute('color', new THREE.BufferAttribute(innerColors, 3));
    }

    const innerMat = new THREE.LineBasicMaterial({
      vertexColors: isHeatmapActive,
      color: isHeatmapActive
        ? 0xffffff
        : isLight
        ? 0x334155
        : isAdobeGlow
        ? 0xfde68a
        : 0xd4d4d8,
      transparent: true,
      opacity: isHeatmapActive ? 0.34 : isLight ? 0.20 : 0.18,
      blending: isLight ? THREE.NormalBlending : THREE.AdditiveBlending,
      depthWrite: false,
    });
    const innerLinesMesh = new THREE.LineSegments(innerGeo, innerMat);
    plexusGroup.add(innerLinesMesh);

    // 2C. Outer Halo Synaptic Tendrils
    const haloLineGeo = new THREE.BufferGeometry();
    haloLineGeo.setAttribute('position', new THREE.BufferAttribute(brainNet.haloLinePositions, 3));

    if (isHeatmapActive) {
      const haloLineCount = brainNet.haloLinePositions.length / 3;
      const haloLineColors = new Float32Array(haloLineCount * 3);
      const hArr = brainNet.haloLinePositions;
      for (let i = 0; i < haloLineCount; i++) {
        const heat = evaluateNeuralHeatAtPoint(
          hArr[i * 3],
          hArr[i * 3 + 1],
          hArr[i * 3 + 2]
        );
        sampleStencilHeatmapColor(heat * 0.85, 0.38, isLight, tmpColor);
        haloLineColors[i * 3] = tmpColor.r;
        haloLineColors[i * 3 + 1] = tmpColor.g;
        haloLineColors[i * 3 + 2] = tmpColor.b;
      }
      haloLineGeo.setAttribute('color', new THREE.BufferAttribute(haloLineColors, 3));
    }

    const haloLineMat = new THREE.LineBasicMaterial({
      vertexColors: isHeatmapActive,
      color: isHeatmapActive
        ? 0xffffff
        : isLight
        ? 0x64748b
        : isAdobeGlow
        ? 0x38bdf8
        : 0x71717a,
      transparent: true,
      opacity: isHeatmapActive ? 0.32 : isLight ? 0.22 : isAdobeGlow ? 0.28 : 0.22,
      blending: isLight ? THREE.NormalBlending : THREE.AdditiveBlending,
      depthWrite: false,
    });
    const haloLinesMesh = new THREE.LineSegments(haloLineGeo, haloLineMat);
    plexusGroup.add(haloLinesMesh);

    // 2D. Cortical Surface Pinpoint Vertices
    const surfPtGeo = new THREE.BufferGeometry();
    surfPtGeo.setAttribute('position', new THREE.BufferAttribute(brainNet.surfacePositions, 3));

    if (isHeatmapActive || activeFocusPos) {
      const surfCount = brainNet.surfacePositions.length / 3;
      const surfColors = new Float32Array(surfCount * 3);
      const sArr = brainNet.surfacePositions;
      for (let i = 0; i < surfCount; i++) {
        const sx = sArr[i * 3];
        const sy = sArr[i * 3 + 1];
        const sz = sArr[i * 3 + 2];

        if (isHeatmapActive) {
          const heat = evaluateNeuralHeatAtPoint(sx, sy, sz);
          sampleStencilHeatmapColor(heat, 0.75, isLight, tmpColor);
          surfColors[i * 3] = tmpColor.r;
          surfColors[i * 3 + 1] = tmpColor.g;
          surfColors[i * 3 + 2] = tmpColor.b;
        } else {
          const baseC = isLight ? 0.15 : 0.92;
          surfColors[i * 3] = baseC;
          surfColors[i * 3 + 1] = baseC;
          surfColors[i * 3 + 2] = baseC;
        }

        if (activeFocusPos) {
          const dx = sx - activeFocusPos.x;
          const dy = sy - activeFocusPos.y;
          const dz = sz - activeFocusPos.z;
          const dSq = dx * dx + dy * dy + dz * dz;
          if (dSq < 0.32) {
            const falloff = 1.0 - Math.sqrt(dSq) / 0.565;
            const bBlend = Math.min(1, falloff * 1.45);
            surfColors[i * 3] = surfColors[i * 3] * (1 - bBlend) + 0.96 * bBlend;
            surfColors[i * 3 + 1] = surfColors[i * 3 + 1] * (1 - bBlend) + 0.38 * bBlend;
            surfColors[i * 3 + 2] = surfColors[i * 3 + 2] * (1 - bBlend) + 0.06 * bBlend;
          }
        }
      }
      surfPtGeo.setAttribute('color', new THREE.BufferAttribute(surfColors, 3));
    }

    const surfPtMat = new THREE.PointsMaterial({
      vertexColors: Boolean(isHeatmapActive || activeFocusPos),
      color:
        isHeatmapActive || activeFocusPos
          ? 0xffffff
          : isLight
          ? 0x1e293b
          : isAdobeGlow
          ? 0xfef3c7
          : 0xffffff,
      size: isHeatmapActive ? 0.035 : isLight ? 0.024 : 0.028,
      transparent: true,
      opacity: isHeatmapActive ? 0.92 : isLight ? 0.65 : 0.78,
      blending: isLight ? THREE.NormalBlending : THREE.AdditiveBlending,
      depthWrite: false,
    });
    const surfPoints = new THREE.Points(surfPtGeo, surfPtMat);
    plexusGroup.add(surfPoints);

    // 2E. Outer Halo Floating Synaptic Vertices
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
  }, [
    brainNet,
    visualStyle,
    isHeatmapActive,
    evaluateNeuralHeatAtPoint,
    hoveredNodeId,
    selectedNode,
    anatomicalNodePositions,
  ]);

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
    const heatColor = new THREE.Color();
    const BURNT_ORANGE_HEX = 0xea580c;

    // Create 3D Mindprint Node Spheres & Rings
    profile.nodes.forEach((node) => {
      const pos = anatomicalNodePositions.get(node.id) || new THREE.Vector3(node.x, node.y, node.z);
      const activityScore = nodeActivityMap.get(node.id) ?? 0.5;
      const isCore = node.significance === 'Core';
      const isSelected = selectedNode?.id === node.id;
      const isHovered = hoveredNodeId === node.id;
      const isActiveTarget = isSelected || isHovered;
      const isConnected =
        Boolean(selectedNode) &&
        (selectedNode!.connections.includes(node.id) ||
          node.connections.includes(selectedNode!.id));
      const isFilteredOut =
        activeCategory !== 'All patterns' && node.category !== activeCategory && !isCore;

      const radius = isCore ? 0.095 : isActiveTarget ? 0.082 : 0.052;
      const sphereGeo = new THREE.SphereGeometry(radius, 20, 20);

      let nodeHex = isActiveTarget
        ? BURNT_ORANGE_HEX
        : isLight
        ? isCore
          ? 0x000000
          : 0x1e293b
        : isCore
        ? 0xffffff
        : isConnected
        ? 0xfdba74
        : 0xd4d4d8;

      if (isHeatmapActive && !isActiveTarget) {
        sampleStencilHeatmapColor(
          Math.min(1, activityScore + 0.15),
          0.95,
          isLight,
          heatColor
        );
        nodeHex = heatColor.getHex();
      }

      const sphereMat = new THREE.MeshBasicMaterial({
        color: nodeHex,
        transparent: true,
        opacity: isFilteredOut ? 0.18 : 1.0,
      });

      const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
      sphereMesh.position.copy(pos);
      sphereMesh.userData = { nodeId: node.id, activityScore };
      mindprintGroup.add(sphereMesh);
      nodeMeshesRef.current.set(node.id, sphereMesh);

      // Volumetric aura around active/hovered/selected burnt-orange node or heatmap hotspot
      if ((!isFilteredOut && isActiveTarget) || (isHeatmapActive && !isFilteredOut && activityScore > 0.35)) {
        const auraGeo = new THREE.SphereGeometry(
          isActiveTarget ? radius * 3.1 : radius * (2.4 + activityScore * 1.4),
          16,
          16
        );
        const auraMat = new THREE.MeshBasicMaterial({
          color: isActiveTarget ? BURNT_ORANGE_HEX : nodeHex,
          transparent: true,
          opacity: isActiveTarget ? 0.32 : 0.16 * activityScore,
          blending: isLight ? THREE.NormalBlending : THREE.AdditiveBlending,
          depthWrite: false,
        });
        const auraMesh = new THREE.Mesh(auraGeo, auraMat);
        auraMesh.position.copy(pos);
        mindprintGroup.add(auraMesh);
      }

      // Outer stencil ring for Core hub and Hovered/Selected nodes
      if ((isCore || isActiveTarget) && !isFilteredOut) {
        const ringGeo = new THREE.RingGeometry(radius * 1.45, radius * 1.82, 32);
        const ringMat = new THREE.MeshBasicMaterial({
          color: isActiveTarget
            ? BURNT_ORANGE_HEX
            : isHeatmapActive
            ? nodeHex
            : isLight
            ? 0x000000
            : 0xffffff,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: isActiveTarget || isCore ? 0.95 : 0.65,
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
      const startAct = nodeActivityMap.get(node.id) ?? 0.5;

      node.connections.forEach((targetId) => {
        const pairKey = [node.id, targetId].sort().join('--');
        if (drawnPairs.has(pairKey)) return;
        drawnPairs.add(pairKey);

        const endPos = anatomicalNodePositions.get(targetId);
        if (!endPos) return;
        const endAct = nodeActivityMap.get(targetId) ?? 0.5;

        const targetNode = profile.nodes.find((n) => n.id === targetId);
        const isCoreLink =
          node.significance === 'Core' || targetNode?.significance === 'Core';
        const isHighlighted =
          selectedNode && (selectedNode.id === node.id || selectedNode.id === targetId);
        const isHoveredLink =
          hoveredNodeId && (hoveredNodeId === node.id || hoveredNodeId === targetId);
        const isFocusLink = Boolean(isHighlighted || isHoveredLink);

        const lineGeo = new THREE.BufferGeometry().setFromPoints([startPos, endPos]);

        let linkColorHex = isFocusLink
          ? BURNT_ORANGE_HEX
          : isLight
          ? 0x475569
          : 0xa1a1aa;

        if (isHeatmapActive && !isFocusLink) {
          const avgAct = (startAct + endAct) * 0.5;
          sampleStencilHeatmapColor(avgAct + 0.12, 0.85, isLight, heatColor);
          linkColorHex = heatColor.getHex();
        }

        if (isCoreLink && !isFocusLink) {
          const dashMat = new THREE.LineDashedMaterial({
            color: isHeatmapActive ? linkColorHex : isLight ? 0x0f172a : 0xffffff,
            dashSize: 0.08,
            gapSize: 0.05,
            transparent: true,
            opacity: selectedNode ? 0.28 : isHeatmapActive ? 0.72 : 0.55,
          });
          const line = new THREE.Line(lineGeo, dashMat);
          line.computeLineDistances();
          mindprintGroup.add(line);
        } else {
          const solidMat = new THREE.LineBasicMaterial({
            color: linkColorHex,
            transparent: true,
            opacity: isFocusLink
              ? 0.95
              : selectedNode
              ? 0.18
              : isHeatmapActive
              ? 0.62
              : 0.42,
          });
          const line = new THREE.Line(lineGeo, solidMat);
          mindprintGroup.add(line);
        }

        // Register animated synaptic signal pulses along active pathways
        if (isFocusLink || (!selectedNode && isCoreLink) || isHeatmapActive) {
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
        color: hoveredNodeId || selectedNode ? BURNT_ORANGE_HEX : isHeatmapActive ? 0xfef08a : isLight ? 0x000000 : 0xffffff,
        size: 0.075,
        transparent: true,
        opacity: 0.95,
      });
      const pulsePoints = new THREE.Points(pulseGeo, pulseMat);
      mindprintGroup.add(pulsePoints);
      pulsePointsRef.current = pulsePoints;
    }
  }, [
    profile,
    anatomicalNodePositions,
    nodeActivityMap,
    activeCategory,
    selectedNode,
    hoveredNodeId,
    visualStyle,
    isHeatmapActive,
  ]);

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
      cameraRef.current.position.set(0, 0.05, 6.3);
      brainRootRef.current.rotation.set(0, 0, 0);
    } else if (preset === 'three-quarter') {
      cameraRef.current.position.set(-0.6, 0.35, 6.1);
      brainRootRef.current.rotation.set(0.06, 0.42, 0);
    } else if (preset === 'superior') {
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

      {/* Top-Left Mindprint Graph Toolbar (+ / - / Fit graph / Toggle Heatmap / View Angles / Labels toggle) */}
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

        {/* Toggle Heatmap Button */}
        <button
          onClick={handleToggleHeatmap}
          className={`px-3 h-8 flex items-center space-x-1.5 border text-xs font-bold transition-colors ${
            isHeatmapActive
              ? 'bg-gradient-to-r from-cyan-500 via-amber-500 to-red-500 text-black border-white shadow-[0_0_15px_rgba(245,158,11,0.45)]'
              : isLight
              ? 'bg-white/90 border-zinc-300 text-zinc-900 hover:bg-zinc-100'
              : 'bg-zinc-950/90 border-white/15 text-zinc-200 hover:border-white/50 hover:text-white'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Toggle Heatmap</span>
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

      {/* Neural Activity Heatmap Scale Legend Overlay (Visible when Heatmap Mode is ON) */}
      {isHeatmapActive && (
        <div
          className={`absolute bottom-3 left-3 z-20 p-3 border font-mono text-xs space-y-2 ${
            isLight
              ? 'bg-white/95 border-zinc-300 text-zinc-900 shadow-md'
              : 'bg-zinc-950/90 border-white/20 text-white'
          }`}
        >
          <div className="flex items-center justify-between space-x-4">
            <span className="text-[10px] uppercase tracking-widest font-bold">
              CORTICAL ACTIVITY HEATMAP
            </span>
            <span className="text-[10px] px-1.5 py-0.5 bg-red-500/20 text-red-400 border border-red-500/30 font-bold">
              fMRI OVERLAY ACTIVE
            </span>
          </div>

          <div className="space-y-1">
            <div className="w-56 h-2.5 rounded-none bg-gradient-to-r from-zinc-500 via-cyan-400 via-emerald-400 via-amber-400 to-red-500 border border-white/20" />
            <div className="flex justify-between text-[9px] text-zinc-400 uppercase">
              <span>Stencil Base</span>
              <span>Cyan</span>
              <span>Emerald</span>
              <span>Amber</span>
              <span>Peak</span>
            </div>
          </div>

          {peakNode && (
            <div className="pt-1 border-t border-white/10 text-[10px] text-zinc-300 flex items-center justify-between">
              <span className="text-zinc-400">Peak Hotspot:</span>
              <span className="font-bold text-amber-400 truncate max-w-[140px]">
                {peakNode.region || peakNode.label}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Projected 3D Mindprint Node Labels with Burnt-Orange Highlight Zone & Callout Leader Line */}
      {showLabels && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
          {projectedLabels.map((lbl) => {
            if (!lbl.visible) return null;
            const nodeObj = profile.nodes.find((n) => n.id === lbl.id);
            if (!nodeObj) return null;

            const isHovered = hoveredNodeId === lbl.id;
            const isHighlighted = isHovered || lbl.isSelected;
            const pct = Math.round(lbl.activityScore * 100);

            const heatBadgeClass =
              lbl.activityScore >= 0.78
                ? 'border-red-500/80 text-red-200 bg-red-950/85'
                : lbl.activityScore >= 0.55
                ? 'border-amber-400/80 text-amber-200 bg-amber-950/85'
                : lbl.activityScore >= 0.35
                ? 'border-emerald-400/80 text-emerald-200 bg-emerald-950/85'
                : 'border-cyan-400/80 text-cyan-200 bg-cyan-950/85';

            return (
              <div
                key={lbl.id}
                style={{
                  transform: `translate3d(${lbl.x}px, ${lbl.y}px, 0)`,
                }}
                className={`absolute top-0 left-0 pointer-events-auto cursor-pointer group transition-opacity duration-150 ${
                  lbl.isFilteredOut ? 'opacity-20' : 'opacity-100'
                } ${isHighlighted ? 'z-30' : 'z-10'}`}
                onClick={() => onSelectNode(nodeObj)}
                onMouseEnter={() => setHoveredNodeId(lbl.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
              >
                {lbl.isCore ? (
                  /* Iconic Double-Ring "Thinking Core" Marker with Burnt Orange Area & Line */
                  <div className="relative -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
                    {/* Burnt-orange area glow behind the Thinking Core when hovered or selected */}
                    <div
                      className={`absolute -inset-3 rounded-sm transition-all duration-200 pointer-events-none ${
                        isHighlighted
                          ? 'bg-[#ea580c]/25 border border-[#f97316] shadow-[0_0_24px_rgba(234,88,12,0.55)] opacity-100'
                          : 'opacity-0 group-hover:opacity-100 bg-[#ea580c]/15 border border-[#ea580c]/60'
                      }`}
                    />
                    <div
                      className={`relative w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all ${
                        isHighlighted
                          ? 'border-[#f97316] bg-[#ea580c]/30 shadow-[0_0_18px_rgba(234,88,12,0.85)] scale-110'
                          : isHeatmapActive
                          ? 'border-red-400 bg-red-950/70 shadow-[0_0_18px_rgba(239,68,68,0.65)]'
                          : isLight
                          ? 'border-black bg-white/80 shadow-md'
                          : 'border-white bg-black/75 shadow-[0_0_16px_rgba(255,255,255,0.45)]'
                      }`}
                    >
                      <div
                        className={`w-3.5 h-3.5 rounded-full border ${
                          isHighlighted
                            ? 'border-white bg-[#ea580c]'
                            : isHeatmapActive
                            ? 'border-amber-300 bg-red-500/40'
                            : isLight
                            ? 'border-black bg-black/10'
                            : 'border-white bg-white/15'
                        }`}
                      />
                    </div>

                    {/* Vertical Connecting Line from Core Ring to Label */}
                    <div
                      className={`w-[2px] h-3.5 transition-colors ${
                        isHighlighted ? 'bg-[#f97316]' : isLight ? 'bg-black/60' : 'bg-white/60'
                      }`}
                    />

                    <span
                      className={`relative px-2 py-0.5 text-xs font-mono font-bold tracking-tight whitespace-nowrap border transition-all ${
                        isHighlighted
                          ? 'bg-[#c2410c] text-white border-[#fdba74] shadow-[0_0_18px_rgba(234,88,12,0.8)]'
                          : isHeatmapActive
                          ? 'text-red-100 bg-red-950/90 border-red-400/60'
                          : isLight
                          ? 'text-black bg-white/90 border-black/30'
                          : 'text-white bg-black/85 border-white/25'
                      }`}
                    >
                      {lbl.label} {isHeatmapActive ? `(${pct}%)` : ''}
                    </span>
                  </div>
                ) : (
                  /* Standard Mindprint Pattern Node + Callout Leader Line + Burnt Orange Word Area Highlight */
                  <div className="relative flex flex-col items-center -translate-x-1/2 -translate-y-full">
                    {/* Word Callout Container with Burnt Orange Area Aura on Hover / Selection */}
                    <div
                      className={`relative px-2 py-1 transition-all duration-150 ${
                        isHighlighted
                          ? 'bg-[#ea580c]/25 border border-[#f97316] shadow-[0_0_22px_rgba(234,88,12,0.65)] scale-105'
                          : 'border border-transparent group-hover:bg-[#ea580c]/20 group-hover:border-[#f97316]/80'
                      }`}
                    >
                      <span
                        className={`block px-2 py-0.5 text-[11px] font-mono tracking-tight whitespace-nowrap transition-all border ${
                          isHighlighted
                            ? 'bg-[#c2410c] text-white border-[#fdba74] font-bold shadow-[0_0_12px_rgba(234,88,12,0.85)]'
                            : isHeatmapActive
                            ? `${heatBadgeClass} group-hover:bg-[#c2410c] group-hover:text-white group-hover:border-[#fdba74]`
                            : lbl.isConnected
                            ? isLight
                              ? 'bg-white/95 text-black font-semibold border-black/30'
                              : 'bg-black/85 text-white font-semibold border-white/35'
                            : isLight
                            ? 'text-zinc-800 bg-white/80 border-zinc-300/80'
                            : 'text-zinc-200 bg-black/75 border-white/15'
                        }`}
                      >
                        {lbl.label}
                        {isHeatmapActive ? ` • ${pct}%` : ''}
                      </span>
                    </div>

                    {/* Crisp Leader Line connecting the Word Highlight Box directly to the 3D Node Pinpoint */}
                    <div
                      className={`transition-all duration-150 ${
                        isHighlighted
                          ? 'w-[2px] h-5 bg-[#f97316] shadow-[0_0_8px_#ea580c]'
                          : isLight
                          ? 'w-[1px] h-3.5 bg-zinc-500/70 group-hover:w-[2px] group-hover:h-5 group-hover:bg-[#f97316]'
                          : 'w-[1px] h-3.5 bg-white/45 group-hover:w-[2px] group-hover:h-5 group-hover:bg-[#f97316]'
                      }`}
                    />

                    {/* Exact 3D Brain Node Target Reticle Pinpoint at (0, 0) */}
                    <div
                      className={`relative flex items-center justify-center transition-transform duration-150 ${
                        isHighlighted ? 'scale-125' : 'group-hover:scale-125'
                      }`}
                    >
                      {isHighlighted && (
                        <span className="absolute w-5 h-5 rounded-full border border-[#f97316] bg-[#ea580c]/30" />
                      )}
                      <div
                        className={`w-2.5 h-2.5 rounded-full border transition-colors ${
                          isHighlighted
                            ? 'bg-[#ea580c] border-white shadow-[0_0_10px_#ea580c]'
                            : isHeatmapActive
                            ? lbl.activityScore >= 0.78
                              ? 'bg-red-500 border-white'
                              : lbl.activityScore >= 0.55
                              ? 'bg-amber-400 border-black'
                              : 'bg-emerald-400 border-black'
                            : isLight
                            ? 'bg-zinc-900 border-white group-hover:bg-[#ea580c]'
                            : 'bg-zinc-200 border-black group-hover:bg-[#ea580c]'
                        }`}
                      />
                    </div>
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
