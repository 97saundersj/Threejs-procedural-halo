import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.112.1/build/three.module.js";
import { GUI } from "https://cdn.jsdelivr.net/npm/three@0.112.1/examples/jsm/libs/dat.gui.module.js";
import { controls } from "./controls.js";
import { game } from "./game.js";
import { terrain } from "./terrain.js";
import { sun } from "./sun.js";
import { terrain_constants } from "./terrain-constants.js";
import { camera_track } from "./camera-track.js";

let _APP = null;

class ProceduralTerrain_Demo extends game.Game {
  constructor() {
    super();
  }

  _OnInitialize() {
    this._CreateGUI();

    // Target position (ground spawn position)
    const targetPosition = new THREE.Vector3(
      355898.9978932907,
      -16169.249553939484,
      -181920.2108868533
    );
    const targetQuaternion = new THREE.Quaternion(
      0.3525209450519473,
      0.6189868049149101,
      -0.58773147927222,
      0.38360921119467495
    );

    // Calculate orbit position by extending outward from planet center
    // Get direction from planet center to target position
    const planetCenter = new THREE.Vector3(0, 0, 0);
    const directionToTarget = targetPosition
      .clone()
      .sub(planetCenter)
      .normalize();

    // Calculate orbit distance (further out from planet surface)
    const planetRadius = terrain_constants.PLANET_RADIUS;
    const orbitDistance = planetRadius * 1.5; // 1.5x planet radius for orbit

    // Orbit position is further out along the same direction
    const orbitPosition = directionToTarget
      .clone()
      .multiplyScalar(orbitDistance);

    // Set initial camera position to orbit
    this.graphics_.Camera.position.copy(orbitPosition);

    // For orbit, we want the camera to look down at the planet
    // Use the camera's lookAt method directly to face the target position
    // This ensures the camera is facing where we'll land
    this.graphics_.Camera.lookAt(targetPosition);

    // Store the orbit quaternion for the camera track
    const orbitQuaternion = this.graphics_.Camera.quaternion.clone();

    // Store target position and quaternion for later use
    this._targetPosition = targetPosition;
    this._targetQuaternion = targetQuaternion;

    const terrainManager = new terrain.TerrainChunkManager({
      camera: this.graphics_.Camera,
      scene: this.graphics_.Scene,
      scattering: this.graphics_._depthPass,
      gui: this._gui,
      guiParams: this._guiParams,
      game: this,
    });
    this._AddEntity("_terrain", terrainManager, 1.0);

    // Store terrain manager reference to check if ready
    this._terrainManager = terrainManager;

    this._AddEntity(
      "_sun",
      new sun.Sun({
        scene: this.graphics_.Scene,
      }),
      0.5
    );

    const ringworldManager = new terrain.TerrainChunkManager({
      camera: this.graphics_.Camera,
      scene: this.graphics_.Scene,
      scattering: null,
      gui: null,
      guiParams: {},
      game: this,
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
    this._AddEntity("_ringworld", ringworldManager, 1.0);

    // Create controls (they'll be disabled until pointer lock is activated)
    this._controls = new controls.FPSControls({
      camera: this.graphics_.Camera,
      scene: this.graphics_.Scene,
      domElement: this.graphics_._threejs.domElement,
      gui: this._gui,
      guiParams: this._guiParams,
    });

    this._AddEntity("_controls", this._controls, 0.0);

    // Create camera track for orbit-to-ground transition
    const transitionDuration = 3.0; // 7 seconds for transition (slightly quicker)
    const cameraTrack = new camera_track.CameraTrack({
      camera: this.graphics_.Camera,
      paused: true, // Start paused until terrain is ready
      points: [
        {
          time: 0.0,
          data: {
            pos: orbitPosition.clone(),
            rot: orbitQuaternion.clone(),
          },
        },
        {
          time: transitionDuration,
          data: {
            pos: targetPosition.clone(),
            rot: targetQuaternion.clone(),
          },
        },
      ],
    });

    // Store track info for cleanup
    this._cameraTrack = cameraTrack;
    this._cameraTrackDuration = transitionDuration;
    this._cameraTrackTime = 0.0;
    this._cameraTrackComplete = false;
    this._cameraTrackStarted = false; // Track if camera track has started

    this._AddEntity("_cameraTrack", cameraTrack, 2.0);

    // this._AddEntity('_controls', new controls.ShipControls({
    //     camera: this.graphics_.Camera,
    //     scene: this.graphics_.Scene,
    //     domElement: this.graphics_._threejs.domElement,
    //     gui: this._gui,
    //     guiParams: this._guiParams,
    // }), 0.0);

    this._totalTime = 0;

    // FPS tracking
    this._fps = 0;
    this._fpsTime = 0;
    this._fpsFrames = 0;

    this._LoadBackground();

    // Initialize sun direction on all systems
    this._UpdateSunDirection();
  }

  _UpdateSunDirection() {
    // Update sun direction across all systems for consistent planetary lighting
    const sunEntity = this._entities["_sun"];
    if (sunEntity && sunEntity.entity && sunEntity.entity.SunDirection) {
      const sunDirection = sunEntity.entity.SunDirection;

      // Update graphics (scene light and scattering shader)
      if (this.graphics_ && this.graphics_.UpdateSunDirection) {
        this.graphics_.UpdateSunDirection(sunDirection);
      }

      // Update terrain shader
      const terrainEntity = this._entities["_terrain"];
      if (
        terrainEntity &&
        terrainEntity.entity &&
        terrainEntity.entity.UpdateSunDirection
      ) {
        terrainEntity.entity.UpdateSunDirection(sunDirection);
      }

      // Update ocean shader (through terrain manager)
      const ocean = this._terrainManager && this._terrainManager.GetOcean();
      if (ocean && ocean.UpdateSunDirection) {
        ocean.UpdateSunDirection(sunDirection);
      }

      // Update ringworld terrain shader
      const ringworldEntity = this._entities["_ringworld"];
      if (
        ringworldEntity &&
        ringworldEntity.entity &&
        ringworldEntity.entity.UpdateSunDirection
      ) {
        ringworldEntity.entity.UpdateSunDirection(sunDirection);
      }

      // Update ringworld ocean shader (through ringworld manager)
      const ringworldOcean =
        ringworldEntity &&
        ringworldEntity.entity &&
        ringworldEntity.entity.GetOcean();
      if (ringworldOcean && ringworldOcean.UpdateSunDirection) {
        ringworldOcean.UpdateSunDirection(sunDirection);
      }
    }
  }

  _CreateGUI() {
    this._guiParams = {
      general: {},
    };
    this._gui = new GUI();

    const generalRollup = this._gui.addFolder("General");
    this._gui.close();
  }

  _LoadBackground() {
    this.graphics_.Scene.background = new THREE.Color(0x000000);
    const loader = new THREE.CubeTextureLoader();
    const texture = loader.load([
      "./resources/space-posx.jpg",
      "./resources/space-negx.jpg",
      "./resources/space-posy.jpg",
      "./resources/space-negy.jpg",
      "./resources/space-posz.jpg",
      "./resources/space-negz.jpg",
    ]);
    texture.encoding = THREE.sRGBEncoding;
    this.graphics_._scene.background = texture;
  }

  _OnStep(timeInSeconds) {
    // Update sun direction across all systems every frame for consistency
    this._UpdateSunDirection();

    // Update FPS counter
    this._UpdateFPS(timeInSeconds);

    // Update acceleration display
    this._UpdateAccelerationDisplay();

    // Handle camera track transition
    if (!this._cameraTrackComplete && this._cameraTrack) {
      // Wait for terrain to be ready before starting the transition
      if (!this._cameraTrackStarted) {
        if (this._terrainManager && this._terrainManager.IsReady()) {
          this._cameraTrackStarted = true;
          // Unpause the camera track now that terrain is ready
          if (this._cameraTrack && this._cameraTrack.SetPaused) {
            this._cameraTrack.SetPaused(false);
          }
          // Reset time to start from beginning now that terrain is ready
          this._cameraTrackTime = 0.0;
        } else {
          // Terrain not ready yet, don't start the transition
          return;
        }
      }

      // Only update time if transition has started
      if (this._cameraTrackStarted) {
        this._cameraTrackTime += timeInSeconds;

        // Check if transition is complete
        if (this._cameraTrackTime >= this._cameraTrackDuration) {
          this._cameraTrackComplete = true;

          // Remove camera track entity
          delete this._entities["_cameraTrack"];

          // Ensure camera is at exact target position
          this.graphics_.Camera.position.copy(this._targetPosition);
          this.graphics_.Camera.quaternion.copy(this._targetQuaternion);

          this._cameraTrack = null;
        }
      }
    }
  }

  _UpdateFPS(timeInSeconds) {
    this._fpsTime += timeInSeconds;
    this._fpsFrames++;

    // Update FPS every second
    if (this._fpsTime >= 1.0) {
      this._fps = this._fpsFrames / this._fpsTime;
      this._fpsTime = 0;
      this._fpsFrames = 0;

      const fpsDisplay = document.getElementById("fps-display");
      if (fpsDisplay) {
        fpsDisplay.textContent = `FPS: ${Math.round(this._fps)}`;
      }
    }
  }

  _UpdateAccelerationDisplay() {
    const accelerationDisplay = document.getElementById("acceleration-display");
    if (accelerationDisplay && this._guiParams && this._guiParams.camera) {
      const acceleration = this._guiParams.camera.acceleration_x;

      // Calculate percentage based on min/max acceleration (4.0 to 24.0)
      const minAcc = 4.0;
      const maxAcc = 24.0;
      const percent = ((acceleration - minAcc) / (maxAcc - minAcc)) * 100;

      accelerationDisplay.textContent = `Acceleration: ${Math.round(percent)}%`;
    }
  }
}

function _Main() {
  _APP = new ProceduralTerrain_Demo();
}

_Main();
