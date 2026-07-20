// JPG + JGW variant of app.js. Swap the <script src> in index.html to deploy this one.
// Images are plain JPGs georeferenced by a sibling .jgw world file in EPSG:31984;
// OpenLayers reprojects each into the map's EPSG:3857 at render time.

// Register EPSG:31984 (SIRGAS 2000 / UTM zone 24S) — projection of the GeoJSON points
// AND the .jgw world files.
proj4.defs("EPSG:31984", "+proj=utm +zone=24 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs");
ol.proj.proj4.register(proj4);

// Base URL for the georeferenced JPGs (each paired with a .jgw world file)
const IMG_DIR = 'https://servidor-interno.exemplo.com/mapear/FORTALEZA_VOO_CM_OBLIQUO';

// DOM elements
const compassContainer = document.getElementById('compass-container');
const nadirBtn = document.getElementById('nadir-btn');
const loadingOverlay = document.getElementById('loading-overlay');

// Global state
let currentImageLayers = {}; // dir -> ol.layer.Image for the current click
let currentPointCoords = null;
let isNadirActive = false;
let currentActiveDir = null;
let nameToFolder = {}; // image name -> remote subfolder, from obq_index.json

// Our own running total for the compass arrow's CSS rotation, advanced by the shortest
// signed step each time the map rotation changes — decoupled from whatever raw value
// ol/View#getRotation() returns, so the arrow never snaps around on a full turn.
let accumulatedRotationDeg = 0;
let lastRawRotationDeg = 0;

// Direction by map-rotation quadrant (0/90/180/270° from north), plus the top-down Nadir view
const DIRECTIONS = ['Left', 'Backward', 'Right', 'Forward'];
const ALL_DIRS = [...DIRECTIONS, 'Nadir'];

// Map layers
const baseLayer = new ol.layer.Tile({ source: new ol.source.OSM() });

const markerSource = new ol.source.Vector();
const markerLayer = new ol.layer.Vector({
    source: markerSource,
    style: new ol.style.Style({
        image: new ol.style.Circle({
            radius: 6,
            fill: new ol.style.Fill({ color: 'red' }),
            stroke: new ol.style.Stroke({ color: 'white', width: 2 })
        })
    }),
    zIndex: 100
});

// Holds the imagery points, reprojected to map projection at load time.
// Not added as a map layer — it exists purely as a spatial index for nearest-point queries.
const dataSource = new ol.source.Vector();

// Initial view roughly over Fortaleza
const view = new ol.View({
    center: ol.proj.fromLonLat([-38.52, -3.72]),
    zoom: 13
});

const map = new ol.Map({
    target: 'map',
    layers: [baseLayer, markerLayer],
    view: view
});

// Set rotation from HTML buttons.
// ol/View#animate already takes the shortest path for `rotation` internally
// (it normalizes the delta to [-180, 180] before animating), so the raw target is fine here.
window.setMapRotation = function (deg) {
    isNadirActive = false;
    const animateOpts = { rotation: deg * Math.PI / 180, duration: 250 };
    if (currentPointCoords) animateOpts.anchor = currentPointCoords;
    view.animate(animateOpts);
};

// Toggle Nadir view from HTML button — second click while active reverts to the
// direction implied by the current map rotation (getActiveDirection() falls back to
// that automatically once isNadirActive is false again).
window.setNadir = function () {
    isNadirActive = !isNadirActive;
    refreshDirection();
};

// Sync the Nadir button's pressed state and visible layer with the current rotation/Nadir state.
// Direction itself is shown by the red arrow (--map-rotation), not by text.
function refreshDirection() {
    nadirBtn.classList.toggle('active', isNadirActive);
    nadirBtn.setAttribute('aria-pressed', String(isNadirActive));
    updateLayerVisibility();
}

// Load GeoJSON once into the data source, then frame it.
fetch('https://servidor-interno.exemplo.com/mapear/OBQ-GEOMETRIA/OBQ-FOOTPRINT.geojson')
    .then(res => res.json())
    .then(data => {
        // dataProjection: the file is EPSG:4326 (lat/long). featureProjection: store it in map projection.
        // OL reprojects once here, so every later query works directly in EPSG:3857.
        dataSource.addFeatures(new ol.format.GeoJSON().readFeatures(data, {
            dataProjection: 'EPSG:4326',
            featureProjection: 'EPSG:3857'
        }));
        console.log(`Loaded ${dataSource.getFeatures().length} features`);

        const extent = dataSource.getExtent();
        if (!ol.extent.isEmpty(extent)) {
            view.fit(extent, { padding: [50, 50, 50, 50], maxZoom: 16 });
        }
    })
    .catch(err => console.error('Error loading geojson', err));

// Load the image name -> subfolder map, so image/world-file URLs can be built per entrega.
fetch('obq_index.json')
    .then(res => res.json())
    .then(data => { nameToFolder = data; })
    .catch(err => console.error('Error loading obq_index', err));

// Map the current rotation to the nearest 90° quadrant direction
function getActiveDirection() {
    if (isNadirActive) return 'Nadir';
    const quadrant = Math.round(map.getView().getRotation() / (Math.PI / 2));
    return DIRECTIONS[((quadrant % 4) + 4) % 4];
}

// On map click
map.on('singleclick', function (evt) {
    currentPointCoords = evt.coordinate;
    processClick();
});

// Update compass and direction on map rotation
map.getView().on('change:rotation', () => {
    isNadirActive = false;
    const rawDeg = map.getView().getRotation() * 180 / Math.PI;
    // Step by the shortest signed delta from the last reading, so the arrow's CSS
    // rotation only ever accumulates smoothly and never snaps around on a full turn.
    const step = ((rawDeg - lastRawRotationDeg + 180) % 360 + 360) % 360 - 180;
    accumulatedRotationDeg += step;
    lastRawRotationDeg = rawDeg;

    compassContainer.style.setProperty('--map-rotation', `${accumulatedRotationDeg}deg`);
    refreshDirection();
});

function fadeLayer(layer, targetOpacity, duration) {
    if (layer.animationId) {
        cancelAnimationFrame(layer.animationId);
        layer.animationId = null;
    }

    const startOpacity = layer.getOpacity();
    if (startOpacity === targetOpacity) return;

    const startTime = performance.now();
    function animate(time) {
        const progress = Math.min((time - startTime) / duration, 1);
        layer.setOpacity(startOpacity + (targetOpacity - startOpacity) * progress);
        layer.animationId = progress < 1 ? requestAnimationFrame(animate) : null;
    }
    layer.animationId = requestAnimationFrame(animate);
}

function updateLayerVisibility() {
    if (!currentPointCoords) return;
    const activeDir = getActiveDirection();
    if (currentActiveDir === activeDir) return;
    currentActiveDir = activeDir;

    for (const dir in currentImageLayers) {
        fadeLayer(currentImageLayers[dir], dir === activeDir ? 1 : 0, 300);
    }
}

function processClick() {
    if (!currentPointCoords || dataSource.getFeatures().length === 0) return;

    // Set marker
    markerSource.clear();
    markerSource.addFeature(new ol.Feature(new ol.geom.Point(currentPointCoords)));

    // Drop the previous click's layers
    Object.values(currentImageLayers).forEach(layer => map.removeLayer(layer));
    currentImageLayers = {};

    const activeDir = getActiveDirection();
    currentActiveDir = activeDir;

    // Nearest feature per direction, straight from the source's spatial index.
    // The click coordinate and the features share EPSG:3857, so no per-click reprojection.
    const tasks = ALL_DIRS.flatMap(dir => {
        const f = dataSource.getClosestFeatureToCoordinate(
            currentPointCoords, c => c.get('view_th') === dir
        );
        return f ? [loadImageLayer(f.get('name'), dir, dir === activeDir)] : [];
    });

    if (tasks.length) {
        loadingOverlay.classList.remove('d-none');
        Promise.allSettled(tasks).finally(() => loadingOverlay.classList.add('d-none'));
    }
}

// Load an image and resolve once its pixel dimensions are known.
function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}

// Parse a .jgw world file (6 lines) + the image's pixel size into an EPSG:31984 extent.
// World file lines: a (x scale), d, b (rotation terms — ignored, ImageStatic is axis-aligned),
// e (y scale, negative), c/f (map coords of the upper-left pixel CENTER).
// ponytail: rotation terms dropped; add an affine warp only if a .jgw ever carries one.
async function jgwExtent(name) {
    const base = nameToFolder[name] ? `${IMG_DIR}/${nameToFolder[name]}` : IMG_DIR;
    const [text, img] = await Promise.all([
        fetch(`${base}/${name}.jgw`).then(r => r.text()),
        loadImage(`${base}/${name}.jpg`)
    ]);

    const [a, , , e, c, f] = text.trim().split(/\s+/).map(Number);
    const left = c - a / 2;                       // pixel center → pixel edge
    const top = f - e / 2;
    const right = left + a * img.naturalWidth;
    const bottom = top + e * img.naturalHeight;   // e is negative → bottom < top

    return { extent: [left, bottom, right, top], src: img.src };
}

function loadImageLayer(name, dir, isActive) {
    const layer = new ol.layer.Image({
        opacity: isActive ? 1 : 0,
        zIndex: 10 // Above base map, below marker
    });

    currentImageLayers[dir] = layer;
    map.addLayer(layer);

    // Once the world file + image size are known, build the reprojected static source.
    return jgwExtent(name).then(({ extent, src }) => {
        layer.setSource(new ol.source.ImageStatic({
            url: src,
            imageExtent: extent,
            projection: 'EPSG:31984', // OL reprojects to the map's EPSG:3857 on render
            interpolate: true
        }));
    }).catch(err => {
        console.error('Error loading image for ' + name, err);
    });
}
