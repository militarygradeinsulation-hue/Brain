import * as THREE from 'three';

export interface BrainNetworkGeometry {
  surfacePositions: Float32Array;
  surfaceNormals: Float32Array;
  coreLinePositions: Float32Array;
  coreLineWeights: Float32Array;
  innerLinePositions: Float32Array;
  haloPositions: Float32Array;
  haloLinePositions: Float32Array;
}

// Smooth minimum for organic anatomical blending
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0.0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

// Smooth maximum for carving fissures and sulci
function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

// Oriented ellipsoid distance approximation
function sdEllipsoid(
  px: number,
  py: number,
  pz: number,
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  rotZ = 0,
  rotX = 0
): number {
  let x = px - cx;
  let y = py - cy;
  let z = pz - cz;

  if (rotZ !== 0) {
    const c = Math.cos(rotZ);
    const s = Math.sin(rotZ);
    const nx = c * x - s * y;
    const ny = s * x + c * y;
    x = nx;
    y = ny;
  }
  if (rotX !== 0) {
    const c = Math.cos(rotX);
    const s = Math.sin(rotX);
    const ny = c * y - s * z;
    const nz = s * y + c * z;
    y = ny;
    z = nz;
  }

  const k0 = Math.sqrt((x * x) / (rx * rx) + (y * y) / (ry * ry) + (z * z) / (rz * rz));
  if (k0 < 1e-6) return -Math.min(rx, ry, rz);
  const k1 = Math.sqrt(
    (x * x) / (rx * rx * rx * rx) +
      (y * y) / (ry * ry * ry * ry) +
      (z * z) / (rz * rz * rz * rz)
  );
  return (k0 * (k0 - 1.0)) / k1;
}

// Capsule / tapered cylinder distance for Brainstem and Sulci
function sdTaperedCapsule(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  ra: number,
  rb: number
): number {
  const pax = px - ax;
  const pay = py - ay;
  const paz = pz - az;
  const bax = bx - ax;
  const bay = by - ay;
  const baz = bz - az;
  const baba = bax * bax + bay * bay + baz * baz;
  const paba = pax * bax + pay * bay + paz * baz;
  const h = Math.max(0.0, Math.min(1.0, paba / baba));
  const r = ra + (rb - ra) * h;
  const dx = pax - bax * h;
  const dy = pay - bay * h;
  const dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

/**
 * Exact 3D Anatomical Human Brain Signed Distance Function (SDF).
 * Coordinate convention matching the reference lateral view:
 *   X: Anterior (-2.15 Front/Left) to Posterior (+2.15 Back/Right)
 *   Y: Inferior (-1.90 Brainstem tip) to Superior (+1.62 Parietal crown)
 *   Z: Lateral Left/Right hemispheres (-1.45 to +1.45), with Longitudinal Fissure at Z = 0
 */
export function brainSDF(x: number, y: number, z: number, includeGyri = true): number {
  const az = Math.abs(z);

  // 1. FRONTAL LOBE (Anterior rounded dome + prefrontal pole + superior frontal arch)
  const frontalMain = sdEllipsoid(x, y, az, -0.82, 0.36, 0.56, 1.26, 1.02, 0.78, -0.22);
  const frontalPole = sdEllipsoid(x, y, az, -1.48, 0.04, 0.44, 0.68, 0.64, 0.58, 0.12);
  const superiorFrontal = sdEllipsoid(x, y, az, -0.35, 0.72, 0.54, 1.08, 0.85, 0.74, -0.08);

  // Orbital base indentation under anterior frontal lobe
  const orbitalCut = -(y + 0.42 - (x + 1.4) * 0.18);
  let frontal = smin(frontalMain, frontalPole, 0.35);
  frontal = smin(frontal, superiorFrontal, 0.35);
  if (x < -0.75) {
    frontal = smax(frontal, orbitalCut, 0.22);
  }

  // 2. PARIETAL LOBE (High superior-posterior crown, widest laterally)
  const parietalMain = sdEllipsoid(x, y, az, 0.38, 0.66, 0.62, 1.15, 0.94, 0.84, 0.15);
  const parietalCrown = sdEllipsoid(x, y, az, 0.08, 0.88, 0.52, 0.98, 0.72, 0.72, 0.05);
  const parietal = smin(parietalMain, parietalCrown, 0.32);

  // 3. OCCIPITAL LOBE (Posterior tapering pole overhanging the cerebellum)
  const occipitalMain = sdEllipsoid(x, y, az, 1.28, 0.22, 0.50, 0.88, 0.76, 0.68, 0.28);
  const occipitalPole = sdEllipsoid(x, y, az, 1.65, 0.02, 0.38, 0.52, 0.48, 0.48, 0.18);
  const occipital = smin(occipitalMain, occipitalPole, 0.28);

  // Combine upper cerebrum (Frontal + Parietal + Occipital)
  let upperCerebrum = smin(frontal, parietal, 0.36);
  upperCerebrum = smin(upperCerebrum, occipital, 0.32);

  // 4. TEMPORAL LOBE (Distinct thumb-like lateral-inferior lobe below the Sylvian fissure)
  const temporalMain = sdEllipsoid(x, y, az, -0.02, -0.38, 0.74, 1.02, 0.54, 0.62, 0.26);
  const temporalPole = sdEllipsoid(x, y, az, -0.68, -0.52, 0.62, 0.48, 0.36, 0.44, 0.32);
  const temporalPosterior = sdEllipsoid(x, y, az, 0.62, -0.18, 0.72, 0.68, 0.48, 0.58, 0.18);
  let temporal = smin(temporalMain, temporalPole, 0.25);
  temporal = smin(temporal, temporalPosterior, 0.28);

  // Carve the SYLVIAN FISSURE (Lateral Sulcus) notch between Frontal/Parietal and Temporal lobe
  const sylvianGroove = sdTaperedCapsule(
    x,
    y,
    az,
    -1.15,
    -0.34,
    1.18,
    0.45,
    0.18,
    1.28,
    0.22,
    0.11
  );

  let cerebrum = smin(upperCerebrum, temporal, 0.18);
  cerebrum = smax(cerebrum, -sylvianGroove, 0.14);

  // Carve the MEDIAL LONGITUDINAL FISSURE separating Left and Right Cerebral Hemispheres
  const corpusCallosumDist = sdEllipsoid(x, y, z, -0.05, 0.18, 0.0, 0.72, 0.32, 0.25, 0);
  if (corpusCallosumDist > 0.0) {
    const fissureWidth = 0.09 + 0.05 * Math.max(0, y * 0.5);
    const fissurePlane = fissureWidth - az;
    cerebrum = smax(cerebrum, fissurePlane, 0.12);
  }

  // 5. CEREBELLUM (Tucked under the occipital lobe at the back-bottom)
  const cerebellumHemisphere = sdEllipsoid(x, y, az, 1.02, -0.78, 0.48, 0.66, 0.46, 0.54, -0.12);
  const cerebellumVermis = sdEllipsoid(x, y, z, 0.96, -0.76, 0.0, 0.54, 0.40, 0.28, -0.1);
  let cerebellum = smin(cerebellumHemisphere, cerebellumVermis, 0.18);

  // Horizontal cerebellar folia ridges
  if (includeGyri && cerebellum < 0.25) {
    cerebellum += 0.015 * Math.sin(y * 38.0 + x * 6.0);
  }

  // Carve Transverse Fissure notch between Occipital Lobe and Cerebellum
  const transverseNotch = sdTaperedCapsule(
    x,
    y,
    az,
    0.85,
    -0.34,
    0.4,
    1.75,
    -0.36,
    0.6,
    0.08,
    0.14
  );
  cerebrum = smax(cerebrum, -transverseNotch, 0.08);

  // 6. BRAINSTEM (Midbrain -> Pons anterior bulge -> Medulla Oblongata tapering downward)
  const pons = sdEllipsoid(x, y, z, 0.12, -0.94, 0.0, 0.30, 0.34, 0.30, 0.22);
  const medulla = sdTaperedCapsule(x, y, z, 0.12, -0.75, 0.0, 0.26, -1.78, 0.0, 0.28, 0.12);
  const brainstem = smin(pons, medulla, 0.18);

  // Combine Cerebrum + Cerebellum + Brainstem
  let d = smin(cerebrum, cerebellum, 0.12);
  d = smin(d, brainstem, 0.16);

  // 7. CORTICAL GYRI & SULCI (Organic brain convolutions on the cerebral cortex)
  if (includeGyri && d < 0.35 && y > -0.85) {
    const g1 =
      Math.sin(x * 7.8 + Math.cos(y * 6.5) * 1.4) *
      Math.cos(y * 7.2 + Math.sin(az * 7.5) * 1.2);
    const g2 = Math.sin(x * 13.5 - y * 9.2 + az * 11.0) * 0.45;
    const gyri = (g1 + g2) * 0.026;
    d += gyri;
  }

  return d;
}

// Compute unit surface normal via central differences
export function brainNormal(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  const e = 0.015;
  const dx = brainSDF(x + e, y, z, true) - brainSDF(x - e, y, z, true);
  const dy = brainSDF(x, y + e, z, true) - brainSDF(x, y - e, z, true);
  const dz = brainSDF(x, y, z + e, true) - brainSDF(x, y, z - e, true);
  out.set(dx, dy, dz);
  const len = out.length();
  if (len > 1e-6) out.divideScalar(len);
  return out;
}

// Project an arbitrary 3D point onto a target iso-surface of the brain SDF
export function projectToBrainSurface(
  p: THREE.Vector3,
  targetIso = 0.0,
  iterations = 5
): THREE.Vector3 {
  const n = new THREE.Vector3();
  for (let i = 0; i < iterations; i++) {
    const d = brainSDF(p.x, p.y, p.z, true) - targetIso;
    if (Math.abs(d) < 0.002) break;
    brainNormal(p.x, p.y, p.z, n);
    p.addScaledVector(n, -d * 0.85);
  }
  return p;
}

// Ensure any Mindprint node coordinate sits inside or on the anatomical human brain
export function fitNodeToBrainAnatomy(x: number, y: number, z: number): THREE.Vector3 {
  const p = new THREE.Vector3(x, y, z);
  const d = brainSDF(p.x, p.y, p.z, false);
  if (d > -0.02) {
    // Pull outside points onto or just inside the cortical surface
    projectToBrainSurface(p, -0.05, 6);
  }
  return p;
}

// Deterministic pseudo-random generator
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates the high-resolution 3D Human Brain Network matching the Adobe Stock reference images:
 * 1. 3,100 cortical surface vertices & ~16,500 triangulated plexus edges sculpting every lobe, gyrus, sulcus, cerebellum, and brainstem
 * 2. ~3,200 internal sub-cortical & white-matter cross-filaments
 * 3. ~420 outer halo synaptic tendrils & floating vertices hugging the brain contour
 */
export function generateAnatomicalBrainNetwork(): BrainNetworkGeometry {
  const rand = mulberry32(464881935);
  const surfacePts: THREE.Vector3[] = [];
  const tempNormal = new THREE.Vector3();

  // 1. Sample 2,850 points across the entire anatomical brain surface
  const targetSurfaceCount = 2850;
  let attempts = 0;

  while (surfacePts.length < targetSurfaceCount && attempts < 35000) {
    attempts++;
    const x = (rand() - 0.5) * 4.4;
    const y = (rand() - 0.5) * 3.7 - 0.1;
    const z = (rand() - 0.5) * 3.1;

    const d = brainSDF(x, y, z, false);
    if (Math.abs(d) < 0.42) {
      const pt = new THREE.Vector3(x, y, z);
      projectToBrainSurface(pt, 0.0, 5);
      if (Math.abs(brainSDF(pt.x, pt.y, pt.z, true)) < 0.035) {
        surfacePts.push(pt);
      }
    }
  }

  // Extra dense coverage on the Brainstem, Pons, Cerebellum, and Sylvian Fissure contour
  for (let i = 0; i < 260; i++) {
    const x = -0.1 + (rand() - 0.35) * 1.75;
    const y = -0.45 - rand() * 1.35;
    const z = (rand() - 0.5) * 1.65;
    const pt = new THREE.Vector3(x, y, z);
    projectToBrainSurface(pt, 0.0, 6);
    if (Math.abs(brainSDF(pt.x, pt.y, pt.z, true)) < 0.035) {
      surfacePts.push(pt);
    }
  }

  // 2. Tangential relaxation passes for uniform Delaunay-like triangulation
  const cellSize = 0.16;
  const minSpacing = 0.074;
  const minSpacingSq = minSpacing * minSpacing;

  for (let iter = 0; iter < 2; iter++) {
    const grid = new Map<string, number[]>();
    for (let i = 0; i < surfacePts.length; i++) {
      const p = surfacePts[i];
      const key = `${Math.floor(p.x / cellSize)},${Math.floor(p.y / cellSize)},${Math.floor(p.z / cellSize)}`;
      let cell = grid.get(key);
      if (!cell) {
        cell = [];
        grid.set(key, cell);
      }
      cell.push(i);
    }

    for (let i = 0; i < surfacePts.length; i++) {
      const p = surfacePts[i];
      const gx = Math.floor(p.x / cellSize);
      const gy = Math.floor(p.y / cellSize);
      const gz = Math.floor(p.z / cellSize);

      let pushX = 0;
      let pushY = 0;
      let pushZ = 0;

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const cell = grid.get(`${gx + dx},${gy + dy},${gz + dz}`);
            if (!cell) continue;
            for (let k = 0; k < cell.length; k++) {
              const j = cell[k];
              if (i === j) continue;
              const q = surfacePts[j];
              const vx = p.x - q.x;
              const vy = p.y - q.y;
              const vz = p.z - q.z;
              const dSq = vx * vx + vy * vy + vz * vz;
              if (dSq > 1e-6 && dSq < minSpacingSq) {
                const dist = Math.sqrt(dSq);
                const f = (minSpacing - dist) / dist;
                pushX += vx * f * 0.25;
                pushY += vy * f * 0.25;
                pushZ += vz * f * 0.25;
              }
            }
          }
        }
      }

      if (pushX !== 0 || pushY !== 0 || pushZ !== 0) {
        p.x += pushX;
        p.y += pushY;
        p.z += pushZ;
        projectToBrainSurface(p, 0.0, 2);
      }
    }
  }

  // 3. Build Cortical Surface Triangulated Plexus Edges
  const edgeGridSize = 0.25;
  const edgeGrid = new Map<string, number[]>();
  for (let i = 0; i < surfacePts.length; i++) {
    const p = surfacePts[i];
    const key = `${Math.floor(p.x / edgeGridSize)},${Math.floor(p.y / edgeGridSize)},${Math.floor(p.z / edgeGridSize)}`;
    let cell = edgeGrid.get(key);
    if (!cell) {
      cell = [];
      edgeGrid.set(key, cell);
    }
    cell.push(i);
  }

  const coreLines: number[] = [];
  const coreWeights: number[] = [];
  const maxSurfaceEdgeDist = 0.24;
  const maxSurfaceEdgeDistSq = maxSurfaceEdgeDist * maxSurfaceEdgeDist;

  for (let i = 0; i < surfacePts.length; i++) {
    const p = surfacePts[i];
    const gx = Math.floor(p.x / edgeGridSize);
    const gy = Math.floor(p.y / edgeGridSize);
    const gz = Math.floor(p.z / edgeGridSize);

    const candidates: { idx: number; dSq: number }[] = [];

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const cell = edgeGrid.get(`${gx + dx},${gy + dy},${gz + dz}`);
          if (!cell) continue;
          for (let k = 0; k < cell.length; k++) {
            const j = cell[k];
            if (j <= i) continue;
            const q = surfacePts[j];
            // Respect the Longitudinal Fissure between hemispheres
            if (p.z * q.z < 0 && Math.abs(p.z - q.z) > 0.13 && p.y > -0.45) continue;

            const vx = p.x - q.x;
            const vy = p.y - q.y;
            const vz = p.z - q.z;
            const dSq = vx * vx + vy * vy + vz * vz;
            if (dSq < maxSurfaceEdgeDistSq) {
              const mx = (p.x + q.x) * 0.5;
              const my = (p.y + q.y) * 0.5;
              const mz = (p.z + q.z) * 0.5;
              if (brainSDF(mx, my, mz, false) < 0.055) {
                candidates.push({ idx: j, dSq });
              }
            }
          }
        }
      }
    }

    candidates.sort((a, b) => a.dSq - b.dSq);
    const maxLinks = Math.min(candidates.length, 7);
    for (let c = 0; c < maxLinks; c++) {
      const q = surfacePts[candidates[c].idx];
      coreLines.push(p.x, p.y, p.z, q.x, q.y, q.z);

      // Weight based on edge tightness + cortical gyri ridge modulation
      const distFactor = Math.max(0.25, 1.0 - Math.sqrt(candidates[c].dSq) / maxSurfaceEdgeDist);
      const gyriHighlight =
        0.72 +
        0.28 *
          Math.sin(p.x * 7.8 + Math.cos(p.y * 6.5) * 1.4) *
          Math.cos(p.y * 7.2 + Math.sin(Math.abs(p.z) * 7.5) * 1.2);
      const w = Math.min(1.0, Math.max(0.2, distFactor * gyriHighlight));
      coreWeights.push(w, w);
    }
  }

  // 4. Internal White-Matter & Subcortical Cross-Filaments
  const innerPts: THREE.Vector3[] = [];
  for (let i = 0; i < 650; i++) {
    const sIdx = Math.floor(rand() * surfacePts.length);
    const sp = surfacePts[sIdx];
    brainNormal(sp.x, sp.y, sp.z, tempNormal);
    const depth = 0.10 + rand() * 0.42;
    const ip = sp.clone().addScaledVector(tempNormal, -depth);
    if (brainSDF(ip.x, ip.y, ip.z, false) < -0.03) {
      innerPts.push(ip);
    }
  }

  const innerLines: number[] = [];
  for (let i = 0; i < innerPts.length; i++) {
    const p = innerPts[i];
    let connected = 0;
    for (let j = i + 1; j < innerPts.length && connected < 5; j++) {
      const q = innerPts[j];
      const dSq = p.distanceToSquared(q);
      if (dSq < 0.24) {
        innerLines.push(p.x, p.y, p.z, q.x, q.y, q.z);
        connected++;
      }
    }
    const sIdx = (i * 5) % surfacePts.length;
    const sp = surfacePts[sIdx];
    if (p.distanceToSquared(sp) < 0.26) {
      innerLines.push(p.x, p.y, p.z, sp.x, sp.y, sp.z);
    }
  }

  // 5. Outer Halo Synaptic Tendrils & Floating Vertices
  const haloPts: THREE.Vector3[] = [];
  const haloLines: number[] = [];
  for (let i = 0; i < 420; i++) {
    const sIdx = Math.floor(rand() * surfacePts.length);
    const sp = surfacePts[sIdx];
    brainNormal(sp.x, sp.y, sp.z, tempNormal);
    const offset = 0.07 + Math.pow(rand(), 1.45) * 0.29;
    const hp = sp.clone().addScaledVector(tempNormal, offset);
    hp.x += (rand() - 0.5) * 0.08;
    hp.y += (rand() - 0.5) * 0.08;
    hp.z += (rand() - 0.5) * 0.08;
    haloPts.push(hp);

    // Connect halo point back to nearby cortical surface vertices to create the triangulated aura
    haloLines.push(hp.x, hp.y, hp.z, sp.x, sp.y, sp.z);
    let struts = 0;
    for (let k = 1; k < 45 && struts < 2; k++) {
      const otherIdx = (sIdx + k * 7) % surfacePts.length;
      const op = surfacePts[otherIdx];
      if (hp.distanceToSquared(op) < 0.22) {
        haloLines.push(hp.x, hp.y, hp.z, op.x, op.y, op.z);
        struts++;
      }
    }
  }

  for (let i = 0; i < haloPts.length; i++) {
    const p = haloPts[i];
    let links = 0;
    for (let j = i + 1; j < haloPts.length && links < 3; j++) {
      const q = haloPts[j];
      if (p.distanceToSquared(q) < 0.28) {
        haloLines.push(p.x, p.y, p.z, q.x, q.y, q.z);
        links++;
      }
    }
  }

  const surfacePositions = new Float32Array(surfacePts.length * 3);
  const surfaceNormals = new Float32Array(surfacePts.length * 3);
  for (let i = 0; i < surfacePts.length; i++) {
    const p = surfacePts[i];
    surfacePositions[i * 3] = p.x;
    surfacePositions[i * 3 + 1] = p.y;
    surfacePositions[i * 3 + 2] = p.z;
    brainNormal(p.x, p.y, p.z, tempNormal);
    surfaceNormals[i * 3] = tempNormal.x;
    surfaceNormals[i * 3 + 1] = tempNormal.y;
    surfaceNormals[i * 3 + 2] = tempNormal.z;
  }

  const haloPositions = new Float32Array(haloPts.length * 3);
  for (let i = 0; i < haloPts.length; i++) {
    const p = haloPts[i];
    haloPositions[i * 3] = p.x;
    haloPositions[i * 3 + 1] = p.y;
    haloPositions[i * 3 + 2] = p.z;
  }

  return {
    surfacePositions,
    surfaceNormals,
    coreLinePositions: new Float32Array(coreLines),
    coreLineWeights: new Float32Array(coreWeights),
    innerLinePositions: new Float32Array(innerLines),
    haloPositions,
    haloLinePositions: new Float32Array(haloLines),
  };
}
