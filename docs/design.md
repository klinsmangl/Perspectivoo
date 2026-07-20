# Design — OpenLayers Oblique Image Viewer

## Architecture
Three static files, no framework, no bundler:

| File | Role |
|------|------|
| `index.html` | DOM scaffold: map div, compass overlay (SVG slices + Nadir button), loading overlay. Loads CDN libs + `app.js`. |
| `app.css` | Layout (full-viewport map) and compass styling (conic-gradient border, slice hover/active states). |
| `app.js` | All behavior: projection setup, map/layers, GeoJSON load, click handling, COG loading, compass rotation. |

External libs (CDN, global scope): `ol`, `proj4`, `GeoTIFF`, Bootstrap CSS.

## Coordinate systems
- **EPSG:3857** (Web Mercator) — map display + the COGs' native projection.
- **EPSG:31984** (SIRGAS 2000 / UTM 24S) — the GeoJSON point coordinates.
  Registered with proj4 at startup (`app.js:1-3`).
- Click coords are transformed 3857→31984 only for nearest-point distance math
  (`app.js:162`). COGs need no reprojection.

## Layers (z-order)
1. `baseLayer` — OSM tiles.
2. `currentImageLayers[dir]` — WebGLTile COG layers, `zIndex: 10`, one per direction.
3. `markerLayer` — clicked-point marker, `zIndex: 100`.

## State (module globals in `app.js`)
- `geojsonFeatures` — raw GeoJSON features (kept in EPSG:31984 for distance math).
- `currentImageLayers` — `{ dir: layer }` for the active point.
- `currentPointCoords` — last clicked coordinate (EPSG:3857), used as rotation anchor.
- `isNadirActive` — Nadir vs. oblique mode.
- `currentActiveDir` — last shown direction, to skip redundant fades.

## Key flows

### Click
`singleclick` → `processClick()`:
1. Redraw marker.
2. Transform click to 31984.
3. For each direction, pick the nearest feature (squared distance, `app.js:166-175`).
4. Remove old layers, load a COG layer per direction; active dir opacity 1, others 0.
5. Show/hide loading overlay by counting resolved sources.

### Rotation / direction
- Compass slice `onclick="setMapRotation(deg)"` → `view.animate({rotation})`.
- `change:rotation` handler updates the degree readout, the `--map-rotation` CSS var
  (rotates the gradient border), and calls `refreshDirection()`.
- `getActiveDirection()` maps rotation to the nearest 90° quadrant
  (`DIRECTIONS[((quadrant % 4) + 4) % 4]`), or returns `Nadir` when `isNadirActive`.
- `updateLayerVisibility()` cross-fades to the active direction's layer only if it changed.

### Fade
`fadeLayer()` (`app.js:118-140`) — `requestAnimationFrame` opacity tween, cancels any
in-flight animation on the same layer via `layer.animationId`.

## Conventions
- Direction order `['Left','Backward','Right','Forward']` is indexed by rotation
  quadrant; `Nadir` is appended for the full set `ALL_DIRS`.
- Rotation buttons call `window.setMapRotation` / `window.setNadir` — exposed globally
  because they're wired through inline HTML `onclick`.

## Known simplifications
- Nearest-point search is a linear scan over all features per click — fine for the
  expected point count; would need a spatial index only at large scale.
- A failed COG load resolves silently (logged to console) so the overlay still hides.
