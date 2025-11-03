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

      this._radius = params.radius || 400010.0;
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

      const tempPos = new THREE.Vector3();
      const tempNormal = new THREE.Vector3();
      const localPos = new THREE.Vector3();
      const worldCenter = new THREE.Vector3();

      // Calculate the world-space center of this chunk
      tempPos.copy(offset);
      tempPos.applyMatrix4(groupTransform);
      tempPos.normalize();
      const oceanRadius = this._radius;
      worldCenter.copy(tempPos);
      worldCenter.multiplyScalar(oceanRadius);

      for (let i = 0; i < positions.length; i += 3) {
        // Get local position (before transform)
        localPos.set(positions[i], positions[i + 1], positions[i + 2]);

        // Transform to world space coordinates (for sphere projection)
        tempPos.copy(localPos);
        tempPos.add(offset);
        tempPos.applyMatrix4(groupTransform);

        // Project onto sphere at ocean level
        tempPos.normalize();
        tempNormal.copy(tempPos);

        // Scale to ocean radius (at planet radius for sea level)
        tempPos.multiplyScalar(oceanRadius);

        // Store position relative to chunk center (for positioning relative to camera)
        tempPos.sub(worldCenter);
        positions[i] = tempPos.x;
        positions[i + 1] = tempPos.y;
        positions[i + 2] = tempPos.z;

        // Store normal (pointing outward from sphere)
        if (normals) {
          normals[i] = tempNormal.x;
          normals[i + 1] = tempNormal.y;
          normals[i + 2] = tempNormal.z;
        }
      }

      positionAttribute.needsUpdate = true;
      if (normalAttribute) {
        normalAttribute.needsUpdate = true;
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

      group.add(mesh);

      return {
        mesh: mesh,
        geometry: geometry,
        origin: worldCenter.clone(),
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
        min_node_size: terrain_constants.QT_MIN_CELL_SIZE,
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
  }

  return {
    OceanChunkManager: OceanChunkManager,
  };
})();
