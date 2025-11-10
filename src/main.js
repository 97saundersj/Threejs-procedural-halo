import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.181.0/build/three.module.js";
import GUI from "https://cdn.jsdelivr.net/npm/lil-gui@0.19/+esm";
import { controls } from "./controls.js";
import { game } from "./game.js";
import { terrain } from "./terrain.js";
import { sun } from "./sun.js";
import { terrain_constants } from "./terrain-constants.js";
import { camera_track } from "./camera-track.js";
import { scene_manager } from "./scene-manager.js";
import { addHaloShellToScene, addHaloExteriorShell } from "./halo-shell.js";

let _APP = null;

class ProceduralTerrain_Demo extends game.Game {
  constructor() {
    super();
  }

  _OnInitialize() {
    this._CreateGUI();

    // Initialize scene manager
    const sceneManager = new scene_manager.SceneManager();
    this._currentSceneType = sceneManager.GetSceneTypeFromURL();

    // Get camera positions and targets from scene manager
    const orbitPosition = sceneManager.GetCameraPosition(
      this._currentSceneType
    );
    const targetPosition = sceneManager.GetCameraTarget(this._currentSceneType);
    const orbitQuaternion = sceneManager.GetCameraQuaternion(
      this._currentSceneType
    );

    // For planet/both scenes, use the original target quaternion
    // For ring-only, calculate from the camera setup
    let targetQuaternion;
    if (this._currentSceneType === "ring") {
      // Calculate target quaternion for ring scene
      const tempCamera = new THREE.PerspectiveCamera();
      tempCamera.position.copy(targetPosition);
      tempCamera.lookAt(targetPosition.clone().add(new THREE.Vector3(0, 1, 0)));
      targetQuaternion = tempCamera.quaternion.clone();
    } else {
      // Use original target quaternion for planet scenes
      targetQuaternion = new THREE.Quaternion(
        0.3525209450519473,
        0.6189868049149101,
        -0.58773147927222,
        0.38360921119467495
      );
    }

    // Set initial camera position to orbit
    this.graphics_.Camera.position.copy(orbitPosition);
    this.graphics_.Camera.quaternion.copy(orbitQuaternion);

    // Store target position and quaternion for later use
    this._targetPosition = targetPosition;
    this._targetQuaternion = targetQuaternion;

    // Initialize scene entities using scene manager
    const sceneEntities = sceneManager.InitializeScene(
      this._currentSceneType,
      this,
      this.graphics_,
      this._gui,
      this._guiParams
    );

    // Add terrain manager if it exists
    if (sceneEntities.terrain) {
      this._AddEntity("_terrain", sceneEntities.terrain, 1.0);
      this._terrainManager = sceneEntities.terrain;
    } else {
      this._terrainManager = null;
    }

    // Add ringworld manager if it exists
    if (sceneEntities.ringworld) {
      this._AddEntity("_ringworld", sceneEntities.ringworld, 1.0);
      this._ringworldManager = sceneEntities.ringworld;
    } else {
      this._ringworldManager = null;
    }

    // Add a simple visible textured shell structure around the ring for context
    if (
      this._currentSceneType === "ring" ||
      this._currentSceneType === "both"
    ) {
      const ringCenter = new THREE.Vector3(terrain_constants.RING_OFFSET, 0, 0);
      this._haloShell = addHaloExteriorShell(this.graphics_.Scene, ringCenter, {
        camera: this.graphics_.Camera,
        radius: terrain_constants.RING_MAJOR_RADIUS * 1.01,
        circleSegmentCount: 256,
        deckHeight: 27000.0,
        wallInnerDrop: 8000.0,
        wallHeight: 5000.0,
        color: 0xffffff,
      });
    } else {
      this._haloShell = null;
    }

    this._AddEntity(
      "_sun",
      new sun.Sun({
        scene: this.graphics_.Scene,
      }),
      0.5
    );
    // Create controls (they'll be disabled until pointer lock is activated)
    this._controls = new controls.FPSControls({
      camera: this.graphics_.Camera,
      scene: this.graphics_.Scene,
      domElement: this.graphics_._threejs.domElement,
      gui: this._gui,
      guiParams: this._guiParams,
    });

    this._AddEntity("_controls", this._controls, 0.0);

    // Create camera track for orbit-to-ground transition (only for planet/both scenes)
    if (this._currentSceneType !== "ring") {
      const transitionDuration = sceneManager.GetCameraTrackDuration(
        this._currentSceneType
      );
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
    } else {
      // For ring-only scenes, no camera track needed
      this._cameraTrack = null;
      this._cameraTrackComplete = true; // Mark as complete so it doesn't try to run
    }

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

    // Wire up GUI callbacks for enable/disable controls
    this._WireUpEnableDisableCallbacks();
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

      // Update terrain shader (if terrain exists)
      const terrainEntity = this._entities["_terrain"];
      if (
        terrainEntity &&
        terrainEntity.entity &&
        terrainEntity.entity.UpdateSunDirection
      ) {
        terrainEntity.entity.UpdateSunDirection(sunDirection);
      }

      // Update ocean shader (through terrain manager, if it exists)
      if (this._terrainManager) {
        const ocean = this._terrainManager.GetOcean();
        if (ocean && ocean.UpdateSunDirection) {
          ocean.UpdateSunDirection(sunDirection);
        }
      }

      // Update ringworld terrain shader (if ringworld exists)
      const ringworldEntity = this._entities["_ringworld"];
      if (
        ringworldEntity &&
        ringworldEntity.entity &&
        ringworldEntity.entity.UpdateSunDirection
      ) {
        ringworldEntity.entity.UpdateSunDirection(sunDirection);
      }

      // Update ringworld ocean shader (through ringworld manager, if it exists)
      if (ringworldEntity && ringworldEntity.entity) {
        const ringworldOcean = ringworldEntity.entity.GetOcean();
        if (ringworldOcean && ringworldOcean.UpdateSunDirection) {
          ringworldOcean.UpdateSunDirection(sunDirection);
        }
      }

      // Update halo shell lighting
      if (this._haloShell && this._haloShell.UpdateSunDirection) {
        this._haloShell.UpdateSunDirection(sunDirection);
      }
    }
  }

  _CreateGUI() {
    // Get scene type from URL for GUI initialization
    const sceneManager = new scene_manager.SceneManager();
    const currentSceneType = sceneManager.GetSceneTypeFromURL();

    this._guiParams = {
      general: {
        sceneType: currentSceneType,
        terrainEnabled: true,
        oceanEnabled: true,
        atmosphereEnabled: true,
        sceneryEnabled: true,
        resolutionScale: 1.0,
        qtMinCellSize: terrain_constants.QT_MIN_CELL_SIZE,
        qtMinCellResolution: terrain_constants.QT_MIN_CELL_RESOLUTION,
        haloShellEnabled: true,
      },
    };
    this._gui = new GUI();

    const generalRollup = this._gui.addFolder("General");

    // Scene selector dropdown
    this._sceneTypeController = generalRollup.add(
      this._guiParams.general,
      "sceneType",
      ["both", "planet", "ring"]
    );
    this._sceneTypeController.onChange((value) => {
      // Update URL parameter and reload page
      const url = new URL(window.location);
      url.searchParams.set("scene", value);
      window.location.href = url.toString();
    });

    this._terrainController = generalRollup.add(
      this._guiParams.general,
      "terrainEnabled"
    );
    this._oceanController = generalRollup.add(
      this._guiParams.general,
      "oceanEnabled"
    );
    this._atmosphereController = generalRollup.add(
      this._guiParams.general,
      "atmosphereEnabled"
    );
    this._sceneryController = generalRollup.add(
      this._guiParams.general,
      "sceneryEnabled"
    );
    this._resolutionScaleController = generalRollup.add(
      this._guiParams.general,
      "resolutionScale",
      0.25,
      2.0
    );
    this._qtMinCellSizeController = generalRollup.add(
      this._guiParams.general,
      "qtMinCellSize",
      1,
      10000
    );
    this._qtMinCellResolutionController = generalRollup.add(
      this._guiParams.general,
      "qtMinCellResolution",
      8,
      128
    );
    // Toggle halo shell visibility when available
    this._haloShellController = generalRollup.add(
      this._guiParams.general,
      "haloShellEnabled"
    );
    this._haloShellController.onChange((value) => {
      if (this._haloShell) {
        this._haloShell.visible = value;
      }
    });
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
    texture.colorSpace = THREE.SRGBColorSpace;
    this.graphics_.Scene.background = texture;
  }

  _OnStep(timeInSeconds) {
    // Update sun direction across all systems every frame for consistency
    this._UpdateSunDirection();

    // Update FPS counter
    this._UpdateFPS(timeInSeconds);

    // Update acceleration display
    this._UpdateAccelerationDisplay();

    // Handle camera track transition (only for planet/both scenes, not ring-only)
    if (
      !this._cameraTrackComplete &&
      this._cameraTrack &&
      this._currentSceneType !== "ring"
    ) {
      // Wait for terrain to be ready before starting the transition
      if (!this._cameraTrackStarted) {
        // For "both" scene, wait for planet terrain; for "planet" scene, wait for terrain
        const terrainToWait = this._terrainManager;
        if (terrainToWait && terrainToWait.IsReady()) {
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

  _WireUpEnableDisableCallbacks() {
    // Wire up terrain enable/disable
    if (this._terrainController) {
      this._terrainController.onChange((value) => {
        if (this._terrainManager) {
          this._terrainManager.SetEnabled(value);
        }
      });
    }

    // Wire up ocean enable/disable
    if (this._oceanController) {
      this._oceanController.onChange((value) => {
        if (this._terrainManager) {
          const ocean = this._terrainManager.GetOcean();
          if (ocean && ocean.SetEnabled) {
            ocean.SetEnabled(value);
          }
        }
      });
    }

    // Wire up atmosphere enable/disable
    if (this._atmosphereController) {
      this._atmosphereController.onChange((value) => {
        if (this.graphics_ && this.graphics_.SetAtmosphereEnabled) {
          this.graphics_.SetAtmosphereEnabled(value);
        }
      });
    }

    // Wire up scenery enable/disable
    if (this._sceneryController) {
      this._sceneryController.onChange((value) => {
        if (this._terrainManager) {
          const scenery = this._terrainManager.GetScenery();
          if (scenery && scenery.SetEnabled) {
            scenery.SetEnabled(value);
          }
        }
      });
    }

    // Wire up resolution scale
    if (this._resolutionScaleController) {
      this._resolutionScaleController.onChange((value) => {
        if (this.graphics_ && this.graphics_.SetResolutionScale) {
          this.graphics_.SetResolutionScale(value);
        }
      });
    }

    // Wire up QT_MIN_CELL_SIZE
    if (this._qtMinCellSizeController) {
      this._qtMinCellSizeController.onChange((value) => {
        terrain_constants.QT_MIN_CELL_SIZE = value;
        // Update ocean's min cell size if it exists
        if (this._terrainManager) {
          const ocean = this._terrainManager.GetOcean();
          if (ocean && ocean._minCellSize !== undefined) {
            ocean._minCellSize = value * 2000.0;
          }
        }
      });
    }

    // Wire up QT_MIN_CELL_RESOLUTION
    if (this._qtMinCellResolutionController) {
      this._qtMinCellResolutionController.onChange((value) => {
        terrain_constants.QT_MIN_CELL_RESOLUTION = value;
        // Changes will take effect when new chunks are created
      });
    }
  }
}

function _Main() {
  _APP = new ProceduralTerrain_Demo();
}

_Main();
