import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.181.0/build/three.module.js";
import { terrain_constants } from "./terrain-constants.js";
import { noise } from "./noise.js";
import { math } from "./math.js";

export const scenery_controller = (function () {
  // Tree dimensions
  const TREE_TRUNK_HEIGHT = 8.0;
  const TREE_TRUNK_RADIUS = 0.5;
  const TREE_FOLIAGE_RADIUS = 3.0;
  const TREE_FOLIAGE_HEIGHT = 6.0;
  const TREE_MIN_SCALE = 0.7;
  const TREE_MAX_SCALE = 1.4;

  // Tree colors
  const TREE_TRUNK_COLOR = 0x8b4513; // Brown
  const TREE_FOLIAGE_COLOR = 0x228b22; // Forest green

  // Rock dimensions
  const ROCK_MIN_SCALE = 0.4;
  const ROCK_MAX_SCALE = 2.5;
  const ROCK_COLOR = 0x696969; // Dim gray

  // Bush dimensions
  const BUSH_RADIUS = 1.5;
  const BUSH_HEIGHT = 1.0;
  const BUSH_MIN_SCALE = 0.6;
  const BUSH_MAX_SCALE = 1.5;
  const BUSH_COLOR = 0x2d5016; // Dark green

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
      this._shapeParams = params.shapeParams || {};

      // Map node keys to arrays of objects in that node
      this._objectsByNode = new Map();

      // Map node keys to their trees
      this._debugCubes = new Map(); // Keep name for compatibility, but stores trees

      // Map stable world positions (rounded grid coordinates) to scenery
      // This ensures scenery doesn't move when chunks subdivide
      this._sceneryByWorldPos = new Map();

      // Track scenery type (tree, rock, bush) for each position
      this._sceneryTypeByWorldPos = new Map();

      // Grid size for scenery placement (scenery only placed at fixed intervals)
      this._sceneryGridSize = 15.0; // Smaller = denser scenery (reduced from 250.0)

      // Maximum distance from camera to place scenery
      this._maxSceneryDistance = 1000.0; // Only place scenery within this distance

      // Number of scenery objects to spawn per chunk (scaled by chunk size)
      this._sceneryPerChunk = 100; // Base number of scenery objects per chunk
      this._treeRatio = 0.6; // 60% trees
      this._rockRatio = 0.25; // 25% rocks
      this._bushRatio = 0.15; // 15% bushes

      // Limit scenery spawned per frame to avoid lag
      this._maxSceneryPerFrame = 1; // Limit to prevent frame drops

      // Track which chunks have already spawned trees to avoid re-spawning
      this._processedChunks = new Set();

      // Track enabled state
      this._enabled = true;

      // Track tree spawn progress per chunk (how many trees have been attempted)
      this._chunkSpawnProgress = new Map(); // key -> number of trees attempted

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

    _GetSurfaceNormal(worldPosition) {
      // Calculate surface normal based on shape
      const direction = new THREE.Vector3();
      direction.copy(worldPosition);
      direction.sub(this._center);
      direction.normalize();

      if (this._shape === "ring") {
        // For ring, normal is negative of radial direction in XY plane
        const _D = direction.clone();
        const _EquatorDir = new THREE.Vector3(_D.x, 0, _D.z);
        if (_EquatorDir.lengthSq() < 1e-8) {
          _EquatorDir.set(1, 0, 0);
        } else {
          _EquatorDir.normalize();
        }
        return _EquatorDir.negate();
      } else {
        // For planet, normal is radial outward from center
        return direction;
      }
    }

    _CreateTree(worldPosition) {
      // Create a group to hold the tree parts
      const tree = new THREE.Group();

      // Random scale for variety
      const treeScale =
        TREE_MIN_SCALE + Math.random() * (TREE_MAX_SCALE - TREE_MIN_SCALE);

      // Create trunk (brown cylinder) with standard material
      const trunkGeometry = new THREE.CylinderGeometry(
        TREE_TRUNK_RADIUS * treeScale,
        TREE_TRUNK_RADIUS * treeScale,
        TREE_TRUNK_HEIGHT * treeScale,
        8
      );
      const trunkMaterial = new THREE.MeshStandardMaterial({
        color: TREE_TRUNK_COLOR,
        roughness: 1.0,
        metalness: 0.0,
      });
      const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
      trunk.position.y = (TREE_TRUNK_HEIGHT * treeScale) / 2;
      trunk.castShadow = false;
      trunk.receiveShadow = false;

      // Create foliage (green cone) with standard material
      const foliageGeometry = new THREE.ConeGeometry(
        TREE_FOLIAGE_RADIUS * treeScale,
        TREE_FOLIAGE_HEIGHT * treeScale,
        8
      );
      const foliageMaterial = new THREE.MeshStandardMaterial({
        color: TREE_FOLIAGE_COLOR,
        roughness: 1.0,
        metalness: 0.0,
      });
      const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
      foliage.position.y =
        TREE_TRUNK_HEIGHT * treeScale + (TREE_FOLIAGE_HEIGHT * treeScale) / 2;
      foliage.castShadow = true;
      foliage.receiveShadow = true;

      // Add parts to tree group
      tree.add(trunk);
      tree.add(foliage);

      // Position the tree at world position
      tree.position.copy(worldPosition);

      // Calculate surface normal based on shape
      const direction = this._GetSurfaceNormal(worldPosition);

      // Create a proper rotation to align tree's Y-axis with the surface normal
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

      // Add some random rotation around the surface normal for variation
      const randomRotation = Math.random() * Math.PI * 2;
      tree.rotateOnWorldAxis(direction, randomRotation);

      // Add tree to scene
      this._scene.add(tree);

      return tree;
    }

    _CreateRock(worldPosition) {
      // Create a group to hold the rock parts
      const rock = new THREE.Group();

      // Random scale for variety
      const scale =
        ROCK_MIN_SCALE + Math.random() * (ROCK_MAX_SCALE - ROCK_MIN_SCALE);

      // Create rock using an icosahedron for a more natural shape
      let rockGeometry = new THREE.IcosahedronGeometry(scale, 0);
      const rockMaterial = new THREE.MeshStandardMaterial({
        color: ROCK_COLOR,
        roughness: 1.0,
        metalness: 0.0,
      });

      // Convert to BufferGeometry if needed (handle old Geometry format)
      if (
        !rockGeometry.attributes &&
        rockGeometry.vertices &&
        rockGeometry.vertices.length > 0
      ) {
        // Convert old Geometry format to BufferGeometry
        const bufferGeometry = new THREE.BufferGeometry();
        const positions = [];
        const indices = [];

        // Convert vertices to positions array
        for (let i = 0; i < rockGeometry.vertices.length; i++) {
          const vertex = rockGeometry.vertices[i];
          positions.push(vertex.x, vertex.y, vertex.z);
        }

        // Convert faces to indices
        if (rockGeometry.faces) {
          for (let i = 0; i < rockGeometry.faces.length; i++) {
            const face = rockGeometry.faces[i];
            indices.push(face.a, face.b, face.c);
          }
        }

        bufferGeometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(positions, 3)
        );
        if (indices.length > 0) {
          bufferGeometry.setIndex(indices);
        }
        bufferGeometry.computeVertexNormals();
        rockGeometry = bufferGeometry;
      }

      // Add some random distortion for more natural look
      if (rockGeometry.attributes && rockGeometry.attributes.position) {
        const positions = rockGeometry.attributes.position;
        const positionArray = positions.array;
        for (let i = 0; i < positionArray.length; i += 3) {
          const noise = (Math.random() - 0.5) * 0.3;
          positionArray[i] *= 1 + noise; // x
          positionArray[i + 1] *= 1 + noise; // y
          positionArray[i + 2] *= 1 + noise; // z
        }
        positions.needsUpdate = true;
        rockGeometry.computeVertexNormals();
      }

      const rockMesh = new THREE.Mesh(rockGeometry, rockMaterial);
      rockMesh.castShadow = true;
      rockMesh.receiveShadow = true;

      rock.add(rockMesh);

      // Position the rock at world position
      rock.position.copy(worldPosition);

      // Calculate surface normal based on shape
      const direction = this._GetSurfaceNormal(worldPosition);

      // Align rock's Y-axis with the surface normal
      const up = new THREE.Vector3(0, 1, 0);
      const dot = up.dot(direction);

      if (Math.abs(dot) > 0.9999) {
        if (dot < 0) {
          rock.rotation.x = Math.PI;
        }
      } else {
        const axis = new THREE.Vector3();
        axis.crossVectors(up, direction);
        axis.normalize();
        const angle = Math.acos(dot);
        rock.quaternion.setFromAxisAngle(axis, angle);
      }

      // Add random rotation around the surface normal for variation
      const randomRotation = Math.random() * Math.PI * 2;
      rock.rotateOnWorldAxis(direction, randomRotation);

      // Add rock to scene
      this._scene.add(rock);

      return rock;
    }

    _CreateBush(worldPosition) {
      // Create a group to hold the bush parts
      const bush = new THREE.Group();

      // Random scale for variety
      const bushScale =
        BUSH_MIN_SCALE + Math.random() * (BUSH_MAX_SCALE - BUSH_MIN_SCALE);

      // Create bush using a sphere for the foliage
      const bushGeometry = new THREE.SphereGeometry(
        BUSH_RADIUS * bushScale,
        8,
        6
      );
      // Scale to make it more oval/ground-hugging
      bushGeometry.scale(1, BUSH_HEIGHT / BUSH_RADIUS, 1);
      const bushMaterial = new THREE.MeshStandardMaterial({
        color: BUSH_COLOR,
        roughness: 1.0,
        metalness: 0.0,
      });
      const bushMesh = new THREE.Mesh(bushGeometry, bushMaterial);
      bushMesh.position.y = BUSH_HEIGHT * bushScale;
      bushMesh.castShadow = true;
      bushMesh.receiveShadow = true;

      bush.add(bushMesh);

      // Position the bush at world position
      bush.position.copy(worldPosition);

      // Calculate surface normal based on shape
      const direction = this._GetSurfaceNormal(worldPosition);

      // Align bush's Y-axis with the surface normal
      const up = new THREE.Vector3(0, 1, 0);
      const dot = up.dot(direction);

      if (Math.abs(dot) > 0.9999) {
        if (dot < 0) {
          bush.rotation.x = Math.PI;
        }
      } else {
        const axis = new THREE.Vector3();
        axis.crossVectors(up, direction);
        axis.normalize();
        const angle = Math.acos(dot);
        bush.quaternion.setFromAxisAngle(axis, angle);
      }

      // Add random rotation around the surface normal for variation
      const randomRotation = Math.random() * Math.PI * 2;
      bush.rotateOnWorldAxis(direction, randomRotation);

      // Add bush to scene
      this._scene.add(bush);

      return bush;
    }

    _RemoveScenery(scenery) {
      if (scenery) {
        // Remove from scene
        this._scene.remove(scenery);

        // Dispose geometries and materials
        scenery.traverse((child) => {
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
        this._RemoveScenery(tree);
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
      let height = this._noise.Get(
        worldPosition.x,
        worldPosition.y,
        worldPosition.z
      );

      // Get the normal direction from the sphere center (radial direction)
      const normal = new THREE.Vector3();
      normal.copy(worldPosition);
      normal.sub(this._center);
      normal.normalize();

      let terrainPosition;
      if (this._shape === "ring") {
        // For ring, project onto ring geometry
        const _D = normal.clone();
        const latitudeValue = Math.abs(_D.y);

        // Calculate height mask for ring (same as terrain builder)
        const latCutoff = this._shapeParams.latCutoff || 0.02;
        const latFade = this._shapeParams.latFade || 0.05;
        const dropExponent = this._shapeParams.dropExponent || 1.5;

        const latCutoffClamped = Math.max(0.0, Math.min(1.0, latCutoff));
        const latFadeSafe = Math.max(1e-5, latFade);
        const blendRaw = Math.min(
          1.0,
          Math.max(0.0, (latitudeValue - latCutoffClamped) / latFadeSafe)
        );
        const heightMask = 1.0 - Math.pow(blendRaw, dropExponent);

        height *= heightMask;

        // Project onto ring
        const _EquatorDir = new THREE.Vector3(_D.x, 0, _D.z);
        if (_EquatorDir.lengthSq() < 1e-8) {
          _EquatorDir.set(1, 0, 0);
        } else {
          _EquatorDir.normalize();
        }

        const ringRadius = this._radius;
        const verticalOffset = _D.y * ringRadius;

        const _RadialDir = _EquatorDir.clone();

        terrainPosition = _RadialDir.clone().multiplyScalar(ringRadius);
        terrainPosition.y = verticalOffset;

        // Add height along the radial direction (negative for inward normal)
        const heightOffset = _RadialDir.clone().negate().multiplyScalar(height);
        terrainPosition.add(heightOffset);

        terrainPosition.add(this._center);
      } else {
        // For planet, use standard sphere projection
        terrainPosition = normal.clone().multiplyScalar(this._radius + height);
        terrainPosition.add(this._center);
      }

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
      // Skip update if disabled
      if (!this._enabled) {
        return;
      }

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

        // Calculate chunk size from bounds (size property may not be preserved in stored chunks)
        const dimensions = new THREE.Vector3();
        chunk.bounds.getSize(dimensions);
        const chunkSize = dimensions.x; // Use X dimension as chunk size

        // Only spawn scenery at much lower LOD levels (large chunks, far before highest detail)
        // Skip chunks that are at or near the highest LOD (minimum size) - only spawn on much larger chunks
        const minSize = terrain_constants.QT_MIN_CELL_SIZE;
        // Only spawn on chunks that are at least 10x the minimum size to ensure we're at much lower LOD
        // This means chunks must be >= 250 units (10 * 25) to spawn scenery
        const lodThreshold = minSize * 20.0;
        if (chunkSize < lodThreshold) {
          continue; // Skip chunks that are at or near highest LOD (too small - skip high detail chunks)
        }

        // Calculate chunk bounds in world space for random tree placement
        const chunkCenter = new THREE.Vector3();
        chunk.bounds.getCenter(chunkCenter);

        // Apply transform to get world space center for distance check
        const worldCenter = chunkCenter.clone();
        worldCenter.applyMatrix4(chunk.transform);
        worldCenter.normalize();

        if (this._shape === "ring") {
          // Project onto ring geometry
          const _D = worldCenter.clone();
          const _EquatorDir = new THREE.Vector3(_D.x, 0, _D.z);
          if (_EquatorDir.lengthSq() < 1e-8) {
            _EquatorDir.set(1, 0, 0);
          } else {
            _EquatorDir.normalize();
          }

          const ringRadius = this._radius;
          const verticalOffset = _D.y * ringRadius;

          worldCenter.copy(_EquatorDir).multiplyScalar(ringRadius);
          worldCenter.y = verticalOffset;
          worldCenter.add(this._center);
        } else {
          // For planet, scale by radius and add center
          worldCenter.multiplyScalar(this._radius);
          worldCenter.add(this._center);
        }

        // Early distance check - skip chunk if too far from camera
        const distanceToChunkCenter = cameraPosition.distanceTo(worldCenter);
        if (distanceToChunkCenter > this._maxSceneryDistance) {
          continue; // Skip this chunk - too far from camera
        }

        // Check if this chunk has already been fully processed
        if (this._processedChunks.has(key)) {
          // Chunk fully processed - skip spawning
          continue;
        }

        // Calculate number of scenery objects based on chunk size (more objects for larger chunks)
        const numScenery = Math.floor(
          this._sceneryPerChunk * (chunkSize / (minSize * 20.0))
        );

        // Get spawn progress for this chunk (how many scenery objects we've already attempted)
        const sceneryAttemptedSoFar = this._chunkSpawnProgress.get(key) || 0;

        // Use a seed based on chunk position for deterministic random placement
        const chunkSeed = `${chunkCenter.x},${chunkCenter.y},${chunkCenter.z}`;
        let seedValue = 0;
        for (let i = 0; i < chunkSeed.length; i++) {
          seedValue = (seedValue << 5) - seedValue + chunkSeed.charCodeAt(i);
          seedValue = seedValue & seedValue; // Convert to 32bit integer
        }

        // Simple seeded random function for deterministic placement
        let seed = Math.abs(seedValue);
        const seededRandom = () => {
          seed = (seed * 9301 + 49297) % 233280;
          return seed / 233280;
        };

        // Advance seeded random to where we left off (skip already attempted scenery)
        for (let i = 0; i < sceneryAttemptedSoFar; i++) {
          seededRandom();
        }

        // Limit scenery spawned per frame to avoid lag
        let scenerySpawnedThisFrame = 0;
        let sceneryAttemptedThisFrame = 0;

        // Spawn multiple scenery objects randomly across the chunk, starting from where we left off
        for (
          let i = sceneryAttemptedSoFar;
          i < numScenery && scenerySpawnedThisFrame < this._maxSceneryPerFrame;
          i++
        ) {
          sceneryAttemptedThisFrame++;
          // Generate random position within chunk bounds (in local space)
          const localX = (seededRandom() - 0.5) * chunkSize;
          const localY = (seededRandom() - 0.5) * chunkSize;
          const localZ = 0; // Chunk is on a plane

          // Create local position
          const localPos = new THREE.Vector3(localX, localY, localZ);
          localPos.add(chunkCenter);

          // Transform to world space
          const worldPos = localPos.clone();
          worldPos.applyMatrix4(chunk.transform);

          // Project onto surface (sphere or ring)
          worldPos.normalize();

          if (this._shape === "ring") {
            // Project onto ring geometry
            const _D = worldPos.clone();
            const _EquatorDir = new THREE.Vector3(_D.x, 0, _D.z);
            if (_EquatorDir.lengthSq() < 1e-8) {
              _EquatorDir.set(1, 0, 0);
            } else {
              _EquatorDir.normalize();
            }

            const ringRadius = this._radius;
            const verticalOffset = _D.y * ringRadius;

            worldPos.copy(_EquatorDir).multiplyScalar(ringRadius);
            worldPos.y = verticalOffset;
            worldPos.add(this._center);
          } else {
            // For planet, scale by radius and add center
            worldPos.multiplyScalar(this._radius);
            worldPos.add(this._center);
          }

          // Round to grid for stable position key
          const gridX =
            Math.round(worldPos.x / this._sceneryGridSize) *
            this._sceneryGridSize;
          const gridY =
            Math.round(worldPos.y / this._sceneryGridSize) *
            this._sceneryGridSize;
          const gridZ =
            Math.round(worldPos.z / this._sceneryGridSize) *
            this._sceneryGridSize;

          // Create stable grid position key
          const worldPosKey = `${gridX},${gridY},${gridZ}`;

          // Check if scenery already exists at this position
          if (this._sceneryByWorldPos.has(worldPosKey)) {
            activeWorldPositions.add(worldPosKey);
            continue; // Scenery already exists at this position
          }

          // Calculate distance from camera
          const distanceToCamera = cameraPosition.distanceTo(worldPos);

          // Only place scenery if within max distance
          if (distanceToCamera > this._maxSceneryDistance) {
            continue; // Skip this scenery - too far from camera
          }

          // Get terrain height at this position
          const terrainPosition = this._GetTerrainHeight(worldPos);

          // Determine which type of scenery to spawn based on ratios
          const rand = seededRandom();
          let scenery;
          let sceneryType;

          if (rand < this._treeRatio) {
            scenery = this._CreateTree(terrainPosition);
            sceneryType = "tree";
          } else if (rand < this._treeRatio + this._rockRatio) {
            scenery = this._CreateRock(terrainPosition);
            sceneryType = "rock";
          } else {
            scenery = this._CreateBush(terrainPosition);
            sceneryType = "bush";
          }

          this._sceneryByWorldPos.set(worldPosKey, scenery);
          this._sceneryTypeByWorldPos.set(worldPosKey, sceneryType);
          activeWorldPositions.add(worldPosKey);
          scenerySpawnedThisFrame++;

          // Track by chunk key for cleanup
          if (!this._objectsByNode.has(key)) {
            this._objectsByNode.set(key, []);
          }
        }

        // Update spawn progress for this chunk
        const totalAttempted =
          sceneryAttemptedSoFar + sceneryAttemptedThisFrame;
        this._chunkSpawnProgress.set(key, totalAttempted);

        // Mark chunk as fully processed if we've attempted all scenery
        if (totalAttempted >= numScenery) {
          this._processedChunks.add(key);
        }
      }

      // Clean up scenery that's too far from camera
      // Note: We don't remove scenery just because chunks subdivide - scenery persists by world position
      // Only remove if it's too far from camera
      const worldPosToRemove = [];
      for (const worldPosKey of this._sceneryByWorldPos.keys()) {
        const scenery = this._sceneryByWorldPos.get(worldPosKey);
        if (scenery) {
          const distanceToCamera = cameraPosition.distanceTo(scenery.position);
          // Only remove scenery if it's too far from camera
          // Don't remove based on activeWorldPositions - scenery should persist even when chunks subdivide
          if (distanceToCamera > this._maxSceneryDistance) {
            worldPosToRemove.push(worldPosKey);
          }
        }
      }

      // Remove scenery that's no longer referenced by any active chunks
      for (const worldPosKey of worldPosToRemove) {
        const scenery = this._sceneryByWorldPos.get(worldPosKey);
        if (scenery) {
          this._RemoveScenery(scenery);
          this._sceneryByWorldPos.delete(worldPosKey);
          this._sceneryTypeByWorldPos.delete(worldPosKey);

          // Remove from chunk key mapping
          for (const [chunkKey, chunkScenery] of this._debugCubes.entries()) {
            if (chunkScenery === scenery) {
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

      // Clean up processed chunks that no longer exist
      for (const chunkKey of this._processedChunks) {
        if (!currentChunks.has(chunkKey)) {
          this._processedChunks.delete(chunkKey);
        }
      }

      // Clean up spawn progress for chunks that no longer exist
      for (const chunkKey of this._chunkSpawnProgress.keys()) {
        if (!currentChunks.has(chunkKey)) {
          this._chunkSpawnProgress.delete(chunkKey);
        }
      }
    }

    SetEnabled(enabled) {
      this._enabled = enabled;
      if (enabled) {
        // Add all scenery objects back to scene
        for (const [
          worldPosKey,
          scenery,
        ] of this._sceneryByWorldPos.entries()) {
          if (scenery && scenery.parent !== this._scene) {
            this._scene.add(scenery);
          }
        }
      } else {
        // Remove all scenery objects from scene
        for (const [
          worldPosKey,
          scenery,
        ] of this._sceneryByWorldPos.entries()) {
          if (scenery && scenery.parent === this._scene) {
            this._scene.remove(scenery);
          }
        }
      }
    }
  }

  return {
    SceneryController: SceneryController,
  };
})();
