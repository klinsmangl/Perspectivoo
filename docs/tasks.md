# Tasks — OpenLayers Oblique Image Viewer

Implementation checklist mapping requirements → design. All current items are done;
the backlog tracks gaps a future iteration would close.

## Done
- [x] Register EPSG:31984, init OSM map + view over Fortaleza — `FR-1`
- [x] Load `pontos31984.geojson`, fit view to extent — `FR-2`
- [x] Click handler: marker + nearest feature per direction — `FR-3`
- [x] Load COGs as WebGLTile layers from `/obl/obl_cog/` — `FR-3`
- [x] Compass slices + Nadir button, animated rotation — `FR-4`
- [x] Cross-fade between direction layers — `FR-4`
- [x] Degree readout + rotating gradient border — `FR-5`
- [x] Loading overlay tied to COG resolution — `FR-6`

## Backlog
- [ ] **Surface load errors to the user.** Failed COGs only `console.error`; the
      overlay hides as if successful (`app.js:222`).
- [ ] **Guard the data contract.** No validation that `view_th`/`name` exist or that
      the GeoJSON CRS is actually 31984.
- [ ] **One smoke check.** No test exists. Minimum: assert
      `getActiveDirection()` quadrant math (e.g. rotation 3π/2 → `Forward`,
      negative rotations wrap correctly).
- [ ] **Configurable paths.** `COG_DIR` and the GeoJSON filename are hardcoded.
