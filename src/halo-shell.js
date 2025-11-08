import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.112.1/build/three.module.js";

// Shader code for halo shell materials with logarithmic depth buffer support
const HALO_SHELL_VS = `#version 300 es
precision highp float;

out float vFragDepth;
out vec3 vNormal;
out vec3 vViewPosition;
out vec2 vUv;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vec4 clipPosition = projectionMatrix * mvPosition;
  gl_Position = clipPosition;
  vFragDepth = 1.0 + clipPosition.w;
  vNormal = normalMatrix * normal;
  vViewPosition = -mvPosition.xyz;
  vUv = uv;
}
`;

const HALO_SHELL_FS = `#version 300 es
precision highp float;

uniform vec3 color;
uniform float logDepthBufFC;
uniform vec3 lightDirection;
uniform sampler2D diffuseMap;
uniform bool useTexture;

in float vFragDepth;
in vec3 vNormal;
in vec3 vViewPosition;
in vec2 vUv;

out vec4 out_FragColor;

void main() {
  // vNormal is in view space (normalMatrix * normal). Transform lightDirection to view space too
  vec3 normal = normalize(vNormal);
  vec3 lightDir = normalize(mat3(viewMatrix) * lightDirection);
  
  // Ensure consistent lighting for backfaces when using DoubleSide
  if (!gl_FrontFacing) {
    normal = -normal;
  }
  
  // Simple diffuse lighting
  float diffuse = max(dot(normal, lightDir), 0.0);
  
  // Get base color from texture or uniform
  vec3 baseColor = color;
  if (useTexture) {
    vec4 texColor = texture(diffuseMap, vUv);
    baseColor = texColor.rgb;
  }
  
  // Ambient + diffuse (reduced ambient for more dramatic lighting)
  vec3 ambient = baseColor * 0.05;
  vec3 lit = ambient + baseColor * diffuse * 0.95;
  
  out_FragColor = vec4(lit, 1.0);
  gl_FragDepth = log2(vFragDepth) * logDepthBufFC * 0.5;
}
`;

function _CreateHaloShellMaterial(logDepthBufFC, color, texture = null) {
  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(color) },
      logDepthBufFC: { value: logDepthBufFC },
      lightDirection: { value: new THREE.Vector3(1, 1, 1).normalize() },
      diffuseMap: { value: texture },
      useTexture: { value: texture !== null },
    },
    vertexShader: HALO_SHELL_VS,
    fragmentShader: HALO_SHELL_FS,
    side: THREE.DoubleSide,
  });
}

// Factory for a simple ring (halo) shell geometry.
// Creates a segmented tubular wall with an inner gap (like a habitation shell).
// Parameters (scaled to scene units – this repo uses very large planetary scales):
//  - circleSegmentCount: number of radial segments (higher = smoother)
//  - radius: outer radius of the shell (center to outer wall)
//  - deckHeight: vertical height of the deck (thickness of base slab)
//  - wallInnerDrop: how far inward from outer radius the inner wall is (controls deck width)
//  - wallHeight: vertical height of the wall rising from deck top
//  - wallThickness: radial thickness of the wall (extrusion upward forming a lip)
//  - camera: required for logarithmic depth buffer calculations
//  - texture: optional THREE.Texture to apply to the shell
// Returns THREE.Mesh.
export function createProceduralHaloShell({
  circleSegmentCount = 128,
  radius = 400000.0,
  deckHeight = 4000.0,
  wallInnerDrop = 8000.0,
  wallHeight = 6000.0,
  wallThickness = 3000.0,
  color = 0x66ccff,
  camera = null,
  texture = null,
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

  // Calculate logarithmic depth buffer constant (same as scenery and terrain)
  if (!camera) {
    console.error("Camera is required for halo shell creation!");
    return null;
  }
  const logDepthBufFC = 2.0 / (Math.log(camera.far + 1.0) / Math.LN2);

  const material = _CreateHaloShellMaterial(logDepthBufFC, color, texture);
  
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "HaloShell";
  
  // Add method to update sun direction
  mesh.UpdateSunDirection = function(sunDirection) {
    if (this.material && this.material.uniforms && this.material.uniforms.lightDirection) {
      this.material.uniforms.lightDirection.value.copy(sunDirection);
    }
  };

  return mesh;
}

// Convenience helper to add the shell to a scene at a given center.
// Now requires camera parameter for logarithmic depth buffer support.
export function addHaloShellToScene(scene, center = new THREE.Vector3(), opts = {}) {
  if (!opts.camera) {
    console.error("Camera is required for addHaloShellToScene!");
    return null;
  }
  const shell = createProceduralHaloShell(opts);
  if (shell) {
    shell.position.copy(center);
    scene.add(shell);
  }
  return shell;
}

// Convenience wrapper specifically for creating the textured exterior halo shell.
// This centralizes the texture loading & parameter defaults so callers only provide
// the essentials (camera + radius overrides). Returns the created shell (may receive
// texture updates asynchronously once the image finishes loading).
export function addHaloExteriorShell(
  scene,
  center = new THREE.Vector3(),
  {
    camera = null,
    circleSegmentCount = 256,
    radius = 400000.0,
    deckHeight = 27000.0,
    wallInnerDrop = 8000.0,
    wallHeight = 5000.0,
    color = 0xffffff,
    texturePath = './resources/HaloExteriorTexture.png',
  } = {}
) {
  if (!camera) {
    console.error('Camera is required for addHaloExteriorShell!');
    return null;
  }

  const textureLoader = new THREE.TextureLoader();
  const haloTexture = textureLoader.load(texturePath, (texture) => {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.encoding = THREE.sRGBEncoding;
    console.log('Halo exterior texture loaded successfully');
    // Update material uniforms if shell already created
    if (shell && shell.material && shell.material.uniforms && shell.material.uniforms.diffuseMap) {
      shell.material.uniforms.diffuseMap.value = texture;
      shell.material.uniforms.useTexture.value = true;
    }
  });

  // Create shell immediately; texture will populate as it loads
  const shell = addHaloShellToScene(scene, center, {
    camera,
    circleSegmentCount,
    radius,
    deckHeight,
    wallInnerDrop,
    wallHeight,
    color,
    texture: haloTexture,
  });
  return shell;
}
