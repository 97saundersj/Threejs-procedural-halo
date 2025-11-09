import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.112.1/build/three.module.js";

import { quadtree } from "./quadtree.js";
import { ocean_shader } from "./ocean-shader.js";
import { terrain_constants } from "./terrain-constants.js";
import { utils } from "./utils.js";

export const ocean = (function () {
  class OceanChunkManager {
    constructor(params) {
      this._Init(params);
    }

    _Init(params) {
      this._params = params;
      this._params.guiParams = this._params.guiParams || {};

      // Ocean minimum cell size (double terrain's for better performance - fewer chunks)
      this._minCellSize = terrain_constants.QT_MIN_CELL_SIZE * 2000.0;

      // Ocean should be at sea level
      // For planet shapes: slightly above terrain base radius (add 10 units)
      // For ring shapes: slightly below terrain base radius (subtract 10 units)
      // Terrain base is at radius, terrain has height variations that go up from there
      // Default to 400010.0 (10 units above PLANET_RADIUS) if no radius provided
      const isRing = params.shape === "ring";
      if (params.radius) {
        this._radius = isRing ? params.radius - 10.0 : params.radius + 10.0;
      } else {
        this._radius = 400010.0;
      }
      this._center = params.center
        ? params.center.clone()
        : new THREE.Vector3(0, 0, 0);
      this._shape = params.shape || "planet";
      this._shapeParams = params.shapeParams || {};

      // Load water normals texture
      const loader = new THREE.TextureLoader();
      const waterNormalsTexture = loader.load("./resources/waternormals.jpg");
      waterNormalsTexture.wrapS = THREE.RepeatWrapping;
      waterNormalsTexture.wrapT = THREE.RepeatWrapping;
      waterNormalsTexture.minFilter = THREE.LinearMipMapLinearFilter;
      waterNormalsTexture.magFilter = THREE.LinearFilter;
      waterNormalsTexture.generateMipmaps = true;

      // Ocean material
      this._material = new THREE.ShaderMaterial({
        uniforms: {
          time: {
            value: 0.0,
          },
          distortionScale: {
            value: 1.0,
          },
          size: {
            value: 1.0,
          },
          logDepthBufFC: {
            value: 2.0 / (Math.log(params.camera.far + 1.0) / Math.LN2),
          },
          waterNormals: {
            value: waterNormalsTexture,
          },
          uvScale: {
            value: 0.1,
          },
          animationSpeed: {
            value: 2,
          },
          layer1Speed: {
            value: new THREE.Vector2(0.05, 0.03),
          },
          layer2Speed: {
            value: new THREE.Vector2(-0.04, 0.06),
          },
          normalIntensity: {
            value: 3.0,
          },
          sunDirection: {
            value: new THREE.Vector3(1, 1, -1).normalize(),
          },
          ambientLightIntensity: {
            value: terrain_constants.AMBIENT_LIGHT_INTENSITY,
          },
          planetPosition: {
            value: new THREE.Vector3(0, 0, 0),
          },
        },
        vertexShader: ocean_shader.VS,
        fragmentShader: ocean_shader.PS,
        side: THREE.FrontSide,
        transparent: true,
        depthWrite: false, // Disable depth writing for transparent objects
        depthTest: true, // Enable depth testing to properly occlude behind terrain
      });

      // GUI params
      params.guiParams.ocean = {
        radius: this._radius,
        distortionScale: 1.0,
        size: 1.0,
        uvScale: 0.1,
        animationSpeed: 2,
        layer1SpeedX: 0.05,
        layer1SpeedY: 0.03,
        layer2SpeedX: -0.04,
        layer2SpeedY: 0.06,
        normalIntensity: 3.0,
      };

      if (params.gui) {
        const oceanRollup = params.gui.addFolder("Ocean");

        // Basic ocean settings
        oceanRollup
          .add(params.guiParams.ocean, "radius", 100000.0, 800000.0)
          .onChange((value) => {
            this._radius = value;
            // Clear all chunks so they rebuild with new radius
            this._ClearAllChunks();
          });
        oceanRollup
          .add(params.guiParams.ocean, "distortionScale", 0.0, 2.0)
          .onChange((value) => {
            this._material.uniforms.distortionScale.value = value;
          });
        oceanRollup
          .add(params.guiParams.ocean, "size", 0.1, 5.0)
          .onChange((value) => {
            this._material.uniforms.size.value = value;
          });

        // Normal map settings
        oceanRollup
          .add(params.guiParams.ocean, "uvScale", 0.0001, 0.5)
          .name("UV Scale")
          .onChange((value) => {
            this._material.uniforms.uvScale.value = value;
          });
        oceanRollup
          .add(params.guiParams.ocean, "normalIntensity", 0.0, 5.0)
          .name("Normal Intensity")
          .onChange((value) => {
            this._material.uniforms.normalIntensity.value = value;
          });

        // Animation settings
        oceanRollup
          .add(params.guiParams.ocean, "animationSpeed", 0.0, 5.0)
          .name("Animation Speed")
          .onChange((value) => {
            this._material.uniforms.animationSpeed.value = value;
          });

        // Layer 1 animation
        const layer1Folder = oceanRollup.addFolder("Layer 1 Animation");
        layer1Folder
          .add(params.guiParams.ocean, "layer1SpeedX", -2, 2)
          .name("Speed X")
          .onChange((value) => {
            this._material.uniforms.layer1Speed.value.x = value;
          });
        layer1Folder
          .add(params.guiParams.ocean, "layer1SpeedY", -2, 2)
          .name("Speed Y")
          .onChange((value) => {
            this._material.uniforms.layer1Speed.value.y = value;
          });

        // Layer 2 animation
        const layer2Folder = oceanRollup.addFolder("Layer 2 Animation");
        layer2Folder
          .add(params.guiParams.ocean, "layer2SpeedX", -2, 2)
          .name("Speed X")
          .onChange((value) => {
            this._material.uniforms.layer2Speed.value.x = value;
          });
        layer2Folder
          .add(params.guiParams.ocean, "layer2SpeedY", -2, 2)
          .name("Speed Y")
          .onChange((value) => {
            this._material.uniforms.layer2Speed.value.y = value;
          });
      }

      this._InitOcean(params);

      this._totalTime = 0.0;
    }

    _InitOcean(params) {
      this._groups = [...new Array(6)].map((_) => new THREE.Group());
      params.scene.add(...this._groups);

      this._chunks = {};
      this._params = params;
    }

    _ClearAllChunks() {
      // Remove all existing chunks from the scene
      for (let k in this._chunks) {
        const chunk = this._chunks[k];
        if (chunk.mesh && chunk.group) {
          chunk.group.remove(chunk.mesh);
          if (chunk.geometry) {
            chunk.geometry.dispose();
          }
        }
      }
      // Clear the chunks dictionary so they rebuild on next update
      this._chunks = {};
    }

    _CreateOceanChunk(group, groupTransform, offset, width, resolution) {
      // Create a plane geometry for the ocean surface
      // Use PlaneBufferGeometry for Three.js r112 (which has attributes)
      const geometry = new THREE.PlaneBufferGeometry(
        width,
        width,
        resolution,
        resolution
      );

      // Ensure normals are computed
      geometry.computeVertexNormals();

      // Transform vertices to spherical surface
      // In Three.js r112, access attributes via geometry.attributes
      if (!geometry.attributes) {
        console.error("Ocean geometry missing attributes object", geometry);
        return null;
      }

      const positionAttribute = geometry.attributes.position;
      const normalAttribute = geometry.attributes.normal;

      if (!positionAttribute) {
        console.error(
          "Ocean geometry missing position attribute",
          geometry.attributes
        );
        return null;
      }

      if (!normalAttribute) {
        geometry.computeVertexNormals();
      }

      const positions = positionAttribute.array;
      const normals = normalAttribute ? normalAttribute.array : null;
      const indices = geometry.index ? geometry.index.array : null;

      const tempPos = new THREE.Vector3();
      const tempNormal = new THREE.Vector3();
      const localPos = new THREE.Vector3();
      const worldCenter = new THREE.Vector3();
      const _D = new THREE.Vector3();
      const _EquatorDir = new THREE.Vector3();
      const _RadialDir = new THREE.Vector3();

      const oceanRadius = this._radius;
      const isRing = this._shape === "ring";

      // For ring shapes, track latitude for each vertex to cull faces
      const latitudes = isRing ? [] : null;
      const cullLatitude = isRing
        ? this._shapeParams.cullLatitude !== undefined
          ? this._shapeParams.cullLatitude
          : 0.08
        : Infinity;

      // Calculate the world-space center of this chunk
      tempPos.copy(offset);
      tempPos.applyMatrix4(groupTransform);
      tempPos.normalize();

      if (isRing) {
        // For ring, calculate position on the ring
        _D.copy(tempPos);
        const latitudeValue = Math.abs(_D.y);
        _EquatorDir.set(_D.x, 0, _D.z);
        if (_EquatorDir.lengthSq() < 1e-8) {
          _EquatorDir.set(1, 0, 0);
        } else {
          _EquatorDir.normalize();
        }
        _RadialDir.copy(_EquatorDir);
        const verticalOffset = _D.y * oceanRadius;
        worldCenter.copy(_RadialDir).multiplyScalar(oceanRadius);
        worldCenter.y = verticalOffset;
        worldCenter.add(this._center);
      } else {
        // For planet shapes, center is at origin
        worldCenter.copy(tempPos);
        worldCenter.multiplyScalar(oceanRadius);
      }

      for (let i = 0; i < positions.length; i += 3) {
        // Get local position (before transform)
        localPos.set(positions[i], positions[i + 1], positions[i + 2]);

        // Transform to world space coordinates (for sphere projection)
        tempPos.copy(localPos);
        tempPos.add(offset);
        tempPos.applyMatrix4(groupTransform);

        if (isRing) {
          // Project onto ring at ocean level
          tempPos.normalize();
          _D.copy(tempPos);
          const latitudeValue = Math.abs(_D.y);

          // Store latitude for this vertex (for face culling)
          latitudes.push(latitudeValue);

          _EquatorDir.set(_D.x, 0, _D.z);
          if (_EquatorDir.lengthSq() < 1e-8) {
            _EquatorDir.set(1, 0, 0);
          } else {
            _EquatorDir.normalize();
          }

          _RadialDir.copy(_EquatorDir);
          const verticalOffset = _D.y * oceanRadius;

          // Position on ring
          tempPos.copy(_RadialDir).multiplyScalar(oceanRadius);
          tempPos.y = verticalOffset;
          tempPos.add(this._center);

          // For ring, use a placeholder normal - it will be recomputed from geometry
          // This ensures correct facing based on face winding
          // Use a basic upward normal as placeholder (will be overridden)
          tempNormal.set(0, 1, 0);
        } else {
          // Project onto sphere at ocean level
          tempPos.normalize();
          tempNormal.copy(tempPos);

          // Scale to ocean radius (at planet radius for sea level)
          // For planet shapes, position relative to origin (no center offset)
          tempPos.multiplyScalar(oceanRadius);
        }

        // Store position relative to chunk center (for positioning relative to camera)
        tempPos.sub(worldCenter);
        positions[i] = tempPos.x;
        positions[i + 1] = tempPos.y;
        positions[i + 2] = tempPos.z;

        // Store normal (pointing outward from sphere/ring)
        if (normals) {
          normals[i] = tempNormal.x;
          normals[i + 1] = tempNormal.y;
          normals[i + 2] = tempNormal.z;
        }
      }

      // For ring shapes, cull faces that are too far from equator
      if (isRing && indices && latitudes.length > 0) {
        const newIndices = [];
        const numVerts = resolution + 1;

        for (let i = 0; i < resolution; i++) {
          for (let j = 0; j < resolution; j++) {
            const row = numVerts;
            const v00 = i * row + j;
            const v01 = v00 + 1;
            const v10 = (i + 1) * row + j;
            const v11 = v10 + 1;

            // Check if any vertex is too far from equator
            const latMax = Math.max(
              latitudes[v00],
              latitudes[v01],
              latitudes[v10],
              latitudes[v11]
            );

            if (latMax <= cullLatitude) {
              // Keep face - add indices with ring winding order
              newIndices.push(v00, v01, v11);
              newIndices.push(v00, v11, v10);
            }
          }
        }

        // Update geometry with culled indices
        geometry.setIndex(newIndices);
      }

      positionAttribute.needsUpdate = true;
      if (normalAttribute) {
        normalAttribute.needsUpdate = true;
        // For ring shapes, recompute normals from geometry to ensure correct facing
        // The geometry will compute normals based on face winding
        // For planet shapes, manually set normals are correct (outward from sphere)
        if (isRing) {
          // Don't manually set normals for ring - let geometry compute them
          // This ensures normals match the face winding
          geometry.computeVertexNormals();
          // For ring shapes, flip normals to point inward (toward ring center)
          // This ensures the ocean is visible from inside the ring
          if (normalAttribute) {
            const normals = normalAttribute.array;
            for (let i = 0; i < normals.length; i += 3) {
              normals[i] = -normals[i];
              normals[i + 1] = -normals[i + 1];
              normals[i + 2] = -normals[i + 2];
            }
            normalAttribute.needsUpdate = true;
          }
        }
      } else {
        // If normals weren't created, compute them now
        geometry.computeVertexNormals();
      }
      geometry.computeBoundingSphere();

      const mesh = new THREE.Mesh(geometry, this._material);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.renderOrder = 1; // Render after terrain (terrain is default 0)

      // For ring shapes, use FrontSide like terrain
      // The normals should be computed correctly from geometry to face inward
      if (isRing) {
        const ringMaterial = this._material.clone();
        ringMaterial.side = THREE.FrontSide;
        mesh.material = ringMaterial;
      }

      group.add(mesh);

      return {
        mesh: mesh,
        geometry: geometry,
        origin: worldCenter.clone(),
        worldCenter: worldCenter.clone(), // Store world center for reference
      };
    }

    Update(timeInSeconds) {
      // Update time uniform for animation
      this._totalTime += timeInSeconds;
      this._material.uniforms.time.value = this._totalTime;

      this._UpdateVisibleChunks_Quadtree();

      const cameraPosition = this._params.camera.position;

      // Update chunk positions relative to camera
      for (let k in this._chunks) {
        const chunk = this._chunks[k];
        if (chunk.mesh && chunk.origin) {
          chunk.mesh.position.copy(chunk.origin);
          chunk.mesh.position.sub(cameraPosition);
        }
      }
    }

    _UpdateVisibleChunks_Quadtree() {
      function _Key(c) {
        return (
          c.position[0] +
          "/" +
          c.position[1] +
          " [" +
          c.size +
          "]" +
          " [" +
          c.index +
          "]"
        );
      }

      const q = new quadtree.CubeQuadTree({
        radius: this._radius,
        min_node_size: this._minCellSize,
      });

      const cameraPosition = this._params.camera.position.clone();
      if (this._shape === "ring") {
        cameraPosition.sub(this._center);
      }
      q.Insert(cameraPosition);

      const sides = q.GetChildren();

      let newOceanChunks = {};
      const center = new THREE.Vector3();
      const dimensions = new THREE.Vector3();
      for (let i = 0; i < sides.length; i++) {
        for (let c of sides[i].children) {
          c.bounds.getCenter(center);
          c.bounds.getSize(dimensions);

          const child = {
            index: i,
            group: this._groups[i],
            transform: sides[i].transform,
            position: [center.x, center.y, center.z],
            bounds: c.bounds,
            size: dimensions.x,
          };

          const k = _Key(child);
          newOceanChunks[k] = child;
        }
      }

      const intersection = utils.DictIntersection(this._chunks, newOceanChunks);
      const difference = utils.DictDifference(newOceanChunks, this._chunks);
      const recycle = Object.values(
        utils.DictDifference(this._chunks, newOceanChunks)
      );

      // Remove recycled chunks
      for (let chunk of recycle) {
        if (chunk.mesh) {
          chunk.group.remove(chunk.mesh);
          chunk.geometry.dispose();
        }
      }

      newOceanChunks = intersection;

      // Create new chunks
      for (let k in difference) {
        const [xp, yp, zp] = difference[k].position;

        const offset = new THREE.Vector3(xp, yp, zp);
        const chunk = this._CreateOceanChunk(
          difference[k].group,
          difference[k].transform,
          offset,
          difference[k].size,
          terrain_constants.QT_MIN_CELL_RESOLUTION
        );

        newOceanChunks[k] = {
          position: [xp, zp],
          group: difference[k].group,
          transform: difference[k].transform,
          mesh: chunk.mesh,
          geometry: chunk.geometry,
          origin: chunk.origin,
        };
      }

      this._chunks = newOceanChunks;
    }

    UpdateSunDirection(sunDirection) {
      if (this._material && this._material.uniforms.sunDirection) {
        this._material.uniforms.sunDirection.value.copy(sunDirection);
      }
    }

    SetEnabled(enabled) {
      if (enabled) {
        // Add ocean groups back to scene
        this._params.scene.add(...this._groups);
      } else {
        // Remove ocean groups from scene
        this._params.scene.remove(...this._groups);
      }
    }
  }

  return {
    OceanChunkManager: OceanChunkManager,
  };
})();
