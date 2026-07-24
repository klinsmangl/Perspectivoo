# Design — PerspectiVôo (slim JPG+JGW viewer)

## Architecture
Three static files, no framework, no bundler:

| File | Role |
|------|------|
| `index.html` | DOM scaffold: map div, compass overlay (SVG slices + Nadir button), cycle control (prev/next + dots), loading overlay. Loads CDN libs + `app.slim.js`. |
| `app.css` | Layout, compass styling (conic-gradient border, slice hover/active states), cycle-dot styling. |
| `app.slim.js` | All behavior: projection setup, map/layers, index + footprint load, click handling, candidate cycling, two-tier image loading, compass rotation, URL sync. |

External libs (CDN, global scope): `ol` 9.2.4, `proj4` 2.11.0, Bootstrap CSS (styling only).
`app.js`, `app.jpg.js` and `pontos31984.geojson` are earlier prototypes, not loaded by `index.html`.

## Coordinate systems
- **EPSG:3857** (Web Mercator) — map display projection.
- **EPSG:31984** (SIRGAS 2000 / UTM 24S) — each photo's `.jgw` world-file coefficients;
  registered with proj4 at startup (`app.slim.js:7-8`). The extent computed from a
  photo's `jgw` is transformed 31984→3857 once, in `makeSource()`.
- **EPSG:4326** — the remote `OBQ-FOOTPRINT.geojson` (point features), read with
  `featureProjection: 'EPSG:3857'` straight into `dataSource`.
- Images are drawn with `ol.source.ImageStatic` at a pre-transformed 3857 extent
  (no per-frame reprojection) — see "Known simplifications".

## Data sources
- `obq_index/FXnnnn.json` — served locally, one shard per FX flight-line code, each mapping
  `name -> { dir, w, h, jgw }` (enriched format: subfolder, pixel size, world-file
  coefficients). Old-format entries (`name -> "SUBPASTA"` string) are also accepted;
  `w`/`h`/`jgw` are then fetched per-image as a fallback (`name.jgw` + probing the JPG's
  natural size). Shards are generated from `obq_index.json` by `scripts/shard-index.js`
  and fetched lazily by `getMeta()`, one per FX code actually needed, instead of loading
  the ~6MB combined index upfront.
- `OBQ-FOOTPRINT.geojson` — fetched from the remote tile server on startup, gives every
  photo's location (`properties.name`, `properties.view_th`) as point features. Loaded
  into `dataSource`, a `Vector` source never added to the map — used purely as an
  rbush-backed spatial index via `getClosestFeatureToCoordinate`.
- Photos live at `IMG_DIR/<dir>/<name>.jpg` (+ `.jgw` when not embedded in the index) on
  the remote tile server.

## State (module globals in `app.slim.js`)
- `indexShards` — `FX code -> Promise<shard>`, populated lazily by `getMeta()` as photos
  are shown; each resolved shard is `name -> { dir, w, h, jgw }`.
- `clickCoord` — last selected point (EPSG:3857), anchor for rotation and distance math.
- `nadir` / `activeDir` — current view mode; `activeDir` is one of `DIRECTIONS` or `'Nadir'`.
- `candidates` — `{ dir: [name, ...] }`, up to `MAX_CANDIDATES` nearest names per direction,
  computed once per direction per click.
- `photoIdx` — `{ dir: index }`, which candidate is currently shown, stepped by the
  cycle arrows.
- `sourceCache` — `name -> { small, smallRes, full, loadingFull, url, extent, blobUrl }`,
  reused across direction/candidate switches within the same click.
- `aborter` / `clickGen` — cancel and invalidate in-flight loads from a superseded click.
- `pending` — in-flight load counter backing the loading overlay.

## Key flows

### Click / point selection
`singleclick` → `selectPoint(coord)`:
1. Bump `clickGen`, abort the previous `AbortController`, start a new one.
2. Drop the marker; clear `sourceCache` (revoking each entry's blob URL), `candidates`,
   `photoIdx`, `activeDir`.
3. `show(dirFromRotation())` loads the image for whatever direction the map is currently
   facing (or Nadir).
4. `syncUrl()` mirrors the point + view into `?lat=&lon=&z=&r=`.

### Candidate resolution + cycling
- `closestNames(dir)` calls OL's `getClosestFeatureToCoordinate` up to `MAX_CANDIDATES`
  times, excluding names already picked, to build the nearest-first candidate list —
  no manual full-table distance scan.
- `loadActive()` lazily computes `candidates[activeDir]` and `photoIdx[activeDir]` (default
  0) the first time a direction is shown, then loads/reuses the source for the selected
  candidate.
- `updateCycleControl()` shows the prev/next arrows + dot indicator only when the active
  direction has 2+ candidates; `window.cyclePhoto(±1)` steps `photoIdx[activeDir]` with
  wraparound and reloads.

### Two-tier image loading
- `makeSource()` builds a downscaled (`MAX_DIM`-capped) `small` source via
  `createImageBitmap` + canvas (off-main-thread decode+resize), and records `smallRes`
  (ground meters/pixel at which `small` starts being upscaled past 1:1).
- `applySource()` (called from `moveend`) swaps to the native-resolution `full` source
  once the view resolution drops below `smallRes`, decoding it lazily via `Image.decode()`
  so the swap doesn't stall the frame.
- `change:resolution` handles the downgrade path only: zooming back out past `smallRes`
  drops `full` back to `small` immediately (no reload), so an 80MP source is never
  downsampled every frame of an outward zoom gesture.
- Loading a new source is guarded by `clickGen`/`activeDir`/`photoIdx` checks so a slow
  fetch that resolves after the user moved on is discarded, not applied.

### Rotation / direction
- Compass slice `onclick="setMapRotation(deg)"` → `view.animate({ rotation, anchor: clickCoord })`.
- `change:rotation` handler clears `nadir`, updates the `--map-rotation` CSS var (rotates
  the gradient border), and calls `show(dirFromRotation())`.
- `dirFromRotation()` maps rotation to the nearest 90° quadrant
  (`DIRECTIONS[((round % 4) + 4) % 4]`), or returns `'Nadir'` when `nadir` is set.
- `setNadir()` toggles `nadir` and re-shows.

### Deep link
On startup, once the footprint GeoJSON has loaded: if `?lat=&lon=` are present, set
center/zoom/rotation from the URL (rotation before `selectPoint`, so the right direction
loads immediately) and call `selectPoint`. Otherwise fit the view to the footprint's
extent (`maxZoom: 16`). Per-photo metadata is not awaited here — `makeSource()` fetches
each name's FX shard on demand.

## Conventions
- Direction order `['Left','Backward','Right','Forward']` is indexed by rotation quadrant;
  `'Nadir'` is a separate discrete state, not part of that array.
- Rotation/Nadir/cycle handlers are exposed as `window.setMapRotation` / `window.setNadir`
  / `window.cyclePhoto` because they're wired through inline HTML `onclick`.

## Known simplifications
- Images are drawn with their extent pre-transformed to 3857 instead of warped per frame —
  fine near the equator, close to zone 24S's central meridian (~1-2m error per footprint,
  under oblique georeferencing error already present in the source data).
- A failed image load only `console.error`s; the loading overlay still clears as if it
  had succeeded (`app.slim.js:216-218`).
- No validation that `view_th`/`name` exist on a footprint feature, or that
  `obq_index/FXnnnn.json` entries are well-formed.
- `getMeta()` derives the shard file from the name's `FX(\d+)_` prefix; a name that
  doesn't match falls back to the slow per-image probe (same as a missing/malformed entry).
