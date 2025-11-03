import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.112.1/build/three.module.js";
import { terrain_constants } from "./terrain-constants.js";
import { noise } from "./noise.js";
import { math } from "./math.js";

export const scenery_controller = (function () {
  // Tree dimensions
  const TREE_TRUNK_HEIGHT = 8.0;
  const TREE_TRUNK_RADIUS = 0.5;
  const TREE_FOLIAGE_RADIUS = 3.0;
  const TREE_FOLIAGE_HEIGHT = 6.0;

  // Tree colors
  const TREE_TRUNK_COLOR = 0x8b4513; // Brown
  const TREE_FOLIAGE_COLOR = 0x228b22; // Forest green

  // Shader code for tree materials (same as debug cube shader)
  const TREE_VS = `#version 300 es
precision highp float;

out float vFragDepth;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vec4 clipPosition = projectionMatrix * mvPosition;
  gl_Position = clipPosition;
  vFragDepth = 1.0 + clipPosition.w;
}
`;

  const TREE_FS = `#version 300 es
precision highp float;

uniform vec3 color;
uniform float logDepthBufFC;

in float vFragDepth;

out vec4 out_FragColor;

void main() {
  out_FragColor = vec4(color, 1.0);
  gl_FragDepth = log2(vFragDepth) * logDepthBufFC * 0.5;
}
`;

  function _CreateTreeMaterial(logDepthBufFC, color) {
    return new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(color) },
        logDepthBufFC: { value: logDepthBufFC },
      },
      vertexShader: TREE_VS,
      fragmentShader: TREE_FS,
      glslVersion: THREE.GLSL3,
    });
  }

  class SceneryController {
    constructor(params) {
      this._params = params;
      this._scene = params.scene;
      this._camera = params.camera;
      this._terrainManager = params.terrainManager;
      this._radius = params.radius || terrain_constants.PLANET_RADIUS;
      this._center = params.center
        ? params.center.clone()
        : new THREE.Vector3(0, 0, 0);
      this._shape = params.shape || "planet";

      this._logDepthBufFC = 2.0 / (Math.log(this._camera.far + 1.0) / Math.LN2);

      // Map node keys to arrays of objects in that node
      this._objectsByNode = new Map();

      // Map node keys to their trees
      this._debugCubes = new Map(); // Keep name for compatibility, but stores trees

      // Map stable world positions (rounded grid coordinates) to scenery
      // This ensures scenery doesn't move when chunks subdivide
      this._sceneryByWorldPos = new Map();

      // Grid size for scenery placement (scenery only placed at fixed intervals)
      this._sceneryGridSize = 15.0; // Smaller = denser scenery (reduced from 250.0)

      // Maximum distance from camera to place scenery
      this._maxSceneryDistance = 1000.0; // Only place scenery within this distance

      // Initialize noise for height calculation
      const noiseParams = {
        octaves: 13,
        persistence: 0.5,
        lacunarity: 1.6,
        exponentiation: 7.5,
        height: terrain_constants.NOISE_HEIGHT,
        scale: terrain_constants.NOISE_SCALE,
        seed: 1,
      };
      this._noise = new noise.Noise(noiseParams);

      // Initialize biome noise
      const biomeParams = {
        octaves: 2,
        persistence: 0.5,
        lacunarity: 2.0,
        scale: 2048.0,
        noiseType: "simplex",
        seed: 2,
        exponentiation: 1,
        height: 1.0,
      };
      this._biomeNoise = new noise.Noise(biomeParams);
    }

    _CreateTree(worldPosition) {
      // Create a group to hold the tree parts
      const tree = new THREE.Group();

      // Create trunk (brown cylinder) with shader material
      const trunkGeometry = new THREE.CylinderGeometry(
        TREE_TRUNK_RADIUS,
        TREE_TRUNK_RADIUS,
        TREE_TRUNK_HEIGHT,
        8
      );
      const trunkMaterial = _CreateTreeMaterial(
        this._logDepthBufFC,
        TREE_TRUNK_COLOR
      );
      const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
      trunk.position.y = TREE_TRUNK_HEIGHT / 2;
      trunk.castShadow = false;
      trunk.receiveShadow = false;

      // Create foliage (green cone) with shader material
      const foliageGeometry = new THREE.ConeGeometry(
        TREE_FOLIAGE_RADIUS,
        TREE_FOLIAGE_HEIGHT,
        8
      );
      const foliageMaterial = _CreateTreeMaterial(
        this._logDepthBufFC,
        TREE_FOLIAGE_COLOR
      );
      const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
      foliage.position.y = TREE_TRUNK_HEIGHT + TREE_FOLIAGE_HEIGHT / 2;
      foliage.castShadow = true;
      foliage.receiveShadow = true;

      // Add parts to tree group
      tree.add(trunk);
      tree.add(foliage);

      // Position the tree at world position
      tree.position.copy(worldPosition);

      // Calculate direction from planet center to tree position (radial outward = surface normal)
      const direction = new THREE.Vector3();
      direction.copy(worldPosition);
      direction.sub(this._center);
      direction.normalize();

      // Create a proper rotation to align tree's Y-axis with the radial direction
      // Use a more robust method that handles edge cases
      const up = new THREE.Vector3(0, 1, 0);
      const dot = up.dot(direction);

      // Handle parallel vectors (pointing same or opposite direction)
      if (Math.abs(dot) > 0.9999) {
        // Nearly parallel - use identity or flip
        if (dot < 0) {
          // Opposite direction - rotate 180 degrees around X or Z axis
          tree.rotation.x = Math.PI;
        }
      } else {
        // Calculate rotation axis (cross product)
        const axis = new THREE.Vector3();
        axis.crossVectors(up, direction);
        axis.normalize();

        // Calculate angle
        const angle = Math.acos(dot);

        // Set quaternion
        tree.quaternion.setFromAxisAngle(axis, angle);
      }

      // Add some random rotation around the radial axis (Y-axis after rotation) for variation
      const randomRotation = Math.random() * Math.PI * 2;
      tree.rotateOnWorldAxis(direction, randomRotation);

      // Add tree to scene
      this._scene.add(tree);

      return tree;
    }

    _RemoveTree(tree) {
      if (tree) {
        // Remove from scene
        this._scene.remove(tree);

        // Dispose geometries and materials
        tree.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            if (child.geometry) {
              child.geometry.dispose();
            }
            if (child.material) {
              if (Array.isArray(child.material)) {
                child.material.forEach((m) => m.dispose());
              } else {
                child.material.dispose();
              }
            }
          }
        });
      }
    }

    _SpawnDebugObject(nodeKey, worldPosition) {
      // Spawn a tree at the node position
      if (!this._debugCubes.has(nodeKey)) {
        const tree = this._CreateTree(worldPosition);
        this._debugCubes.set(nodeKey, tree);

        // Initialize object list for this node if it doesn't exist
        if (!this._objectsByNode.has(nodeKey)) {
          this._objectsByNode.set(nodeKey, []);
        }
      }
    }

    _RemoveNodeObjects(nodeKey) {
      // Remove tree
      const tree = this._debugCubes.get(nodeKey);
      if (tree) {
        this._RemoveTree(tree);
        this._debugCubes.delete(nodeKey);
      }

      // Remove all objects in this node from scene
      const objects = this._objectsByNode.get(nodeKey);
      if (objects) {
        for (const obj of objects) {
          if (obj && obj.parent) {
            this._scene.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
              if (Array.isArray(obj.material)) {
                obj.material.forEach((m) => m.dispose());
              } else {
                obj.material.dispose();
              }
            }
          }
        }
        this._objectsByNode.delete(nodeKey);
      }
    }

    // Get height of terrain at a given world position
    _GetTerrainHeight(worldPosition) {
      // Sample noise at the world position
      const height = this._noise.Get(
        worldPosition.x,
        worldPosition.y,
        worldPosition.z
      );

      // Get the normal direction from the sphere center (radial direction)
      const normal = new THREE.Vector3();
      normal.copy(worldPosition);
      normal.sub(this._center);
      normal.normalize();

      // Return the actual terrain position on the sphere with height
      const terrainPosition = normal
        .clone()
        .multiplyScalar(this._radius + height);
      terrainPosition.add(this._center);

      return terrainPosition;
    }

    // Get biome type at a given world position
    _GetBiome(worldPosition) {
      const m = this._biomeNoise.Get(
        worldPosition.x,
        worldPosition.y,
        worldPosition.z
      );
      const h = math.sat(worldPosition.y / 100.0);

      if (h < 0.05) {
        return "desert";
      } else if (m > 0.5) {
        return "forest";
      } else {
        return "arid";
      }
    }

    Update() {
      // Use terrain chunks instead of building our own quadtree
      const chunks = this._terrainManager.GetChunks();

      // Collect all current chunk keys from terrain
      const currentChunks = new Set();
      for (const key in chunks) {
        currentChunks.add(key);
      }

      // Track which world positions have scenery in current chunks (only near camera)
      const activeWorldPositions = new Set();

      // Get camera position
      const cameraPosition = this._camera.position.clone();

      // Process each terrain chunk
      for (const key in chunks) {
        const chunk = chunks[key];

        // Calculate world center from chunk bounds
        const center = new THREE.Vector3();
        chunk.bounds.getCenter(center);

        // Apply transform to get world space position
        center.applyMatrix4(chunk.transform);

        // Normalize to sphere surface and scale by radius
        center.normalize();
        center.multiplyScalar(this._radius);

        // Round to grid FIRST to get stable position
        const gridX =
          Math.round(center.x / this._sceneryGridSize) * this._sceneryGridSize;
        const gridY =
          Math.round(center.y / this._sceneryGridSize) * this._sceneryGridSize;
        const gridZ =
          Math.round(center.z / this._sceneryGridSize) * this._sceneryGridSize;

        // Create stable grid position
        const gridPosition = new THREE.Vector3(gridX, gridY, gridZ);

        // Normalize grid position back to sphere surface for height calculation
        gridPosition.normalize();
        gridPosition.multiplyScalar(this._radius);

        // Get terrain height at the stable grid position (for positioning the tree)
        const terrainPosition = this._GetTerrainHeight(gridPosition);

        // Calculate distance from camera to scenery position
        const distanceToCamera = cameraPosition.distanceTo(terrainPosition);

        // Only place scenery if within max distance
        if (distanceToCamera > this._maxSceneryDistance) {
          continue; // Skip this chunk - too far from camera
        }

        // Use stable world position key (grid-based) before height calculation
        // This ensures the key is deterministic regardless of terrain height
        const worldPosKey = `${gridX},${gridY},${gridZ}`;
        activeWorldPositions.add(worldPosKey);

        // Only create scenery if it doesn't already exist at this world position
        if (!this._sceneryByWorldPos.has(worldPosKey)) {
          // Create tree at this stable world position (grid-aligned)
          const tree = this._CreateTree(terrainPosition);
          this._sceneryByWorldPos.set(worldPosKey, tree);

          // Also track by chunk key for cleanup
          if (!this._debugCubes.has(key)) {
            this._debugCubes.set(key, tree);
          }

          // Initialize object list for this node if it doesn't exist
          if (!this._objectsByNode.has(key)) {
            this._objectsByNode.set(key, []);
          }
        } else {
          // Scenery already exists at this world position, just track the chunk key
          const existingTree = this._sceneryByWorldPos.get(worldPosKey);
          if (!this._debugCubes.has(key)) {
            this._debugCubes.set(key, existingTree);
          }
        }
      }

      // Clean up scenery for world positions that no longer have any active chunks
      // Also remove scenery that's too far from camera
      const worldPosToRemove = [];
      for (const worldPosKey of this._sceneryByWorldPos.keys()) {
        const shouldRemove = !activeWorldPositions.has(worldPosKey);

        // Also check distance if scenery exists but is now too far away
        if (!shouldRemove) {
          const tree = this._sceneryByWorldPos.get(worldPosKey);
          if (tree) {
            const distanceToCamera = cameraPosition.distanceTo(tree.position);
            if (distanceToCamera > this._maxSceneryDistance) {
              worldPosToRemove.push(worldPosKey);
            }
          }
        } else {
          worldPosToRemove.push(worldPosKey);
        }
      }

      // Remove scenery that's no longer referenced by any active chunks
      for (const worldPosKey of worldPosToRemove) {
        const tree = this._sceneryByWorldPos.get(worldPosKey);
        if (tree) {
          this._RemoveTree(tree);
          this._sceneryByWorldPos.delete(worldPosKey);

          // Remove from chunk key mapping
          for (const [chunkKey, chunkTree] of this._debugCubes.entries()) {
            if (chunkTree === tree) {
              this._debugCubes.delete(chunkKey);
            }
          }
        }
      }

      // Clean up chunk keys that no longer exist
      for (const nodeKey of this._objectsByNode.keys()) {
        if (!currentChunks.has(nodeKey)) {
          // Only remove object list, not the tree (it's managed by world position)
          this._objectsByNode.delete(nodeKey);
          this._debugCubes.delete(nodeKey);
        }
      }
    }
  }

  return {
    SceneryController: SceneryController,
  };
})();
