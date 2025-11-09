export const ocean_shader = (function () {
  const _VS = `#version 300 es

precision highp float;

uniform float time;
uniform float distortionScale;
uniform float size;

// position, normal, and uv are provided by Three.js automatically
// No need to declare them here to avoid redefinition errors

out vec2 vUV;
out vec3 vNormal;
out vec3 vWorldPos;
out vec3 vEyeDirection;
out float vFragDepth;

#define saturate(a) clamp( a, 0.0, 1.0 )

// Gerstner wave function
vec3 gerstnerWave(vec2 pos, float amplitude, float frequency, vec2 direction, float speed) {
  float phase = dot(direction, pos) * frequency + time * speed;
  float c = cos(phase);
  float s = sin(phase);
  
  vec3 result;
  result.x = direction.x * amplitude * c;
  result.z = direction.y * amplitude * c;
  result.y = amplitude * s;
  
  return result;
}

void main() {
  mat4 terrainMatrix = mat4(
      viewMatrix[0],
      viewMatrix[1],
      viewMatrix[2],
      vec4(0.0, 0.0, 0.0, 1.0));

  // Calculate world position for wave calculations
  vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  
  // Disable Gerstner waves - rely on normal map for wave detail
  // The spherical projection makes it difficult to get appropriate wave scale
  vec3 wave = vec3(0.0);
  
  // Displace along normal (spherical surface) in local space
  vec3 displacedPos = position;
  
  // Calculate final world position after displacement
  vec3 finalWorldPos = (modelMatrix * vec4(displacedPos, 1.0)).xyz;
  
  // Fixed: Include modelMatrix in projection calculation (matches terrain shader)
  gl_Position = projectionMatrix * terrainMatrix * modelMatrix * vec4(displacedPos, 1.0);
  
  vUV = uv;
  vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
  vWorldPos = finalWorldPos;
  vEyeDirection = normalize(finalWorldPos - cameraPosition);
  
  vFragDepth = 1.0 + gl_Position.w;
}
  `;

  const _PS = `#version 300 es

precision highp float;

uniform float time;
uniform float distortionScale;
uniform float logDepthBufFC;
uniform sampler2D waterNormals;
uniform float uvScale;
uniform float animationSpeed;
uniform vec2 layer1Speed;
uniform vec2 layer2Speed;
uniform float normalIntensity;
uniform vec3 sunDirection;
uniform float ambientLightIntensity;
uniform vec3 planetPosition;

in vec2 vUV;
in vec3 vNormal;
in vec3 vWorldPos;
in vec3 vEyeDirection;
in float vFragDepth;

out vec4 out_FragColor;

#define saturate(a) clamp( a, 0.0, 1.0 )

void main() {
  vec3 sunDir = normalize(sunDirection);
  vec3 worldNormal = normalize(vNormal);
  
  // Reconstruct true world position
  // The mesh position is set to (origin - cameraPosition) for camera-relative rendering
  // So we need to add cameraPosition back to get the true world position
  vec3 trueWorldPos = vWorldPos + cameraPosition;
  
  // Sample normal map using spherical UV coordinates to avoid pole stretching
  // Convert world position to spherical coordinates (latitude/longitude)
  vec3 normalizedPos = normalize(trueWorldPos - planetPosition);
  float longitude = atan(normalizedPos.z, normalizedPos.x);
  float latitude = asin(normalizedPos.y);
  
  // Create UV coordinates from spherical coordinates
  // Multiply by uvScale and a large factor to create very small wave patterns
  vec2 baseUV = vec2(longitude, latitude) * uvScale * 100000.0;
  
  // Animate UV coordinates by scrolling over time (reduced speed)
  // Two layers with different speeds and directions for more complex water movement
  vec2 uv1 = baseUV + layer1Speed * time * animationSpeed;  // First layer - diagonal scroll
  vec2 uv2 = baseUV + layer2Speed * time * animationSpeed; // Second layer - different direction
  
  // Sample normal map twice
  vec3 normalMapSample1 = texture(waterNormals, uv1).xyz;
  vec3 normalMapSample2 = texture(waterNormals, uv2).xyz;
  
  // Convert both samples to tangent space normals
  vec3 tangentNormal1 = normalMapSample1 * vec3(2.0, 2.0, 2.0) - vec3(1.0, 1.0, 1.0);
  vec3 tangentNormal2 = normalMapSample2 * vec3(2.0, 2.0, 2.0) - vec3(1.0, 1.0, 1.0);
  
  // Blend the tangent-space normals (better than blending RGB)
  vec3 tangentNormal = normalize(tangentNormal1 + tangentNormal2);
  
  
  // Build TBN matrix to transform tangent-space normals to world space
  vec3 tangent = normalize(cross(worldNormal, vec3(0, 1, 0)));
  if (length(tangent) < 0.001) {
    tangent = normalize(cross(worldNormal, vec3(1, 0, 0)));
  }
  vec3 bitangent = cross(worldNormal, tangent);
  mat3 tbn = mat3(tangent, bitangent, worldNormal);
  
  // Transform tangent-space normal to world space
  vec3 worldNormalMap = normalize(tbn * tangentNormal);
  
  // Apply normal map with intensity control
  // Use normalIntensity to control the blend between base normal and normal map
  float blendAmount = saturate(normalIntensity);
  vec3 perturbedNormal = normalize(mix(worldNormal, worldNormalMap, blendAmount));
  
  // Debug: Uncomment to visualize normal map directly (will show as colors)
  // perturbedNormal = worldNormalMap * 0.5 + 0.5; // Shows normal map as color
  
  // Fresnel effect
  float fresnel = pow(1.0 - max(dot(-vEyeDirection, perturbedNormal), 0.0), 2.0);
  
  // Specular reflection
  // Calculate direction from surface to camera (view direction)
  vec3 viewDir = -vEyeDirection; // Direction from surface to camera
  // Reflect the light direction (from sun) off the normal to get reflection direction
  // Light comes FROM sun, so we negate sunDir to get direction from sun to surface
  vec3 lightDir = -sunDir; // Direction from surface towards sun (light source)
  vec3 reflectDir = reflect(lightDir, perturbedNormal);
  // Check if reflection direction matches view direction (we see the sun)
  float specular = pow(max(dot(reflectDir, viewDir), 0.0), 64.0);
  
  // Water color - deep blue base
  vec3 deepWaterColor = vec3(0.02, 0.12, 0.25);
  vec3 shallowWaterColor = vec3(0.08, 0.20, 0.35);
  
  // Calculate depth (distance from center of planet)
  float depthFactor = saturate(length(trueWorldPos) / 400000.0);
  vec3 waterColor = mix(deepWaterColor, shallowWaterColor, depthFactor * 0.3);
  
  // Lighting
  float NdotL = max(dot(perturbedNormal, sunDir), 0.0);
  vec3 diffuse = waterColor * (ambientLightIntensity + (1.0 - ambientLightIntensity) * NdotL);
  
  // Add specular highlight
  vec3 finalColor = diffuse + vec3(1.0) * specular * 0.5;
  
  // Apply fresnel for more realistic water
  vec3 skyColor = vec3(0.5, 0.7, 1.0);
  finalColor = mix(finalColor, skyColor * 0.8, fresnel * 0.3);
  
  // Add wave foam at peaks
  float foam = saturate((dot(perturbedNormal, vec3(0, 1, 0)) - 0.7) * 5.0);
  foam *= saturate(specular * 2.0);
  finalColor += vec3(1.0) * foam * 0.2;
  
  // Bit of a hack to remove lighting on dark side of planet
  // Use planet position to calculate proper radial normal from planet center
  // Use trueWorldPos (not vWorldPos) since mesh position is camera-relative
  vec3 planetNormal = normalize(trueWorldPos - planetPosition);
  float planetLighting = saturate(dot(planetNormal, sunDir));
  finalColor *= ambientLightIntensity + (1.0 - ambientLightIntensity) * planetLighting;
  
  // Ocean visibility - keep it simple and visible
  float alpha = 0.8;
  
  out_FragColor = vec4(finalColor, alpha);
  gl_FragDepth = log2(vFragDepth) * logDepthBufFC * 0.5;
}
  `;

  return {
    VS: _VS,
    PS: _PS,
  };
})();
