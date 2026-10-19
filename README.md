# clai

A small, browser-local 3D clay playground. Static HTML, CSS and ES modules; no application framework or server required. Runtime assets, including Three.js and DM Sans, are served locally.

## Play

Serve `dist/` with any static HTTP server, for example `python -m http.server 8000 --directory dist`, then open `http://localhost:8000`.

- Start with one ball. Squish, stretch, grow, smooth, and paint; adjust brush size and mirror strokes along X. Hold Grow to build rounded volume.
- Shapes opens a ball, egg, pill, and rounded-cube picker. Set Soft blend, pick a primitive, then tap the clay to fuse it in. A translucent preview follows the mouse; touch users can drag to position and release to place. Shape size uses the brush-size slider, selected colors blend into the addition, and Mirror magic adds both sides. Palette changes keep shape placement active. Every addition is undoable.
- Drag the background to orbit. Two fingers rotate and pinch; a mouse wheel zooms. The pottery wheel keeps turning while every brush is in use, including a stationary held brush. Stylus pressure changes brush strength.
- Reset smoothly returns the shape to a ball, keeps paint, and creates a single undo step. The animation respects reduced motion. New clay starts another ball; undo restores the previous creation.
- 24-step undo/redo with a memory ceiling, PNG snapshots, editable `.clai` files and geometry-only OBJ export.
- IndexedDB stores the current creation and a local shelf. Download `.clai` files to move work between devices or retain backups. No accounts, remote storage, tracking, chat, or external requests are part of the application.

## Design and compatibility

Inspired by the compact controls, clear selection states, and tactile feedback in Glyphnote's `FlipnoteHeader.tsx` and `FlipnoteToolbar.tsx`, and Diecard's `docs/UI-LAYOUT-AUDIT.md`, `docs/TV-SCALING-REVIEW.md`, and platform handling. The implementation is original. Layout uses the available viewport, safe-area insets, portrait/landscape arrangements, large-screen UI scaling, reduced motion, focus indicators, accessible names, and a defensive fullscreen action.

The canvas needs WebGL. Three.js r160 supports both WebGL 1 and WebGL 2. The application targets current Safari, Chrome, Edge and Firefox on phones, tablets and computers. Universal physical-device compatibility has not been verified.

## Performance

The mesh uses 10,242 evenly distributed, welded vertices, mutable typed buffers, precomputed adjacency and a spatial hash for localized brush queries. Primitive additions use bounding-sphere rejection, analytic ray intersections where available, and a short distance-field solve only within the affected footprint. Each addition is baked into the same surface: there is no growing list of primitive objects to evaluate, no voxel-grid remeshing, and no increase in rendered clay vertices or triangles. Cached low-detail primitive geometry supplies the placement preview. The view zooms out when needed to keep additions visible.

Input is coalesced once per animation frame. Normals update only for edited meshes, shadows refresh when geometry changes, painting skips shadow rebuilds, pixel density is capped at 1.75, and the renderer sleeps when idle or hidden. The pottery wheel is off by default. Undo history is capped at 24 states and an approximate 48 MB budget. The primitive stress test records median and p95 CPU time on its runner, independently of rendering; those figures are not device frame-rate measurements.

## Protected geometry

Clai represents clay as a positive radial height field over a fixed icosphere. Brushes change the distance along each fixed direction; they cannot change vertex connections or move vertices sideways into another face's spherical cone. The spherical triangulation covers every direction once, so the resulting mesh stays a single closed surface without holes, inverted faces, or self-intersections. This is a structural property of the representation rather than a collision check that might miss a fast stroke.

Radius stays between 0.9216 and 3.2 world units, with an additional limit above the work surface. Neighboring log radii differ by at most 1.15 times their angular separation. The radial lower bound retains a substantial solid core; the angular bound limits narrow protrusions and stretched triangles. Grow and Squish propagate a rounded envelope into nearby clay as needed, making the limits feel soft. Every proposed stroke is constrained before positions are committed. Reset interpolates log radii towards zero, which preserves the same constraints at every animation frame.

Primitive additions use a polynomial smooth union between the current radial implicit surface and sphere, ellipsoid, capsule, or rounded-box distance fields. The outer intersection is committed through the same protected angular envelope used by Grow. Additions merge into the existing body rather than leaving intersecting mesh objects. The radial representation can broaden joins and fill overhangs to maintain its guarantees; it does not permit detached components or arbitrary tunnels.

This representation deliberately restricts overhangs, tunnels, and extreme thin shapes. Older files are sampled into the protected representation on opening. On the first update, an earlier autosave is kept on the shelf and the studio opens a fresh ball. Protected creations resume normally on later visits. Geometry exports use the protected surface.

## Check

`npm ci` installs development-only test dependencies. `npm test` exercises all four primitive fields, 100 repeated primitive additions, smooth joins and pigments, mirrored placement, touch release and pinch cancellation, constant geometry memory, mesh topology, sustained growth, opposing dents, extreme stretches, 2,200 seeded mixed strokes, angular limits, outward face orientation, triangle distortion, protected file conversion, animated reset and undo, every tool on the running wheel, painting, save/import validation, OBJ indices, IndexedDB round trips, and DOM interaction flows. `npm run check` checks JavaScript syntax.

The DOM interaction checks substitute the renderer and do not test WebGL rendering, layout pixels, or actual device input. Browser visual QA was unavailable in the build session. Check the live app on target devices before a broader release, particularly phone rotation, simultaneous touch gestures, storage limits, and GPU context loss.

## Files

- `dist/studio.js`: rendering, camera, pointer input, and starter construction.
- `dist/sculpt.js`: brush math, spatial indexing, history, and file formats.
- `dist/primitives.js`: distance fields, smooth-union blending, and primitive placement math.
- `dist/app.js`: UI flows and project state.
- `dist/storage.js`: transactional browser storage.
- `dist/style.css`: responsive studio layout.

Third-party licenses are included alongside the vendored library and font.
