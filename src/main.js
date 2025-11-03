import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.112.1/build/three.module.js";
import { GUI } from "https://cdn.jsdelivr.net/npm/three@0.112.1/examples/jsm/libs/dat.gui.module.js";
import { controls } from "./controls.js";
import { game } from "./game.js";
import { terrain } from "./terrain.js";
import { ocean } from "./ocean.js";
import { sun } from "./sun.js";
import { scenery_controller } from "./scenery-controller.js";
import { terrain_constants } from "./terrain-constants.js";

let _APP = null;

class ProceduralTerrain_Demo extends game.Game {
  constructor() {
    super();
  }

  _OnInitialize() {
    this._CreateGUI();

    this.graphics_.Camera.position.set(
      355898.9978932907,
      -16169.249553939484,
      -181920.2108868533
    );
    this.graphics_.Camera.quaternion.set(
      0.3525209450519473,
      0.6189868049149101,
      -0.58773147927222,
      0.38360921119467495
    );

    const terrainManager = new terrain.TerrainChunkManager({
      camera: this.graphics_.Camera,
      scene: this.graphics_.Scene,
      scattering: this.graphics_._depthPass,
      gui: this._gui,
      guiParams: this._guiParams,
      game: this,
    });
    this._AddEntity("_terrain", terrainManager, 1.0);

    this._AddEntity(
      "_ocean",
      new ocean.OceanChunkManager({
        camera: this.graphics_.Camera,
        scene: this.graphics_.Scene,
        gui: this._gui,
        guiParams: this._guiParams,
      }),
      1.5
    );

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

    // Add scenery controller
    // Must be added after terrain managers are created
    this._AddEntity(
      "_scenery",
      new scenery_controller.SceneryController({
        camera: this.graphics_.Camera,
        scene: this.graphics_.Scene,
        terrainManager: terrainManager,
        radius: terrain_constants.PLANET_RADIUS,
        center: new THREE.Vector3(0, 0, 0),
        shape: "planet",
      }),
      1.5
    );

    this._AddEntity(
      "_controls",
      new controls.FPSControls({
        camera: this.graphics_.Camera,
        scene: this.graphics_.Scene,
        domElement: this.graphics_._threejs.domElement,
        gui: this._gui,
        guiParams: this._guiParams,
      }),
      0.0
    );

    // this._AddEntity('_controls', new controls.ShipControls({
    //     camera: this.graphics_.Camera,
    //     scene: this.graphics_.Scene,
    //     domElement: this.graphics_._threejs.domElement,
    //     gui: this._gui,
    //     guiParams: this._guiParams,
    // }), 0.0);

    this._totalTime = 0;

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

      // Update ocean shader
      const oceanEntity = this._entities["_ocean"];
      if (
        oceanEntity &&
        oceanEntity.entity &&
        oceanEntity.entity.UpdateSunDirection
      ) {
        oceanEntity.entity.UpdateSunDirection(sunDirection);
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
    
    // Update acceleration display
    this._UpdateAccelerationDisplay();
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
