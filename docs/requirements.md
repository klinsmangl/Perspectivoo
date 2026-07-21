# Requirements — PerspectiVôo (slim JPG+JGW viewer)

## Overview
A single-page, dependency-light web app that overlays georeferenced oblique aerial
photos (plain JPG + world file, no COG/GeoTIFF) on an OpenStreetMap basemap. The user
clicks a location; the app finds the nearest captured photo for each viewing direction
and shows the one matching the current map rotation. A custom compass switches between
the four oblique directions and a top-down Nadir view; when multiple photos are near the
clicked point, arrows let the user cycle through the closest few.

## Actors
- **User** — pans/zooms the map, clicks a point, rotates via the compass, cycles through
  nearby candidate photos.

## Functional requirements

### FR-1 Map display
- Show an OSM basemap centered initially over Fortaleza (`-38.52, -3.72`, zoom 13).
- Fill the full viewport; no chrome.

### FR-2 Data load
- On startup, fetch in parallel:
  - `obq_index.json` (local) — `name -> { dir, w, h, jgw }`, or the older
    `name -> "SUBPASTA"` string form.
  - `OBQ-FOOTPRINT.geojson` (remote, EPSG:4326) — point features with
    `properties.name` (photo filename, no extension) and `properties.view_th`
    (`Left`, `Backward`, `Right`, `Forward`, or `Nadir`).
- After load, fit the view to the extent of all footprint points (max zoom 16) — unless
  a deep link (FR-7) is present.

### FR-3 Click → nearest photo per direction
- On single map click, drop a red marker at the clicked coordinate and cancel any loads
  still in flight for the previous point.
- For the active direction, find up to `MAX_CANDIDATES` (4) nearest footprint features of
  that direction (nearest first), reusing OpenLayers' spatial index.
- Load the nearest candidate as a two-tier image: a downscaled version first
  (`MAX_DIM` = 4096px cap), swapped for the native-resolution version once the view
  zooms in past what the downscaled pixels can cover.
- A photo's on-map position/extent comes from its `.jgw` world-file coefficients
  (embedded in `obq_index.json` when available, else fetched per-image) reprojected from
  EPSG:31984 to EPSG:3857.

### FR-4 Direction selection via compass
- The compass has four clickable pie slices (N/E/S/W → rotation 0/90/180/270°) and a
  central Nadir button.
- Map rotation animates to the chosen quadrant (250 ms), anchored on the active point.
- Only the layer matching the active direction is visible.
- Nadir is a discrete state, independent of rotation; any rotation change cancels it.

### FR-5 Compass readout
- A red gradient border rotates with the map to indicate heading.
- The Nadir button shows a pressed state (`aria-pressed`) when Nadir is active.

### FR-6 Candidate cycling
- When the active direction has 2+ nearby candidates, prev/next arrows and a dot
  indicator appear below the compass.
- Stepping wraps in both directions and reloads the newly selected candidate, reusing
  any already-cached source.

### FR-7 Deep link / URL sync
- `?lat=<lat>&lon=<lon>&z=<zoom>&r=<rotation in degrees>` on load selects that point as
  if it had been clicked, at the given zoom/rotation (defaults: `DEEP_LINK_ZOOM` = 20 if
  `z` is absent, current rotation if `r` is absent).
- Every click, rotation change, and map move (`moveend`) rewrites the URL's `lat/lon/z/r`
  via `history.replaceState`, so the current view can be copied/shared/reloaded.

### FR-8 Loading feedback
- Show a loading overlay while a photo is fetching; hide once the load settles (success
  or failure) and no other load is pending.

## Non-functional
- **No build step.** Plain HTML/CSS/JS served statically; libraries via CDN.
- Dependencies: OpenLayers 9.2.4, proj4js 2.11.0, Bootstrap 5.3.3 (CSS only).
- Runs in any modern browser; `createImageBitmap`/`Image.decode()` are used when
  available but loading degrades gracefully (native-resolution image only) without them.

## Out of scope / assumptions
- The app does not produce `obq_index.json`, the footprint GeoJSON, or the photos; the
  index is deployed alongside the app, the rest is served by
  `servidor-interno.exemplo.com`.
- No authentication, no persistence beyond the shareable URL, no server-side code.
