import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.112.1/build/three.module.js";

import { spline } from "./spline.js";

export const camera_track = (function () {
  class _CameraTrack {
    constructor(params) {
      this._params = params;
      this._currentTime = 0.0;
      this._paused = params.paused !== undefined ? params.paused : false;

      // Easing function: fast start, slow end (ease-out cubic)
      // If no easing function provided, use default ease-out
      this._easing =
        params.easing ||
        ((t) => {
          // Cubic ease-out: starts fast, slows down
          return 1 - Math.pow(1 - t, 3);
        });

      const lerp = (t, p1, p2) => {
        const p = new THREE.Vector3().lerpVectors(p1.pos, p2.pos, t);
        const q = p1.rot.clone().slerp(p2.rot, t);

        return { pos: p, rot: q };
      };
      this._spline = new spline.LinearSpline(lerp);

      // Find max time to normalize easing
      this._maxTime = 0;
      for (let p of params.points) {
        this._spline.AddPoint(p.time, p.data);
        this._maxTime = Math.max(this._maxTime, p.time);
      }
    }

    SetPaused(paused) {
      this._paused = paused;
    }

    Update(timeInSeconds) {
      // Don't update if paused
      if (this._paused) {
        return;
      }

      this._currentTime += timeInSeconds;

      // Normalize time to [0, 1] range
      const normalizedTime = Math.min(this._currentTime / this._maxTime, 1.0);

      // Apply easing function (fast start, slow end)
      const easedTime = this._easing(normalizedTime);

      // Convert back to actual time range
      const easedActualTime = easedTime * this._maxTime;

      const r = this._spline.Get(easedActualTime);

      this._params.camera.position.copy(r.pos);
      this._params.camera.quaternion.copy(r.rot);
    }
  }

  return {
    CameraTrack: _CameraTrack,
  };
})();
