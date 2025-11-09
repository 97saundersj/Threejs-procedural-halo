import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.181.0/build/three.module.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.181.0/examples/jsm/controls/OrbitControls.js";

export const controls = (function () {
  const KM_CUBE_SIZE = 1000;
  const KM_CUBE_HALF = KM_CUBE_SIZE * 0.5;
  const KM_CUBE_SPAWN_BUFFER = 500;
  const KM_CUBE_COLOR = 0x1e88e5;
  const KM_CUBE_GEOMETRY = new THREE.BoxGeometry(
    KM_CUBE_SIZE,
    KM_CUBE_SIZE,
    KM_CUBE_SIZE
  );

  const KM_CUBE_VS = `precision highp float;

out float vFragDepth;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vec4 clipPosition = projectionMatrix * mvPosition;
  gl_Position = clipPosition;
  vFragDepth = 1.0 + clipPosition.w;
}
`;

  const KM_CUBE_FS = `precision highp float;

uniform vec3 color;
uniform float logDepthBufFC;

in float vFragDepth;

out vec4 out_FragColor;

void main() {
  out_FragColor = vec4(color, 1.0);
  gl_FragDepth = log2(vFragDepth) * logDepthBufFC * 0.5;
}
`;

  function _CreateKilometreCubeMaterial(logDepthBufFC) {
    return new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(KM_CUBE_COLOR) },
        logDepthBufFC: { value: logDepthBufFC },
      },
      vertexShader: KM_CUBE_VS,
      fragmentShader: KM_CUBE_FS,
      glslVersion: THREE.GLSL3,
    });
  }

  class _OrbitControls {
    constructor(params) {
      this._params = params;
      this._Init(params);
    }

    _Init(params) {
      this._controls = new OrbitControls(params.camera, params.domElement);
      this._controls.target.set(0, 0, 0);
      this._controls.update();
    }

    Update() {}
  }

  // FPSControls was adapted heavily from a threejs example. Movement control
  // and collision detection was completely rewritten, but credit to original
  // class for the setup code.
  class _FPSControls {
    constructor(params) {
      this._cells = params.cells;
      this._Init(params);
    }

    _Init(params) {
      this._params = params;
      this._radius = 2;
      this._enabled = false;
      this._move = {
        forward: false,
        backward: false,
        left: false,
        right: false,
        up: false,
        down: false,
        rotateLeft: false,
        rotateRight: false,
      };
      this._standing = true;
      this._velocity = new THREE.Vector3(0, 0, 0);
      this._decceleration = new THREE.Vector3(-10, -10, -10);
      this._acceleration = new THREE.Vector3(12, 12, 12);
      this._minAcceleration = 4.0;
      this._maxAcceleration = 24.0;
      this._rotationSpeed = Math.PI;

      this._cameraWorldQuaternion = new THREE.Quaternion();
      this._forwardVector = new THREE.Vector3();
      this._sideVector = new THREE.Vector3();
      this._upVector = new THREE.Vector3();
      this._yawQuaternion = new THREE.Quaternion();
      this._pitchQuaternion = new THREE.Quaternion();
      this._rollQuaternion = new THREE.Quaternion();
      this._yawAxis = new THREE.Vector3();
      this._pitchAxis = new THREE.Vector3();
      this._rollAxis = new THREE.Vector3();
      this._mouseSensitivity = {
        yaw: 0.005,
        pitch: 0.005,
      };
      this._spawnDirection = new THREE.Vector3();
      this._spawnPosition = new THREE.Vector3();
      this._spawnUp = new THREE.Vector3();

      this._gamepad = null;
      this._gamepadSensitivity = {
        yaw: 0.025,
        pitch: 0.025,
      };
      this._gamepadDeadZone = 0.1;
      this._gamepadStartButtonPressed = false;
      this._gamepadTriggerStepDelay = 0;
      this._gamepadTriggerStepInterval = 0.1; // Adjust acceleration every 0.1 seconds
      this._lastLeftTrigger = null;
      this._lastRightTrigger = null;

      // Touch controls - detect touch devices more robustly
      // Check for touch events, maxTouchPoints, or user agent hints
      const hasTouchEvents = "ontouchstart" in window || navigator.maxTouchPoints > 0;
      const isMobileUA = 
        (navigator.userAgentData && navigator.userAgentData.mobile) ||
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
          navigator.userAgent
        );
      
      this._isTouchDevice = hasTouchEvents || isMobileUA;
      
      // Debug logging (can be removed in production)
      if (this._isTouchDevice) {
        console.log("Mobile controls enabled:", {
          hasTouchEvents,
          isMobileUA,
          userAgent: navigator.userAgent,
          maxTouchPoints: navigator.maxTouchPoints
        });
      }
      this._touchLookActive = false;
      this._lastTouchX = 0;
      this._lastTouchY = 0;
      this._touchSensitivity = {
        yaw: 0.005,
        pitch: 0.005,
      };

      this._camera = params.camera;
      this._camera.updateMatrixWorld(true);
      this._logDepthBufFC = 2.0 / (Math.log(this._camera.far + 1.0) / Math.LN2);

      this._SetupPointerLock();

      if (this._isTouchDevice) {
        this._SetupTouchControls();
      }

      this._wheelHandler = (e) => this._OnMouseWheel(e);
      document.addEventListener("wheel", this._wheelHandler, { passive: true });

      this._mouseMoveHandler = (e) => this._OnMouseMove(e);
      document.addEventListener("mousemove", this._mouseMoveHandler, false);

      this._clickHandler = (e) => this._OnMouseDown(e);
      document.addEventListener("mousedown", this._clickHandler, false);

      document.addEventListener("keydown", (e) => this._onKeyDown(e), false);
      document.addEventListener("keyup", (e) => this._onKeyUp(e), false);

      this._SetupGamepad();

      this._InitGUI();
    }

    _InitGUI() {
      this._params.guiParams.camera = {
        acceleration_x: 12,
      };

      const rollup = this._params.gui.addFolder("Camera.FPS");
      this._speedController = rollup
        .add(
          this._params.guiParams.camera,
          "acceleration_x",
          this._minAcceleration,
          this._maxAcceleration
        )
        .onChange(() => {
          this._acceleration.set(
            this._params.guiParams.camera.acceleration_x,
            this._params.guiParams.camera.acceleration_x,
            this._params.guiParams.camera.acceleration_x
          );
        });
    }

    _onKeyDown(event) {
      switch (event.keyCode) {
        case 38: // up
        case 87: // w
          this._move.forward = false;
          this._move.backward = true;
          break;
        case 37: // left
        case 65: // a
          this._move.left = true;
          break;
        case 40: // down
        case 83: // s
          this._move.backward = false;
          this._move.forward = true;
          break;
        case 39: // right
        case 68: // d
          this._move.right = true;
          break;
        case 33: // PG_UP
          this._move.up = true;
          break;
        case 34: // PG_DOWN
          this._move.down = true;
          break;
        case 81: // q
          this._move.rotateRight = true;
          break;
        case 69: // e
          this._move.rotateLeft = true;
          break;
      }
    }

    _onKeyUp(event) {
      switch (event.keyCode) {
        case 38: // up
        case 87: // w
          this._move.forward = false;
          this._move.backward = false;
          break;
        case 37: // left
        case 65: // a
          this._move.left = false;
          break;
        case 40: // down
        case 83: // s
          this._move.backward = false;
          this._move.forward = false;
          break;
        case 39: // right
        case 68: // d
          this._move.right = false;
          break;
        case 33: // PG_UP
          this._move.up = false;
          break;
        case 34: // PG_DOWN
          this._move.down = false;
          break;
        case 81: // q
          this._move.rotateRight = false;
          break;
        case 69: // e
          this._move.rotateLeft = false;
          break;
      }
    }

    _OnMouseWheel(event) {
      if (!this._enabled) {
        return;
      }

      const direction = Math.sign(event.deltaY);
      if (direction === 0) {
        return;
      }

      const step = 0.5;
      const current = this._params.guiParams.camera.acceleration_x;
      const next = Math.max(
        this._minAcceleration,
        Math.min(
          this._maxAcceleration,
          current + (direction < 0 ? step : -step)
        )
      );

      if (next === current) {
        return;
      }

      this._params.guiParams.camera.acceleration_x = next;
      this._acceleration.set(next, next, next);

      if (this._speedController) {
        this._speedController.updateDisplay();
      }
    }

    _OnMouseDown(event) {
      // Object placement disabled
      return;
      
      if (!this._enabled || event.button !== 0) {
        return;
      }

      const camera = this._camera;
      const scene = this._params.scene;
      if (!camera || !scene) {
        return;
      }

      camera.getWorldDirection(this._spawnDirection).normalize();

      const spawnDistance = KM_CUBE_HALF + KM_CUBE_SPAWN_BUFFER;
      this._spawnPosition.copy(camera.position);
      this._spawnPosition.addScaledVector(this._spawnDirection, spawnDistance);

      const upDirection = this._spawnUp
        .set(0, 1, 0)
        .applyQuaternion(camera.quaternion)
        .normalize();
      const verticalOffset = KM_CUBE_HALF + 50;
      this._spawnPosition.addScaledVector(upDirection, verticalOffset);

      const cube = new THREE.Mesh(
        KM_CUBE_GEOMETRY,
        _CreateKilometreCubeMaterial(this._logDepthBufFC)
      );

      cube.position.copy(this._spawnPosition);
      cube.quaternion.copy(camera.quaternion);
      cube.castShadow = false;
      cube.receiveShadow = false;

      scene.add(cube);
    }

    _OnMouseMove(event) {
      if (!this._enabled) {
        return;
      }

      const movementX =
        event.movementX || event.mozMovementX || event.webkitMovementX || 0;
      const movementY =
        event.movementY || event.mozMovementY || event.webkitMovementY || 0;

      if (movementX === 0 && movementY === 0) {
        return;
      }

      const camera = this._camera;

      if (movementX !== 0) {
        this._yawAxis
          .set(0, 1, 0)
          .applyQuaternion(camera.quaternion)
          .normalize();
        this._yawQuaternion.setFromAxisAngle(
          this._yawAxis,
          -movementX * this._mouseSensitivity.yaw
        );
        camera.quaternion.premultiply(this._yawQuaternion);
      }

      if (movementY !== 0) {
        this._pitchAxis
          .set(1, 0, 0)
          .applyQuaternion(camera.quaternion)
          .normalize();
        this._pitchQuaternion.setFromAxisAngle(
          this._pitchAxis,
          -movementY * this._mouseSensitivity.pitch
        );
        camera.quaternion.premultiply(this._pitchQuaternion);
      }

      camera.quaternion.normalize();
      camera.updateMatrixWorld(true);
    }

    _SetupPointerLock() {
      const hasPointerLock =
        "pointerLockElement" in document ||
        "mozPointerLockElement" in document ||
        "webkitPointerLockElement" in document;
      if (hasPointerLock) {
        const lockChange = (event) => {
          if (
            document.pointerLockElement === document.body ||
            document.mozPointerLockElement === document.body ||
            document.webkitPointerLockElement === document.body
          ) {
            this._enabled = true;
          } else {
            // Only disable on non-touch devices (mobile controls handle their own enabled state)
            if (!this._isTouchDevice) {
              this._enabled = false;
            }
          }
        };
        const lockError = (event) => {
          console.log(event);
        };

        document.addEventListener("pointerlockchange", lockChange, false);
        document.addEventListener("webkitpointerlockchange", lockChange, false);
        document.addEventListener("mozpointerlockchange", lockChange, false);
        document.addEventListener("pointerlockerror", lockError, false);
        document.addEventListener("mozpointerlockerror", lockError, false);
        document.addEventListener("webkitpointerlockerror", lockError, false);

        document.getElementById("target").addEventListener(
          "click",
          (event) => {
            document.body.requestPointerLock =
              document.body.requestPointerLock ||
              document.body.mozRequestPointerLock ||
              document.body.webkitRequestPointerLock;

            if (/Firefox/i.test(navigator.userAgent)) {
              const fullScreenChange = (event) => {
                if (
                  document.fullscreenElement === document.body ||
                  document.mozFullscreenElement === document.body ||
                  document.mozFullScreenElement === document.body
                ) {
                  document.removeEventListener(
                    "fullscreenchange",
                    fullScreenChange
                  );
                  document.removeEventListener(
                    "mozfullscreenchange",
                    fullScreenChange
                  );
                  document.body.requestPointerLock();
                }
              };
              document.addEventListener(
                "fullscreenchange",
                fullScreenChange,
                false
              );
              document.addEventListener(
                "mozfullscreenchange",
                fullScreenChange,
                false
              );
              document.body.requestFullscreen =
                document.body.requestFullscreen ||
                document.body.mozRequestFullscreen ||
                document.body.mozRequestFullScreen ||
                document.body.webkitRequestFullscreen;
              document.body.requestFullscreen();
            } else {
              document.body.requestPointerLock();
            }
          },
          false
        );
      }
    }

    _SetupGamepad() {
      const onGamepadConnected = (event) => {
        this._gamepad = event.gamepad;
      };

      const onGamepadDisconnected = (event) => {
        if (this._gamepad && this._gamepad.index === event.gamepad.index) {
          this._gamepad = null;
        }
      };

      window.addEventListener("gamepadconnected", onGamepadConnected, false);
      window.addEventListener(
        "gamepaddisconnected",
        onGamepadDisconnected,
        false
      );

      // Check for already connected gamepads
      const gamepads = navigator.getGamepads();
      for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i]) {
          this._gamepad = gamepads[i];
          break;
        }
      }
    }

    _SetupTouchControls() {
      // Show mobile controls UI
      const mobileControls = document.getElementById("mobile-controls");
      if (mobileControls) {
        mobileControls.style.display = "flex";
        mobileControls.classList.add("mobile-controls-visible");
      }

      // Enable controls automatically on mobile
      this._enabled = true;

      // Touch look (camera rotation) - handle touch drag on canvas
      const domElement = this._params.domElement;

      this._touchStartHandler = (e) => this._OnTouchStart(e);
      this._touchMoveHandler = (e) => this._OnTouchMove(e);
      this._touchEndHandler = (e) => this._OnTouchEnd(e);

      domElement.addEventListener("touchstart", this._touchStartHandler, {
        passive: false,
      });
      domElement.addEventListener("touchmove", this._touchMoveHandler, {
        passive: false,
      });
      domElement.addEventListener("touchend", this._touchEndHandler, {
        passive: false,
      });
      domElement.addEventListener("touchcancel", this._touchEndHandler, {
        passive: false,
      });

      // Movement buttons
      this._SetupMovementButtons();

      // Acceleration buttons
      this._SetupAccelerationButtons();
    }

    _SetupMovementButtons() {
      const buttons = {
        backward: document.getElementById("mobile-btn-forward"), // Inverted: forward button moves backward
        forward: document.getElementById("mobile-btn-backward"), // Inverted: backward button moves forward
        left: document.getElementById("mobile-btn-left"),
        right: document.getElementById("mobile-btn-right"),
        up: document.getElementById("mobile-btn-up"),
        down: document.getElementById("mobile-btn-down"),
      };

      for (const [direction, button] of Object.entries(buttons)) {
        if (button) {
          const touchStart = (e) => {
            e.preventDefault();
            this._move[direction] = true;
          };
          const touchEnd = (e) => {
            e.preventDefault();
            this._move[direction] = false;
          };

          button.addEventListener("touchstart", touchStart, { passive: false });
          button.addEventListener("touchend", touchEnd, { passive: false });
          button.addEventListener("touchcancel", touchEnd, { passive: false });
        }
      }
    }

    _SetupAccelerationButtons() {
      const increaseBtn = document.getElementById("mobile-btn-accel-increase");
      const decreaseBtn = document.getElementById("mobile-btn-accel-decrease");

      if (increaseBtn) {
        const touchStart = (e) => {
          e.preventDefault();
          this._AdjustAcceleration(0.5);
        };
        increaseBtn.addEventListener("touchstart", touchStart, {
          passive: false,
        });
      }

      if (decreaseBtn) {
        const touchStart = (e) => {
          e.preventDefault();
          this._AdjustAcceleration(-0.5);
        };
        decreaseBtn.addEventListener("touchstart", touchStart, {
          passive: false,
        });
      }
    }

    _AdjustAcceleration(change) {
      const current = this._params.guiParams.camera.acceleration_x;
      const next = Math.max(
        this._minAcceleration,
        Math.min(this._maxAcceleration, current + change)
      );

      if (next !== current) {
        this._params.guiParams.camera.acceleration_x = next;
        this._acceleration.set(next, next, next);

        if (this._speedController) {
          this._speedController.updateDisplay();
        }
      }
    }

    _OnTouchStart(e) {
      if (!this._enabled || e.touches.length === 0) {
        return;
      }

      // Check if touch is on a button (don't start look if so)
      const touch = e.touches[0];
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      if (target && target.closest("#mobile-controls")) {
        return;
      }

      // Start touch look
      this._touchLookActive = true;
      this._lastTouchX = touch.clientX;
      this._lastTouchY = touch.clientY;
      e.preventDefault();
    }

    _OnTouchMove(e) {
      if (!this._enabled || !this._touchLookActive || e.touches.length === 0) {
        return;
      }

      const touch = e.touches[0];
      const deltaX = touch.clientX - this._lastTouchX;
      const deltaY = touch.clientY - this._lastTouchY;

      if (deltaX === 0 && deltaY === 0) {
        return;
      }

      const camera = this._camera;

      if (deltaX !== 0) {
        this._yawAxis
          .set(0, 1, 0)
          .applyQuaternion(camera.quaternion)
          .normalize();
        this._yawQuaternion.setFromAxisAngle(
          this._yawAxis,
          -deltaX * this._touchSensitivity.yaw
        );
        camera.quaternion.premultiply(this._yawQuaternion);
      }

      if (deltaY !== 0) {
        this._pitchAxis
          .set(1, 0, 0)
          .applyQuaternion(camera.quaternion)
          .normalize();
        this._pitchQuaternion.setFromAxisAngle(
          this._pitchAxis,
          -deltaY * this._touchSensitivity.pitch
        );
        camera.quaternion.premultiply(this._pitchQuaternion);
      }

      camera.quaternion.normalize();
      camera.updateMatrixWorld(true);

      this._lastTouchX = touch.clientX;
      this._lastTouchY = touch.clientY;
      e.preventDefault();
    }

    _OnTouchEnd(e) {
      if (e.touches.length === 0) {
        this._touchLookActive = false;
      }
    }

    _ApplyDeadZone(value, deadZone) {
      if (Math.abs(value) < deadZone) {
        return 0;
      }
      const sign = value >= 0 ? 1 : -1;
      const adjustedValue = (Math.abs(value) - deadZone) / (1 - deadZone);
      return sign * adjustedValue;
    }

    _UpdateGamepadInput(timeInSeconds) {
      if (!this._enabled) {
        return;
      }

      // Poll gamepad state
      const gamepads = navigator.getGamepads();
      let gamepad = null;

      if (this._gamepad) {
        gamepad = gamepads[this._gamepad.index];
        if (!gamepad || !gamepad.connected) {
          this._gamepad = null;
          gamepad = null;
        }
      }

      if (!gamepad) {
        // Try to find first connected gamepad
        for (let i = 0; i < gamepads.length; i++) {
          if (gamepads[i] && gamepads[i].connected) {
            this._gamepad = gamepads[i];
            gamepad = gamepads[i];
            break;
          }
        }
      }

      if (!gamepad) {
        return;
      }

      const axes = gamepad.axes;
      const buttons = gamepad.buttons;

      // Left stick: movement (axes[0] = left/right, axes[1] = forward/backward)
      const leftStickX = this._ApplyDeadZone(
        axes[0] || 0,
        this._gamepadDeadZone
      );
      const leftStickY = this._ApplyDeadZone(
        axes[1] || 0,
        this._gamepadDeadZone
      );

      // Update movement state based on left stick
      // Note: keyboard mapping uses backward=true for forward movement and forward=true for backward movement
      this._move.left = leftStickX < 0;
      this._move.right = leftStickX > 0;
      this._move.backward = leftStickY < 0; // inverted: stick backward = backward flag (moves forward)
      this._move.forward = leftStickY > 0; // inverted: stick forward = forward flag (moves backward)

      // Right stick: camera rotation (axes[2] = yaw, axes[3] = pitch)
      const rightStickX = this._ApplyDeadZone(
        axes[2] || 0,
        this._gamepadDeadZone
      );
      const rightStickY = this._ApplyDeadZone(
        axes[3] || 0,
        this._gamepadDeadZone
      );

      // Apply camera rotation
      if (rightStickX !== 0 || rightStickY !== 0) {
        const camera = this._camera;

        if (rightStickX !== 0) {
          this._yawAxis
            .set(0, 1, 0)
            .applyQuaternion(camera.quaternion)
            .normalize();
          this._yawQuaternion.setFromAxisAngle(
            this._yawAxis,
            -rightStickX * this._gamepadSensitivity.yaw * timeInSeconds * 60
          );
          camera.quaternion.premultiply(this._yawQuaternion);
        }

        if (rightStickY !== 0) {
          this._pitchAxis
            .set(1, 0, 0)
            .applyQuaternion(camera.quaternion)
            .normalize();
          this._pitchQuaternion.setFromAxisAngle(
            this._pitchAxis,
            -rightStickY * this._gamepadSensitivity.pitch * timeInSeconds * 60
          );
          camera.quaternion.premultiply(this._pitchQuaternion);
        }

        camera.quaternion.normalize();
        camera.updateMatrixWorld(true);
      }

      // Triggers for acceleration adjustment
      // Check both axes and buttons (different gamepads map triggers differently)
      let leftTrigger = 0;
      let rightTrigger = 0;

      // Try triggers as axes first (standard mapping: axes[4] = left, axes[5] = right)
      if (axes.length > 4 && axes[4] !== undefined) {
        // Handle both positive and negative values
        leftTrigger = Math.abs(axes[4]);
      }
      if (axes.length > 5 && axes[5] !== undefined) {
        rightTrigger = Math.abs(axes[5]);
      }

      // Also check if triggers are mapped as buttons (buttons[6] = left, buttons[7] = right)
      if (buttons.length > 6 && buttons[6]) {
        const buttonValue =
          buttons[6].value !== undefined
            ? buttons[6].value
            : buttons[6].pressed
            ? 1
            : 0;
        leftTrigger = Math.max(leftTrigger, buttonValue);
      }
      if (buttons.length > 7 && buttons[7]) {
        const buttonValue =
          buttons[7].value !== undefined
            ? buttons[7].value
            : buttons[7].pressed
            ? 1
            : 0;
        rightTrigger = Math.max(rightTrigger, buttonValue);
      }

      // Normalize trigger values to 0-1 range
      leftTrigger = Math.max(0, Math.min(1, leftTrigger));
      rightTrigger = Math.max(0, Math.min(1, rightTrigger));

      // D-pad for up/down movement
      const dpadUp = buttons[12] && buttons[12].pressed;
      const dpadDown = buttons[13] && buttons[13].pressed;
      this._move.up = dpadUp;
      this._move.down = dpadDown;

      // Adjust acceleration with triggers (step-based, similar to mouse wheel)
      // Lower threshold to be more responsive (0.2 instead of 0.5)
      const leftTriggerActive = leftTrigger > 0.2;
      const rightTriggerActive = rightTrigger > 0.2;
      const anyTriggerActive = leftTriggerActive || rightTriggerActive;

      // Debug: log trigger values occasionally (first time or when changed)
      if (
        !this._lastLeftTrigger ||
        Math.abs(this._lastLeftTrigger - leftTrigger) > 0.1 ||
        !this._lastRightTrigger ||
        Math.abs(this._lastRightTrigger - rightTrigger) > 0.1
      ) {
        // Removed debug log for triggers
        this._lastLeftTrigger = leftTrigger;
        this._lastRightTrigger = rightTrigger;
      }

      if (anyTriggerActive) {
        this._gamepadTriggerStepDelay += timeInSeconds;
        if (this._gamepadTriggerStepDelay >= this._gamepadTriggerStepInterval) {
          this._gamepadTriggerStepDelay = 0;

          const step = 0.5;
          let accelerationChange = 0;

          if (leftTriggerActive && !rightTriggerActive) {
            // Left trigger decreases acceleration
            accelerationChange = -step;
          } else if (rightTriggerActive && !leftTriggerActive) {
            // Right trigger increases acceleration
            accelerationChange = step;
          }
          // If both triggers are pressed, they cancel out (no change)

          if (accelerationChange !== 0) {
            const current = this._params.guiParams.camera.acceleration_x;
            const next = Math.max(
              this._minAcceleration,
              Math.min(this._maxAcceleration, current + accelerationChange)
            );

            if (next !== current) {
              this._params.guiParams.camera.acceleration_x = next;
              this._acceleration.set(next, next, next);

              if (this._speedController) {
                this._speedController.updateDisplay();
              }
              // Removed debug log for acceleration adjustment
            }
          }
        }
      } else {
        // Reset delay when no triggers are pressed for better responsiveness
        this._gamepadTriggerStepDelay = 0;
      }

      // Shoulder buttons for roll (inverted)
      const leftShoulder = buttons[4] && buttons[4].pressed;
      const rightShoulder = buttons[5] && buttons[5].pressed;
      this._move.rotateLeft = rightShoulder; // inverted
      this._move.rotateRight = leftShoulder; // inverted

      // Start button to exit pointer lock (like Escape)
      const startButton = buttons[9] && buttons[9].pressed;
      if (startButton && !this._gamepadStartButtonPressed) {
        this._gamepadStartButtonPressed = true;
        const exitPointerLock =
          document.exitPointerLock ||
          document.mozExitPointerLock ||
          document.webkitExitPointerLock;
        if (exitPointerLock) {
          exitPointerLock.call(document);
        }
      } else if (!startButton) {
        this._gamepadStartButtonPressed = false;
      }
    }

    _FindIntersections(boxes, position) {
      const sphere = new THREE.Sphere(position, this._radius);

      const intersections = boxes.filter((b) => {
        return sphere.intersectsBox(b);
      });

      return intersections;
    }

    Update(timeInSeconds) {
      if (!this._enabled) {
        return;
      }

      this._UpdateGamepadInput(timeInSeconds);

      const frameDecceleration = new THREE.Vector3(
        this._velocity.x * this._decceleration.x,
        this._velocity.y * this._decceleration.y,
        this._velocity.z * this._decceleration.z
      );
      frameDecceleration.multiplyScalar(timeInSeconds);

      this._velocity.add(frameDecceleration);

      if (this._move.forward) {
        this._velocity.z -= 2 ** this._acceleration.z * timeInSeconds;
      }
      if (this._move.backward) {
        this._velocity.z += 2 ** this._acceleration.z * timeInSeconds;
      }
      if (this._move.left) {
        this._velocity.x -= 2 ** this._acceleration.x * timeInSeconds;
      }
      if (this._move.right) {
        this._velocity.x += 2 ** this._acceleration.x * timeInSeconds;
      }
      if (this._move.up) {
        this._velocity.y += 2 ** this._acceleration.y * timeInSeconds;
      }
      if (this._move.down) {
        this._velocity.y -= 2 ** this._acceleration.y * timeInSeconds;
      }

      let rollDelta = 0;
      if (this._move.rotateLeft) {
        rollDelta += this._rotationSpeed * timeInSeconds;
      }
      if (this._move.rotateRight) {
        rollDelta -= this._rotationSpeed * timeInSeconds;
      }
      if (rollDelta !== 0) {
        this._rollAxis
          .set(0, 0, -1)
          .applyQuaternion(this._camera.quaternion)
          .normalize();
        this._rollQuaternion.setFromAxisAngle(this._rollAxis, rollDelta);
        this._camera.quaternion.premultiply(this._rollQuaternion);
        this._camera.quaternion.normalize();
        this._camera.updateMatrixWorld(true);
      }

      this._camera.updateMatrixWorld(true);
      const cameraQuaternion = this._camera.getWorldQuaternion(
        this._cameraWorldQuaternion
      );

      const forward = this._forwardVector
        .set(0, 0, -1)
        .applyQuaternion(cameraQuaternion)
        .normalize();
      const sideways = this._sideVector
        .set(1, 0, 0)
        .applyQuaternion(cameraQuaternion)
        .normalize();
      const updown = this._upVector
        .set(0, 1, 0)
        .applyQuaternion(cameraQuaternion)
        .normalize();

      this._camera.position.addScaledVector(
        forward,
        this._velocity.z * timeInSeconds
      );
      this._camera.position.addScaledVector(
        sideways,
        this._velocity.x * timeInSeconds
      );
      this._camera.position.addScaledVector(
        updown,
        this._velocity.y * timeInSeconds
      );

      this._camera.updateMatrixWorld(true);
    }
  }

  class _ShipControls {
    constructor(params) {
      this._Init(params);
    }

    _Init(params) {
      this._params = params;
      this._radius = 2;
      this._enabled = false;
      this._move = {
        forward: false,
        backward: false,
        left: false,
        right: false,
        up: false,
        down: false,
        rocket: false,
      };
      this._velocity = new THREE.Vector3(0, 0, 0);
      this._decceleration = new THREE.Vector3(-0.001, -0.0001, -1);
      this._acceleration = new THREE.Vector3(100, 0.1, 25000);

      document.addEventListener("keydown", (e) => this._onKeyDown(e), false);
      document.addEventListener("keyup", (e) => this._onKeyUp(e), false);

      this._InitGUI();
    }

    _InitGUI() {
      this._params.guiParams.camera = {
        acceleration_x: 100,
        acceleration_y: 0.1,
      };

      const rollup = this._params.gui.addFolder("Camera.Ship");
      rollup
        .add(this._params.guiParams.camera, "acceleration_x", 50.0, 25000.0)
        .onChange(() => {
          this._acceleration.x = this._params.guiParams.camera.acceleration_x;
        });
      rollup
        .add(this._params.guiParams.camera, "acceleration_y", 0.001, 0.1)
        .onChange(() => {
          this._acceleration.y = this._params.guiParams.camera.acceleration_y;
        });
    }

    _onKeyDown(event) {
      switch (event.keyCode) {
        case 87: // w
          this._move.forward = true;
          break;
        case 65: // a
          this._move.left = true;
          break;
        case 83: // s
          this._move.backward = true;
          break;
        case 68: // d
          this._move.right = true;
          break;
        case 33: // PG_UP
          this._acceleration.x *= 1.1;
          break;
        case 34: // PG_DOWN
          this._acceleration.x *= 0.8;
          break;
        case 32: // SPACE
          this._move.rocket = true;
          break;
        case 38: // up
        case 37: // left
        case 40: // down
        case 39: // right
          break;
      }
    }

    _onKeyUp(event) {
      switch (event.keyCode) {
        case 87: // w
          this._move.forward = false;
          break;
        case 65: // a
          this._move.left = false;
          break;
        case 83: // s
          this._move.backward = false;
          break;
        case 68: // d
          this._move.right = false;
          break;
        case 33: // PG_UP
          break;
        case 34: // PG_DOWN
          break;
        case 32: // SPACE
          this._move.rocket = false;
          break;
        case 38: // up
        case 37: // left
        case 40: // down
        case 39: // right
          break;
      }
    }

    Update(timeInSeconds) {
      const frameDecceleration = new THREE.Vector3(
        this._velocity.x * this._decceleration.x,
        this._velocity.y * this._decceleration.y,
        this._velocity.z * this._decceleration.z
      );
      frameDecceleration.multiplyScalar(timeInSeconds);

      this._velocity.add(frameDecceleration);

      const controlObject = this._params.camera;
      const _Q = new THREE.Quaternion();
      const _A = new THREE.Vector3();
      const _R = controlObject.quaternion.clone();

      if (this._move.forward) {
        _A.set(1, 0, 0);
        _Q.setFromAxisAngle(
          _A,
          -Math.PI * timeInSeconds * this._acceleration.y
        );
        _R.multiply(_Q);
      }
      if (this._move.backward) {
        _A.set(1, 0, 0);
        _Q.setFromAxisAngle(_A, Math.PI * timeInSeconds * this._acceleration.y);
        _R.multiply(_Q);
      }
      if (this._move.left) {
        _A.set(0, 0, 1);
        _Q.setFromAxisAngle(_A, Math.PI * timeInSeconds * this._acceleration.y);
        _R.multiply(_Q);
      }
      if (this._move.right) {
        _A.set(0, 0, 1);
        _Q.setFromAxisAngle(
          _A,
          -Math.PI * timeInSeconds * this._acceleration.y
        );
        _R.multiply(_Q);
      }
      if (this._move.rocket) {
        this._velocity.z -= this._acceleration.x * timeInSeconds;
      }

      controlObject.quaternion.copy(_R);

      const oldPosition = new THREE.Vector3();
      oldPosition.copy(controlObject.position);

      const forward = new THREE.Vector3(0, 0, 1);
      forward.applyQuaternion(controlObject.quaternion);
      //forward.y = 0;
      forward.normalize();

      const updown = new THREE.Vector3(0, 1, 0);

      const sideways = new THREE.Vector3(1, 0, 0);
      sideways.applyQuaternion(controlObject.quaternion);
      sideways.normalize();

      sideways.multiplyScalar(this._velocity.x * timeInSeconds);
      updown.multiplyScalar(this._velocity.y * timeInSeconds);
      forward.multiplyScalar(this._velocity.z * timeInSeconds);

      controlObject.position.add(forward);
      controlObject.position.add(sideways);
      controlObject.position.add(updown);

      oldPosition.copy(controlObject.position);
    }
  }

  return {
    ShipControls: _ShipControls,
    FPSControls: _FPSControls,
    OrbitControls: _OrbitControls,
  };
})();
