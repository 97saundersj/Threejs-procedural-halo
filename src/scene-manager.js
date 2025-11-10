import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.181.0/build/three.module.js";
import { terrain } from "./terrain.js";
import { terrain_constants } from "./terrain-constants.js";

export const scene_manager = (function () {
  class SceneManager {
    constructor() {}

    GetSceneTypeFromURL() {
      const urlParams = new URLSearchParams(window.location.search);
      const sceneType = urlParams.get("scene");
      // Validate scene type, default to "both"
      if (
        sceneType === "planet" ||
        sceneType === "ring" ||
        sceneType === "both"
      ) {
        return sceneType;
      }
      return "both"; // Default scene
    }

    InitializeScene(sceneType, game, graphics, gui, guiParams) {
      const entities = {
        terrain: null,
        ringworld: null,
      };

      // Initialize planet terrain manager (for "planet" or "both" scenes)
      if (sceneType === "planet" || sceneType === "both") {
        const terrainManager = new terrain.TerrainChunkManager({
          camera: graphics.Camera,
          scene: graphics.Scene,
          scattering: graphics._depthPass,
          gui: gui,
          guiParams: guiParams,
          game: game,
        });
        entities.terrain = terrainManager;
      }

      // Initialize ring terrain manager (for "ring" or "both" scenes)
      if (sceneType === "ring" || sceneType === "both") {
        const ringworldManager = new terrain.TerrainChunkManager({
          camera: graphics.Camera,
          scene: graphics.Scene,
          scattering: null,
          gui: null,
          guiParams: {},
          game: game,
          radius: terrain_constants.RING_MAJOR_RADIUS,
          center: new THREE.Vector3(terrain_constants.RING_OFFSET, 0, 0),
          shape: "ring",
          shapeParams: {
            latCutoff: terrain_constants.RING_LATITUDE_CUTOFF,
            latFade: terrain_constants.RING_LATITUDE_FADE,
            dropExponent: terrain_constants.RING_DROP_EXPONENT,
            cullLatitude: terrain_constants.RING_CULL_LATITUDE,
          },
        });
        entities.ringworld = ringworldManager;
      }

      return entities;
    }

    GetCameraPosition(sceneType) {
      if (sceneType === "ring") {
        // For ring-only scene, position camera to view the ring
        const ringCenter = new THREE.Vector3(
          terrain_constants.RING_OFFSET,
          0,
          0
        );
        const ringRadius = terrain_constants.RING_MAJOR_RADIUS;
        const orbitDistance = ringRadius * 1.5; // 1.5x ring radius for orbit

        // Position camera at an angle to view the ring structure
        // Place camera above and to the side of the ring
        const cameraOffset = new THREE.Vector3(
          orbitDistance * 0.5,
          orbitDistance * 0.8,
          orbitDistance * 0.5
        );
        return ringCenter.clone().add(cameraOffset);
      } else {
        // For planet or both scenes, use existing planet camera positioning
        // This is the same as the original orbit position calculation
        const targetPosition = new THREE.Vector3(
          355898.9978932907,
          -16169.249553939484,
          -181920.2108868533
        );
        const planetCenter = new THREE.Vector3(0, 0, 0);
        const directionToTarget = targetPosition
          .clone()
          .sub(planetCenter)
          .normalize();

        const planetRadius = terrain_constants.PLANET_RADIUS;
        const orbitDistance = planetRadius * 1.5; // 1.5x planet radius for orbit

        return directionToTarget.clone().multiplyScalar(orbitDistance);
      }
    }

    GetCameraTarget(sceneType) {
      if (sceneType === "ring") {
        // For ring-only scene, look at the ring center
        return new THREE.Vector3(terrain_constants.RING_OFFSET, 0, 0);
      } else {
        // For planet or both scenes, use existing target position
        return new THREE.Vector3(
          355898.9978932907,
          -16169.249553939484,
          -181920.2108868533
        );
      }
    }

    GetCameraQuaternion(sceneType) {
      // Calculate quaternion by positioning camera and using lookAt
      const position = this.GetCameraPosition(sceneType);
      const target = this.GetCameraTarget(sceneType);

      // Create a temporary camera to calculate quaternion
      const tempCamera = new THREE.PerspectiveCamera();
      tempCamera.position.copy(position);
      tempCamera.lookAt(target);
      return tempCamera.quaternion.clone();
    }

    GetCameraTrackDuration(sceneType) {
      // Define camera track transition duration in seconds
      // Only used for planet/both scenes (ring scenes don't use camera track)
      if (sceneType === "planet") {
        return 6.0; // Duration in seconds - adjust this value to change planet camera track speed
      }
      if (sceneType === "both") {
        return 3.0; // Shorter duration for both scenes - adjust this value to change speed
      }
      return 0.0; // Not used for ring scenes
    }
  }

  return {
    SceneManager: SceneManager,
  };
})();
