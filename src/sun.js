import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.112.1/build/three.module.js";

export const sun = (function () {
  class Sun {
    constructor(params) {
      this._params = params;
      this._Init(params);
    }

    _Init(params) {
      // Calculate sun direction matching existing lighting setup
      const sunDirection = new THREE.Vector3(1, 1, -1).normalize();
      // Position sun at much greater distance
      const sunDistance = 80000000;

      // Position sun at fixed distant location
      const sunPosition = sunDirection.clone().multiplyScalar(sunDistance);

      // Create sphere geometry for the sun
      // Radius scaled proportionally to maintain same apparent size
      // Ratio: radius/distance = 200K/8M = 0.025
      // At 80M distance: radius = 80M * 0.025 = 2M
      const geometry = new THREE.SphereGeometry(2000000, 32, 32);

      // Create emissive material for glowing effect
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffaa,
        emissive: 0xffaa44,
        emissiveIntensity: 1.0,
      });

      // Create the sun mesh
      this._mesh = new THREE.Mesh(geometry, material);
      this._mesh.position.copy(sunPosition);
      this._mesh.frustumCulled = false; // Ensure sun is always visible

      // Add to scene
      params.scene.add(this._mesh);
    }

    Update(timeInSeconds) {
      // Reserved for future use if needed
    }
  }

  return {
    Sun: Sun,
  };
})();
