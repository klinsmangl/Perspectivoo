# Requirements — OpenLayers Oblique Image Viewer

## Overview
A single-page, dependency-light web app that overlays georeferenced aerial/oblique
imagery (Cloud Optimized GeoTIFFs) on an OpenStreetMap basemap. The user clicks a
location; the app finds the nearest captured image for each viewing direction and
shows the one matching the current map rotation. A custom compass switches between
the four oblique directions and a top-down Nadir view.

## Actors
- **User** — pans/zooms the map, clicks a point, rotates via the compass.

## Functional requirements

### FR-1 Map display
- Show an OSM basemap centered initially over Fortaleza (`-38.52, -3.72`, zoom 13).
- Fill the full viewport; no chrome.

### FR-2 Point data load
- On startup, fetch `pontos31984.geojson` (point features in **EPSG:31984**,
  SIRGAS 2000 / UTM 24S).
- Each feature carries `properties.name` (COG filename, no extension) and
  `properties.view_th` (direction: `Left`, `Backward`, `Right`, `Forward`, or `Nadir`).
- After load, fit the view to the extent of all points (max zoom 16).

### FR-3 Click → nearest image per direction
- On single map click, drop a red marker at the clicked coordinate.
- Transform the click to EPSG:31984 and, for each of the 5 directions, find the
  nearest feature of that direction (squared Euclidean distance).
- Load each direction's COG from `/obl/obl_cog/<name>.tif` as a WebGL tile layer.
- COGs are self-georeferenced in **EPSG:3857** — no world file or reprojection.

### FR-4 Direction selection via compass
- The compass has four clickable pie slices (N/E/S/W → rotation 0/90/180/270°)
  and a central Nadir button.
- Map rotation animates to the chosen quadrant (250 ms), anchored on the active point.
- Only the layer matching the active direction is visible; switching cross-fades
  layers over 300 ms.
- Nadir is a discrete state, independent of rotation; any rotation change cancels it.

### FR-5 Compass readout
- Center shows current rotation in degrees and the active direction label.
- A red gradient border rotates with the map to indicate heading.

### FR-6 Loading feedback
- Show a loading overlay while COGs for a clicked point are fetching; hide when all
  layers have resolved (success or failure).

## Non-functional
- **No build step.** Plain HTML/CSS/JS served statically; libraries via CDN.
- Dependencies: OpenLayers 9.2.4, proj4js 2.11.0, geotiff.js 2.1.3, Bootstrap 5.3.3.
- Runs in any modern browser with WebGL.

## Out of scope / assumptions
- The app does not produce the GeoJSON or COGs; they are deployed alongside it at
  `pontos31984.geojson` and `/obl/obl_cog/`.
- No authentication, no persistence, no server-side code.
