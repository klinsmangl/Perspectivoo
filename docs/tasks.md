# Tasks — PerspectiVôo (slim JPG+JGW viewer)

Implementation checklist mapping requirements → design. All current items are done;
the backlog tracks gaps a future iteration would close.

## Done
- [x] Register EPSG:31984, init OSM map + view over Fortaleza — `FR-1`
- [x] Load `obq_index.json` + remote `OBQ-FOOTPRINT.geojson` in parallel, fit view to
      extent — `FR-2`
- [x] Click handler: marker + nearest candidates per direction via spatial index — `FR-3`
- [x] Two-tier image loading (downscaled first, full-res swap on zoom-in) from JPG+JGW,
      no COG/GeoTIFF dependency — `FR-3`
- [x] Compass slices + Nadir button, animated rotation — `FR-4`
- [x] Rotating gradient border + Nadir pressed state — `FR-5`
- [x] Candidate cycling: prev/next arrows + dot indicator for 2+ nearby photos — `FR-6`
- [x] Deep link (`?lat=&lon=&z=&r=`) + continuous URL sync on click/rotate/move — `FR-7`
- [x] Loading overlay tied to in-flight request count — `FR-8`
- [x] Abort in-flight loads and invalidate stale resolutions on a new click
      (`clickGen`/`AbortController`) so a superseded fetch can't clobber the current view
- [x] Source cache with blob-URL cleanup (`discardEntry`) on point change, avoiding
      unbounded memory growth across clicks

## Backlog
- [ ] **Surface load errors to the user.** Failed loads only `console.error`/`console.warn`;
      the overlay clears as if successful (`app.slim.js:216-218`).
- [ ] **Guard the data contract.** No validation that `view_th`/`name` exist on footprint
      features, or that `obq_index.json` entries have well-formed `jgw`.
- [ ] **One smoke check.** No test exists. Minimum: assert `dirFromRotation()`'s quadrant
      math (e.g. rotation `3π/2` → `Forward`, negative rotations wrap correctly) and
      `closestNames()` respects `MAX_CANDIDATES` + exclusion.
- [ ] **Configurable paths.** `IMG_DIR` and the index/footprint URLs are hardcoded in
      `app.slim.js`.
