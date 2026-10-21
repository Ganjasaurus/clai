# clai

A small, browser-local clay playground. Static HTML, CSS and ES modules; no framework or application server. Three.js, fonts, icons and synthesized audio are served or created locally.

## Play

- Fresh sessions start with a friendly head: ears, nose, painted eyes and a smile, all in one editable solid. New clay offers a head or a plain ball. Existing saves resume instead of being replaced.
- Six compact folder buttons open non-modal pullouts: Shape (Squish, Stretch, Grow, Clay pen), Cut (Carve, Engrave, Hole), Finish (Smooth, Flatten, Polish), Draw (Pen, Brush, Spray, Fill all), Shapes, and Color. Size, strength and Mirror magic live inside the folders. Touch the canvas to dismiss a pullout and keep creating; Escape closes it and returns keyboard focus.
- Stretch keeps a rounded connection as the hand moves. Clay pen draws raised lines along the stroke plane, including beyond the silhouette. Grow adds rounded volume while held. Shapes adds blended balls, eggs, pills or rounded cubes with a placement preview, adjustable size and soft joins.
- Hole cuts a tunnel along the current viewing ray; drag the preview, then release to place. Carve scoops continuously while held. Engrave makes smaller grooves. Squish can also go inward through the center. Flatten levels a local surface; Polish is a gentler smoothing pass.
- Draw has crisp, soft and spray profiles, adjustable size and color strength, and a whole-creation fill. The single Color button always shows the current color. Color choices stay available for clay pens and added shapes too.
- The four-arrow Move control pans the whole creation in the view without sculpting it. Zoom ranges from 8% to 400%, with much wider panning. Tap the percentage to recenter and fit larger creations. Background dragging or right-drag rotates; two fingers rotate and pinch to zoom. The pottery wheel continues while tools are used.
- Mirror magic applies strokes and additions to both sides. Overlapping brush regions use the stronger influence once. Stylus pressure adjusts strength.
- New clay contains starters and “Melt back to a ball,” which animates a reset and retains pigment. Reduced motion makes it immediate. Undo restores the previous shape, including tunnels. New clay is undoable too.
- The music-note pullout has independent music and clay-sound switches, volume, and “Try a squish” to enable and audition effects. Both start off. Music is an original, quiet synthesized melody; sounds are short synthesized tones. Audio unlocks on a user gesture, queues the first brush sound during asynchronous resume, recovers from suspended/interrupted contexts, stops scheduling while hidden, limits overlapping voices, and suspends when muted. Stopped voices are released immediately so backgrounding cannot exhaust the budget. There are no audio downloads.
- Keep it saves PNG, editable .clai or geometry-only OBJ files. IndexedDB saves locally and holds the shelf. Older saves are copied to the shelf before their first conversion to solid clay. Download a .clai file for a durable backup or another device.

Keyboard: 1–5 main brushes, 6 Reset, 7 Shapes, 8 Hole, 9 Carve, M Move, 0 recenter, [ and ] brush size, Ctrl/Cmd Z undo, Ctrl/Cmd Shift Z redo. Space or right-drag turns the view.

## Solid geometry

The active editor uses an editable signed scalar field on a fixed 65 × 65 × 65 sample lattice. The workspace expands automatically from a 3.6-unit half-width to at most 28.8 as additions approach an edge, resampling only on expansion. The underside stays at the same floor height. Memory stays bounded; wider workspaces trade fine detail for space, and brush minimums track sample spacing. Very small details can soften during expansion. There is no immutable central sphere. Primitive additions use smooth distance-field union; holes and scoops subtract volume. Interior pigment is available when a cut exposes new walls. Growth and squishing use rounded distance-field unions/subtractions so repeated strokes do not merely steepen a scalar gradient and stall. Stretch combines local displacement with a rounded bridge, avoiding a vanishing tip during long pulls. Smoothing and flattening update the same solid.

Meshing divides every cell into matching tetrahedra and caches crossing vertices by their global lattice edge. Neighboring cells share vertices, including interior tunnel walls; the extraction has no marching-cubes face ambiguity. Tiny zero values are nudged consistently, the outer lattice boundary remains empty, and the floor bounds the underside. Tests verify closed, oppositely oriented shared edges and actual unobstructed ray paths through tunnels.

This replaces the earlier radial representation, which could not represent tunnels, cavities or overhangs. The finite lattice limits very small details, and unrestricted subtraction does not provide an absolute minimum wall thickness or printability guarantee. Extreme edits can remove clay or separate parts. Reset and undo remain available, including for empty clay. A bounded mesh budget rejects an overly complex stroke and restores its previous solid. Invalid imports are fully validated and meshed before replacing the scene.

Version 3 .clai files store exact field bytes, pigment and workspace extent (grid format 2), preserving tunnels through save/load. Grid format 1 opens at its original extent. Expanded reset returns to the detailed starter grid; undo restores the earlier extent too. Versions 1 and 2 remain readable; legacy radial meshes are sampled into the solid. Exported OBJ geometry includes tunnel walls. Undo owns independent field, color, position and index buffers so topology changes cannot corrupt earlier states.

## Performance

Edits operate on local lattice regions. Cached chunk occupancy skips uniformly empty or solid regions during extraction. A reusable typed edge cache avoids duplicate mesh vertices, and distance-field gradients supply smooth normals. The clay is rendered as one indexed mesh; stamp count does not accumulate scene objects or grow the lattice. The geometry ceiling is 64,000 vertices and 128,000 triangles, using 16-bit indices. Head and ball starters use roughly 6,000–8,000 vertices.

Painting reuses surface topology, positions, normals and shadows; only pigment interpolation and the GPU color buffer change. GPU buffers are reused when their sizes match and explicitly disposed when topology size changes. Pointer moves are coalesced per frame. Pixel density is capped at 1.75; the renderer sleeps when idle or hidden, and the wheel starts off. Undo is capped at 24 states and an approximate 48 MB budget, including solid-field data.

The CPU benchmark exercises 180 mixed edits plus mesh extraction and records median/p95 on its runner. It is not a GPU benchmark or a physical-device frame-rate promise.

## Design and compatibility

Original interface inspired by the compact, tactile controls in Glyphnote and the viewport and safe-area guidance in Diecard. Six folder buttons replace the seven-tool rail and always-open palette. Folder, primitive, color, starter and sound controls share a lightweight pullout, with animated opening and 44-pixel minimum primary touch targets. Document actions such as saving and the shelf retain dialogs. Portrait, landscape, short screens, large screens, reduced motion and keyboard focus have explicit styles. The phone view controls keep Move and recenter reachable.

Three.js r160 supports WebGL 1 and WebGL 2. The app targets current Safari, Chrome, Edge and Firefox on phones, tablets and computers. Web Audio is optional and fails quietly if unavailable. No app tracking, remote storage or external runtime assets are used.

## Validation

`npm ci` installs development-only test dependencies. `npm test` covers the active solid geometry, real through-hole raycasts, manifold topology, mirrored edits, center removal, repeated edits, painting, all primitive types after carving, exact save/reopen, topology-safe undo, reset including reduced motion, empty clay, complexity rollback, invalid imports, legacy conversion, view panning, touch release and pinch cancellation, wheel continuity, long pointer strokes past the silhouette, expansion and exact extent persistence, expanded reset, deep zoom/panning, pen profiles and fill, audio unlock/interruption recovery and voice limits, IndexedDB and pullout DOM flows. Legacy radial tests remain to cover older data and conversion helpers. `npm run check` checks module syntax.

Browser visual/audio QA was unavailable in this build session. DOM checks substitute the renderer; Three.js tests exercise geometry and raycasting without a GPU. Physical phone/tablet/desktop rendering, touch feel and sound quality still need device validation. No browser preview server or alternative browser-control path was used.

## Source

- `dist/volume.js`: editable solid field, meshing, migration and compact persistence.
- `dist/studio.js`: rendering, camera, pointer input, previews and reset animation.
- `dist/sculpt.js`: legacy radial helpers, history and file formats.
- `dist/primitives.js`: primitive distance fields and legacy primitive blending.
- `dist/audio.js`: optional synthesized music and effects.
- `dist/app.js`: compact UI flows and project state.
- `dist/storage.js`: transactional local storage.
- `dist/style.css`: responsive studio layout.

Third-party licenses accompany the vendored library and font.
