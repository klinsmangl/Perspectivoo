// Slim JPG+JGW variant. One image layer, lazy per-direction loading, two-tier zoom.
// Best served by an enriched obq_index.json:
//   { "IMG_NAME": { "dir": "SUBPASTA", "w": 10328, "h": 7760, "jgw": [a, e, c, f] }, ... }
// (a = x scale, e = y scale (negative), c/f = map coords of upper-left pixel CENTER)
// Falls back to fetching NAME.jgw + probing the JPG if "jgw" is missing.

proj4.defs('EPSG:31984', '+proj=utm +zone=24 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
ol.proj.proj4.register(proj4);

const IMG_DIR = 'https://servidor-interno.exemplo.com/mapear/FORTALEZA_VOO_CM_OBLIQUO';
const DIRECTIONS = ['Left', 'Backward', 'Right', 'Forward'];
const MAX_DIM = 4096;      // downscale cap: ~16x less RAM/bandwidth-per-frame than 10k x 8k
const DEEP_LINK_ZOOM = 20; // zoom applied when arriving via ?lat=&lon=
const MAX_CANDIDATES = 4;  // closest photos per direction offered to cycle through

const compass = document.getElementById('compass-container');
const nadirBtn = document.getElementById('nadir-btn');
const overlay = document.getElementById('loading-overlay');
const cycleControl = document.getElementById('cycle-control');
const cycleDots = document.getElementById('cycle-dots');

let index = {};          // name -> { dir, w, h, jgw } (or just a folder string, old format)
let clickCoord = null;
let nadir = false;
let activeDir = null;
let candidates = {};     // dir -> up to MAX_CANDIDATES feature names, closest first
let photoIdx = {};       // dir -> index into candidates[dir] currently shown
let sourceCache = {};    // name -> { small, smallRes, full, loadingFull, url, extent, blobUrl }
let aborter = null;      // cancels fetches still in flight when a new point is selected
let clickGen = 0;        // bumped per click; invalidates loads that outrun the abort
let pending = 0;

const imgLayer = new ol.layer.Image({ zIndex: 10 });
const markerSource = new ol.source.Vector();
const dataSource = new ol.source.Vector(); // spatial index only, never added to the map

const view = new ol.View({ center: ol.proj.fromLonLat([-38.52, -3.72]), zoom: 13 });
const map = new ol.Map({
    target: 'map',
    pixelRatio: 1, // render at CSS resolution — huge win on hi-DPI mobile
    layers: [
        new ol.layer.Tile({ source: new ol.source.OSM({ transition: 0 }) }),
        imgLayer,
        new ol.layer.Vector({
            source: markerSource,
            zIndex: 100,
            style: new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 6,
                    fill: new ol.style.Fill({ color: 'red' }),
                    stroke: new ol.style.Stroke({ color: 'white', width: 2 })
                })
            })
        })
    ],
    view
});

const dirFromRotation = () => nadir ? 'Nadir'
    : DIRECTIONS[((Math.round(view.getRotation() / (Math.PI / 2)) % 4) + 4) % 4];

const setBusy = d => { pending += d; overlay.classList.toggle('d-none', pending <= 0); };

const fetchOk = (url, signal) => fetch(url, { signal }).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return r;
});

// Each entry owns its downscaled blob URL; revoke it the moment the entry is dropped.
const discardEntry = entry => { if (entry.blobUrl) URL.revokeObjectURL(entry.blobUrl); };

// All image sources share the map projection: extent pre-transformed to 3857, so OL
// just drawImage()s the raster (like a plain <img>) instead of warping it per frame.
// Fine here — near the equator and close to zone 24S's central meridian, the error
// across one photo footprint is ~1-2m, under oblique georeferencing error.
const makeStatic = (url, extent) => new ol.source.ImageStatic({
    url,
    imageExtent: extent,
    projection: 'EPSG:3857',
    interpolate: true
});

// Build a two-tier source entry for one image, ideally from index metadata alone
// (1 request: the JPG). `small` is cheap to draw at any zoom; `full` is decoded lazily,
// only once the view zooms past what `small`'s pixels can cover — see applySource().
async function makeSource(name, signal) {
    let meta = index[name];
    if (typeof meta === 'string') meta = { dir: meta }; // old index format
    const base = meta?.dir ? `${IMG_DIR}/${meta.dir}` : IMG_DIR;
    const url = `${base}/${name}.jpg`;
    let { w, h, jgw } = meta || {};

    if (!jgw) { // fallback: world file + image probe (browser cache dedupes the JPG)
        const [text, img] = await Promise.all([
            fetchOk(`${base}/${name}.jgw`, signal).then(r => r.text()),
            new Promise((res, rej) => {
                const i = new Image();
                i.onload = () => res(i);
                i.onerror = () => rej(new Error(`Failed to load ${url}`));
                i.src = url;
            })
        ]);
        const n = text.trim().split(/\s+/).map(Number);
        jgw = [n[0], n[3], n[4], n[5]];
        w = img.naturalWidth;
        h = img.naturalHeight;
    }

    const [a, e, c, f] = jgw;
    const left = c - a / 2, top = f - e / 2; // pixel center -> pixel edge
    const utmExtent = [left, top + e * h, left + a * w, top]; // e < 0 -> bottom < top
    const extent3857 = ol.proj.transformExtent(utmExtent, 'EPSG:31984', 'EPSG:3857');

    // Downscale before handing pixels to OL: an 80-megapixel source costs the same
    // drawImage() every render frame regardless of on-screen size — that's the lag
    // zoomed out. createImageBitmap does decode+resize off the main thread, which also
    // kills the ~1s decode freeze on first paint. Extent math is unaffected —
    // ImageStatic stretches whatever pixels it gets into the given extent.
    let src = url;
    let blobUrl = null;
    let smallW = w; // ACTUAL pixel width of `small` (may stay native, see below)
    const scale = Math.min(1, MAX_DIM / Math.max(w, h));
    if (scale < 1 && window.createImageBitmap) {
        try {
            const blob = await fetchOk(url, signal).then(r => r.blob());
            const bmp = await createImageBitmap(blob, {
                resizeWidth: Math.round(w * scale),
                resizeHeight: Math.round(h * scale),
                resizeQuality: 'medium' // ignored by Safari, harmless
            });
            const cnv = document.createElement('canvas');
            cnv.width = bmp.width; cnv.height = bmp.height;
            cnv.getContext('2d').drawImage(bmp, 0, 0);
            bmp.close();
            const small = await new Promise(res => cnv.toBlob(res, 'image/jpeg', 0.8));
            blobUrl = URL.createObjectURL(small);
            src = blobUrl;
            smallW = cnv.width;
        } catch (err) {
            if (err.name === 'AbortError') throw err;
            console.warn(`Downscale failed for ${name}, using native image`, err);
            // src stays the native URL; smallW stays w, so smallRes = 0 below
        }
    }

    // Ground meters per pixel of `small`. Once the view resolution drops below this,
    // `small` is being stretched past 1:1 — time for `full`. When `small` already IS
    // native resolution (tiny image, no createImageBitmap, or downscale failure),
    // 0 disables the swap.
    const smallRes = smallW < w ? ol.extent.getWidth(extent3857) / smallW : 0;
    return {
        small: makeStatic(src, extent3857),
        smallRes, full: null, loadingFull: false, url, extent: extent3857, blobUrl
    };
}

// The closest MAX_CANDIDATES feature names for a direction, nearest first. Repeated
// nearest-neighbor lookups (excluding names already found) reuse OL's rbush-backed
// getClosestFeatureToCoordinate instead of a manual distance scan over all features.
function closestNames(dir) {
    const names = [];
    const exclude = new Set();
    for (let i = 0; i < MAX_CANDIDATES; i++) {
        const f = dataSource.getClosestFeatureToCoordinate(clickCoord,
            c => c.get('view_th') === dir && !exclude.has(c.get('name')));
        if (!f) break;
        names.push(f.get('name'));
        exclude.add(f.get('name'));
    }
    return names;
}

// Arrows + dot indicator: visible only when the current direction has 2+ candidates.
function updateCycleControl() {
    const names = candidates[activeDir] || [];
    cycleControl.classList.toggle('d-none', names.length < 2);
    if (names.length < 2) return;
    const cur = photoIdx[activeDir] || 0;
    cycleDots.replaceChildren(...names.map((_, i) => {
        const dot = document.createElement('span');
        dot.className = 'cycle-dot' + (i === cur ? ' active' : '');
        return dot;
    }));
}

// Show one direction: reuse the cached source or lazily load the nearest image for it.
function show(dir) {
    nadirBtn.classList.toggle('active', nadir);
    nadirBtn.setAttribute('aria-pressed', String(nadir));
    if (dir === activeDir) return;
    activeDir = dir;
    loadActive();
}

// (Re)loads whichever photo is currently selected for activeDir: the candidate list is
// computed once per direction per click, and photoIdx (stepped by the arrows) picks
// which of those candidates is shown.
function loadActive() {
    if (!clickCoord) return imgLayer.setSource(null);
    if (!candidates[activeDir]) candidates[activeDir] = closestNames(activeDir);
    if (photoIdx[activeDir] === undefined) photoIdx[activeDir] = 0;
    updateCycleControl();

    const name = candidates[activeDir][photoIdx[activeDir]];
    if (!name) return imgLayer.setSource(null);
    if (sourceCache[name]) return applySource(sourceCache[name]);

    const dir = activeDir, idx = photoIdx[activeDir], gen = clickGen;
    setBusy(1);
    makeSource(name, aborter.signal)
        .then(entry => {
            if (gen !== clickGen) return discardEntry(entry); // superseded by a newer click
            sourceCache[name] = entry;
            if (activeDir === dir && photoIdx[dir] === idx) applySource(entry); // user may have moved on
        })
        .catch(err => {
            if (err.name !== 'AbortError') console.error('Error loading image ' + name, err);
        })
        .finally(() => setBusy(-1));
}

// Arrows: step forward (+1) or backward (-1) through the current direction's
// candidates, wrapping in both directions.
window.cyclePhoto = step => {
    const names = candidates[activeDir];
    if (!names || names.length < 2) return;
    photoIdx[activeDir] = (photoIdx[activeDir] + step + names.length) % names.length;
    loadActive();
};

// The source entry backing whatever is currently on screen (or undefined while loading).
const currentEntry = () => sourceCache[(candidates[activeDir] || [])[photoIdx[activeDir]]];

// Pick `small` or `full` for the current zoom. The upgrade to `full` only happens here,
// called from `moveend` (not mid-gesture), so pinch/scroll always animates the light
// image and the sharp one pops in once the user stops.
function applySource(entry) {
    if (view.getResolution() >= entry.smallRes) {
        if (imgLayer.getSource() !== entry.small) imgLayer.setSource(entry.small);
        return;
    }
    if (entry.full) {
        if (imgLayer.getSource() !== entry.full) imgLayer.setSource(entry.full);
        return;
    }
    if (imgLayer.getSource() !== entry.small) imgLayer.setSource(entry.small); // meanwhile
    if (entry.loadingFull) return; // decode already underway
    entry.loadingFull = true;
    const i = new Image();
    i.src = entry.url;
    // decode() warms the full-res JPEG decode off the main thread; the browser then
    // reuses that decoded, cached image when ImageStatic requests the same URL.
    (i.decode ? i.decode() : Promise.resolve()).catch(() => { }).then(() => {
        entry.full = makeStatic(entry.url, entry.extent);
        if (currentEntry() === entry && view.getResolution() < entry.smallRes)
            imgLayer.setSource(entry.full);
    });
}

map.on('moveend', () => {
    const e = currentEntry();
    if (e) applySource(e);
    syncUrl();
});

// Downgrade-only, safe mid-gesture: the moment a zoom-OUT crosses back over smallRes,
// drop `full` so the 80MP source isn't downsampled on every remaining frame of the
// gesture. Never loads anything, so unlike applySource it can run per resolution change.
view.on('change:resolution', () => {
    const e = currentEntry();
    if (e && e.full && imgLayer.getSource() === e.full && view.getResolution() >= e.smallRes)
        imgLayer.setSource(e.small);
});

// Mirror the current point + view into the URL, so a reload/share restores it.
function syncUrl() {
    if (!clickCoord) return;
    const [lon, lat] = ol.proj.toLonLat(clickCoord);
    const p = new URLSearchParams(location.search);
    p.set('lat', lat.toFixed(6)); // ~11cm precision
    p.set('lon', lon.toFixed(6));
    p.set('z', view.getZoom().toFixed(1));
    p.set('r', Math.round(view.getRotation() * 180 / Math.PI));
    history.replaceState(null, '', `${location.pathname}?${p}`);
}

// Select a point as if it had been clicked: drop the marker, cancel and invalidate the
// per-click image cache, and load the current direction. Used by both real clicks and
// the ?lat=&lon= URL params below.
function selectPoint(coord) {
    clickCoord = coord;
    clickGen++;               // orphan any load that resolves despite the abort
    aborter?.abort();         // actually cancel in-flight downloads
    aborter = new AbortController();
    markerSource.clear();
    markerSource.addFeature(new ol.Feature(new ol.geom.Point(coord)));
    imgLayer.setSource(null); // detach before revoking, so no source references the URLs
    Object.values(sourceCache).forEach(discardEntry);
    sourceCache = {};
    candidates = {};
    photoIdx = {};
    activeDir = null;
    show(dirFromRotation());
    syncUrl();
}

map.on('singleclick', evt => selectPoint(evt.coordinate));

// NOTE: keep the compass arrow free of CSS `transition` — the raw angle is set directly.
view.on('change:rotation', () => {
    nadir = false;
    compass.style.setProperty('--map-rotation', (view.getRotation() * 180 / Math.PI) + 'deg');
    show(dirFromRotation());
});

window.setMapRotation = deg => {
    nadir = false;
    view.animate({
        rotation: deg * Math.PI / 180,
        duration: 250,
        ...(clickCoord && { anchor: clickCoord })
    });
};

window.setNadir = () => {
    nadir = !nadir;
    show(dirFromRotation());
};

// Both must be loaded before a ?lat=&lon= auto-select runs — selectPoint() -> show()
// -> makeSource() reads `index` synchronously, and if it's still {} at that point
// (index fetch slower than geojson) it silently falls back to the slow per-image probe.
Promise.all([
    fetchOk('https://servidor-interno.exemplo.com/mapear/OBQ-GEOMETRIA/OBQ-FOOTPRINT.geojson')
        .then(r => r.json())
        .catch(err => { console.error('Error loading geojson', err); return null; }),
    fetchOk('obq_index.json')
        .then(r => r.json())
        .catch(err => { console.error('Error loading obq_index', err); return {}; })
]).then(([geojson, idx]) => {
    index = idx;
    if (!geojson) return;

    dataSource.addFeatures(new ol.format.GeoJSON().readFeatures(geojson, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857'
    }));

    // ?lat=&lon= in the URL: jump straight to that point, as if clicked.
    const params = new URLSearchParams(location.search);
    const lat = parseFloat(params.get('lat'));
    const lon = parseFloat(params.get('lon'));
    if (!isNaN(lat) && !isNaN(lon)) {
        const coord = ol.proj.fromLonLat([lon, lat]);
        const z = parseFloat(params.get('z'));
        const r = parseFloat(params.get('r'));
        view.setCenter(coord);
        view.setZoom(isNaN(z) ? DEEP_LINK_ZOOM : z);
        if (!isNaN(r)) view.setRotation(r * Math.PI / 180); // before selectPoint, so the right direction loads
        selectPoint(coord);
    } else {
        const extent = dataSource.getExtent();
        if (!ol.extent.isEmpty(extent)) view.fit(extent, { padding: [50, 50, 50, 50], maxZoom: 16 });
    }
});