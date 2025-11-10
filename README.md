# Procedural Terrain

A browser-based demo that assembles deformable planets and Halo-inspired ringworlds with procedural heightfields, oceans, and atmospheric lighting. Built with Three.js, it showcases a chunked, GPU-shaded terrain pipeline that can morph between orbital flyovers and ground-level exploration.

## Overview

- Multi-octave noise, biome colour ramps, and texture atlases feed custom shader materials to sculpt terrain in real time.
- A quadtree LOD system refines tiles around the active camera while a web worker (`terrain-builder-threaded`) rebuilds geometry off the main thread.
- Planet and ring scenes share the same terrain manager and automatically attach oceans, atmospheric scattering, and optional scenery placement.
- The `lil-gui` control panel exposes noise, biome, lighting, and camera parameters for quick experimentation.

## Scenes

Pick the scene type by appending `?scene=planet`, `?scene=ring`, or `?scene=both` to the URL.

- `planet`: spherical world with an orbit-to-surface guided camera track.
- `ring`: Halo-style ringworld rendered with an exterior shell for scale.
- `both`: renders planet and ring together so you can compare the two setups.

## Controls

- Click the canvas to enter pointer lock and enable the first-person controller.
- Movement: `W`/`S` forward/back, `A`/`D` strafe, `PgUp`/`PgDn` ascend/descend.
- Yaw/Pitch: move the mouse (or drag on touch devices).
- Roll: `Q`/`E`.
- Mouse wheel (or controller triggers) alters the current acceleration; fine-tune inside the `Camera.FPS` folder in the GUI.

## Prerequisites

- Node.js 18 or newer (for `npx`)
- npm (bundled with Node.js)

## Run Locally

1. From the project root, launch the development server:

   ```bash
   npx live-server . --watch=src,base.css,index.html --no-css-inject --open=index.html --port=5173
   ```

2. Open `http://127.0.0.1:5173/` (or the URL logged in the terminal). Keep the terminal running; the browser will refresh on save.
