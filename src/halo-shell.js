import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.181.0/build/three.module.js";

// Factory for a simple ring (halo) shell geometry.
// Creates a segmented tubular wall with an inner gap (like a habitation shell).
// Parameters (scaled to scene units – this repo uses very large planetary scales):
//  - circleSegmentCount: number of radial segments (higher = smoother)
//  - radius: outer radius of the shell (center to outer wall)
//  - deckHeight: vertical height of the deck (thickness of base slab)
//  - wallInnerDrop: how far inward from outer radius the inner wall is (controls deck width)
//  - wallHeight: vertical height of the wall rising from deck top
//  - wallThickness: radial thickness of the wall (extrusion upward forming a lip)
//  - color: base color (used if no texture provided)
//  - texture: optional THREE.Texture to apply to the shell
//  - normalMap: optional THREE.Texture for normal mapping
// Returns THREE.Mesh.
export function createProceduralHaloShell({
  circleSegmentCount = 128,
  radius = 400000.0,
  deckHeight = 4000.0,
  wallInnerDrop = 8000.0,
  wallHeight = 6000.0,
  wallThickness = 3000.0,
  color = 0x66ccff,
  texture = null,
  normalMap = null,
} = {}) {
  // Guard against invalid params
  circleSegmentCount = Math.max(3, circleSegmentCount);
  const innerRadius = Math.max(0.0, radius - wallInnerDrop);

  const geometry = new THREE.BufferGeometry();
  const positions = [];
  const indices = [];
  const uvs = [];
  const normals = [];
  // Dedicated arrays for the exterior wall to ensure consistent UVs across both halves
  const extPositions = [];
  const extUVs = [];
  const extIndices = [];
  const extNormals = [];

  const segmentAngle = (Math.PI * 2) / circleSegmentCount;

  // Generate vertices and indices for both top and bottom halves (mirrored)
  // Top half: positive Y values
  // Bottom half: negative Y values (mirrored)
  
  for (let mirror = 0; mirror < 2; mirror++) {
    const ySign = mirror === 0 ? 1 : -1; // Top half: +1, Bottom half: -1
    const baseVertexOffset = mirror * (circleSegmentCount + 1) * 4;
    
    // Each segment has 4 vertices matching Unity's structure:
    // 0: Outer bottom (radiusInMeters, 0)
    // 1: Outer top (radiusInMeters, widthInMeters) 
    // 2: Inner bottom (innerRadius, widthInMeters)
    // 3: Inner wall top (innerRadius, widthInMeters + wallWidth)
    for (let i = 0; i <= circleSegmentCount; i++) {
    const angle = i * segmentAngle;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

  // Vertex 0: Outer ring mid (y=0) used for deck underside
  positions.push(cos * radius, 0, sin * radius);
    
  // Vertex 1: Outer ring top (deck surface outer edge)
  positions.push(cos * radius, deckHeight * ySign, sin * radius);
    
    // Vertex 2: Inner ring bottom (deck surface inner edge) 
  positions.push(cos * innerRadius, deckHeight * ySign, sin * innerRadius);
    
    // Vertex 3: Inner wall top (standing wall lip)
  positions.push(cos * innerRadius, (deckHeight + wallHeight) * ySign, sin * innerRadius);

    // UV mapping
    const segmentRatio = i / circleSegmentCount;
    const circumference = 2 * Math.PI * radius;
    const uvScaleX = circumference / deckHeight;

  uvs.push(segmentRatio * uvScaleX, 0); // outer bottom (at y=0)
  uvs.push(segmentRatio * uvScaleX, 1.0); // outer top (deck surface expects v=1)
    uvs.push(segmentRatio * uvScaleX, 0); // inner bottom
    uvs.push(segmentRatio * uvScaleX, wallHeight / deckHeight); // inner wall top

    if (i < circleSegmentCount) {
      const a = baseVertexOffset + i * 4;
        
      if (mirror === 0) {
  // TOP HALF - Normal winding order
  // (Removed top-half outer side triangles; will add shared full-height wall later)

        // WALL TRIANGLES (18 indices total)
        // Top surface connecting wall to exterior ring
        indices.push(a + 3, a + 5, a + 1);
        indices.push(a + 3, a + 7, a + 5);

        // Inner vertical wall
        indices.push(a + 2, a + 6, a + 3);
        indices.push(a + 6, a + 7, a + 3);

        // Deck surface
        indices.push(a + 2, a + 1, a + 6);
        indices.push(a + 5, a + 6, a + 1);
      } else {
        // BOTTOM HALF - Reversed winding order for mirrored geometry
  // (No outer side triangles here; shared full-height wall will be added after both halves are built)

        // WALL TRIANGLES (18 indices total)
        // Top surface connecting wall to exterior ring
        indices.push(a + 3, a + 1, a + 5);
        indices.push(a + 3, a + 5, a + 7);

        // Inner vertical wall
        indices.push(a + 2, a + 3, a + 6);
        indices.push(a + 6, a + 3, a + 7);

        // Deck surface (bottom half)
        indices.push(a + 2, a + 6, a + 1);
        indices.push(a + 5, a + 1, a + 6);
      }
  }
    }

  }

  // Build dedicated exterior wall strip with consistent UVs (only once)
  // For each segment vertex, create two wall vertices: bottom(-deckHeight)->v=0 and top(+deckHeight)->v=1
  const wallHeight_ext = deckHeight * 2; // Total height from -deckHeight to +deckHeight
  const circumference = 2 * Math.PI * radius;
  
  for (let i = 0; i <= circleSegmentCount; i++) {
    const angle = i * segmentAngle;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    
    // Calculate arc length to this point around the ring
    const arcLength = (i / circleSegmentCount) * circumference;
    
    // Outward-facing normal for exterior wall (radial direction, no Y component)
    const normalX = cos;
    const normalY = 0;
    const normalZ = sin;
    
    // Bottom of exterior wall
    extPositions.push(cos * radius, -deckHeight, sin * radius);
    extNormals.push(normalX, normalY, normalZ);
    // 2:1 aspect ratio - texture is twice as wide as tall, so divide by 2x wall height
    extUVs.push(arcLength / (wallHeight_ext * 2), 0.0);
    // Top of exterior wall
    extPositions.push(cos * radius, +deckHeight, sin * radius);
    extNormals.push(normalX, normalY, normalZ);
    extUVs.push(arcLength / (wallHeight_ext * 2), 1.0);
  }
  for (let i = 0; i < circleSegmentCount; i++) {
    const a = i * 2; // two verts per ring column in ext arrays
    // [bottom cur, top cur, bottom next]
    extIndices.push(a, a + 1, a + 2);
    // [bottom next, top cur, top next]
    extIndices.push(a + 2, a + 1, a + 3);
  }

  // Merge exterior wall into main geometry
  const baseVertexCount = positions.length / 3;
  for (let i = 0; i < extPositions.length; i++) {
    positions.push(extPositions[i]);
  }
  for (let i = 0; i < extNormals.length; i++) {
    normals.push(extNormals[i]);
  }
  for (let i = 0; i < extUVs.length; i++) {
    uvs.push(extUVs[i]);
  }
  for (let i = 0; i < extIndices.length; i++) {
    indices.push(extIndices[i] + baseVertexCount);
  }

  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  
  // Set normals for exterior wall, compute normals for rest of geometry
  if (normals.length > 0) {
    // Fill in normals for non-exterior vertices (use computed normals)
    const tempGeometry = new THREE.BufferGeometry();
    tempGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions.slice(0, baseVertexCount * 3), 3));
    tempGeometry.setIndex(indices.filter(idx => idx < baseVertexCount));
    tempGeometry.computeVertexNormals();
    const computedNormals = tempGeometry.getAttribute("normal");
    
    // Combine computed normals with manual exterior normals
    const finalNormals = new Float32Array(positions.length);
    for (let i = 0; i < baseVertexCount * 3; i++) {
      finalNormals[i] = computedNormals.array[i];
    }
    for (let i = 0; i < normals.length; i++) {
      finalNormals[baseVertexCount * 3 + i] = normals[i];
    }
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(finalNormals, 3));
  } else {
    geometry.computeVertexNormals();
  }

  // Create material using built-in MeshStandardMaterial
  // Relies on renderer.logarithmicDepthBuffer for correct depth at large scales
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    side: THREE.DoubleSide,
    map: texture || null,
    normalMap: normalMap || null,
    metalness: 0.0,
    roughness: 1.0,
  });
  
  // Set reasonable normal intensity for large-scale assets
  if (material.normalMap) {
    material.normalScale = new THREE.Vector2(1, 1);
  }
  
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "HaloShell";
  
  // Add method to update sun direction (no-op for built-in materials using scene lights)
  mesh.UpdateSunDirection = function(sunDirection) {
    // Built-in material uses actual scene lights; no action needed
  };

  return mesh;
}

// Convenience helper to add the shell to a scene at a given center.
export function addHaloShellToScene(scene, center = new THREE.Vector3(), opts = {}) {
  const shell = createProceduralHaloShell(opts);
  if (shell) {
    shell.position.copy(center);
    scene.add(shell);
  }
  return shell;
}

// Convenience wrapper specifically for creating the textured exterior halo shell.
// This centralizes the texture loading & parameter defaults so callers only provide
// the essentials (radius overrides). Returns the created shell (may receive
// texture updates asynchronously once the image finishes loading).
export function addHaloExteriorShell(
  scene,
  center = new THREE.Vector3(),
  {
    circleSegmentCount = 256,
    radius = 400000.0,
    deckHeight = 27000.0,
    wallInnerDrop = 8000.0,
    wallHeight = 5000.0,
    color = 0xffffff,
  texturePath = './resources/HaloExteriorTexture.png',
  normalMapPath = './resources/Normal_HaloExteriorTexture.png',
  } = {}
) {

  const textureLoader = new THREE.TextureLoader();
  const haloTexture = textureLoader.load(texturePath, (texture) => {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    console.log('Halo exterior texture loaded successfully');
    // Update material uniforms if shell already created
    if (shell && shell.material && shell.material.uniforms && shell.material.uniforms.diffuseMap) {
      shell.material.uniforms.diffuseMap.value = texture;
      shell.material.uniforms.useTexture.value = true;
    }
  });

  // Load normal map
  const haloNormal = textureLoader.load(normalMapPath, (ntex) => {
    ntex.wrapS = THREE.RepeatWrapping;
    ntex.wrapT = THREE.RepeatWrapping;
    ntex.colorSpace = THREE.LinearSRGBColorSpace; // normal maps use linear color space
    console.log('Halo normal map loaded successfully');
    if (shell && shell.material && shell.material.uniforms && shell.material.uniforms.normalMap) {
      shell.material.uniforms.normalMap.value = ntex;
      shell.material.uniforms.useNormalMap.value = true;
    }
  });

  // Create shell immediately; textures will populate as they load
  const shell = addHaloShellToScene(scene, center, {
    circleSegmentCount,
    radius,
    deckHeight,
    wallInnerDrop,
    wallHeight,
    color,
    texture: haloTexture,
    normalMap: haloNormal,
  });
  return shell;
}
