/* SpaceCraft Interactive Map - Application Engine */

function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) { }
}

function safeRemoveItem(key) {
  try {
    localStorage.removeItem(key);
  } catch (e) { }
}


// --- 1. CONFIGURATION & STATE ---
let SUPABASE_URL = "https://gkdobhkefyhhgwokncib.supabase.co";
let SUPABASE_KEY = "sb_publishable_gVzF3Pt1I0CLSnrqB99Ebg_INqarOC-";
let supabaseClient = null;
let isDbConnected = false;

// Application Datasets
let sectors = [];
let systems = [];
let planets = []; // Format: [ { id, name, systemId, designation, resources: [], deposits: [] } ]
let stations = []; // Format: [ { id, name, systemId, owner, facilities: [] } ]
let connections = []; // Format: [ { from_system_id, to_system_id, cost }, ... ]
let bounds = { minX: 0, minY: 0, maxX: 2000, maxY: 2000 };

// UI Navigation / Map State
let scale = 1.0;
let translateX = 0;
let translateY = 0;
let isPanning = false;
let startX = 0;
let startY = 0;

let isPlaceMode = false;
let isSectorPinMode = false;
let tempSectorPoints = [];
let isAdmin = false;
let selectedSystemId = null;
let selectedPlanetId = null;
let selectedStationId = null;

// Routing State
let routeStartSystemId = null;
let routeEndSystemId = null;

// Web Worker for .sst files
let sstWorker = null;

// --- 2. INITIALIZATION ---
document.addEventListener("DOMContentLoaded", () => {
  initDb();
  initTabs();
  initMapEvents();
  initForms();
  initSettings();
  initSstDropzone();

  // Load initial data
  loadData();
});

// Toast notifications
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${message}</span>
    <button class="toast-close">✕</button>
  `;
  container.appendChild(toast);

  // Trigger animation
  setTimeout(() => toast.classList.add("show"), 10);

  const closeToast = () => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  };

  toast.querySelector(".toast-close").addEventListener("click", closeToast);
  setTimeout(closeToast, 4000);
}

// --- 3. DATABASE CLIENT INTEGRATION ---
function initDb() {
  // Check local cache for Supabase credentials
  const cachedUrl = safeGetItem("spacecraft_supabase_url");
  const cachedKey = safeGetItem("spacecraft_supabase_key");

  const urlInput = document.getElementById("db-url-input");
  const keyInput = document.getElementById("db-key-input");

  if (cachedUrl && cachedKey) {
    SUPABASE_URL = cachedUrl;
    SUPABASE_KEY = cachedKey;
    urlInput.value = cachedUrl;
    keyInput.value = cachedKey;
  }

  connectToSupabase();
}

function connectToSupabase() {
  const statusBadge = document.getElementById("connection-status");

  if (SUPABASE_URL && SUPABASE_KEY && typeof window.supabase !== "undefined") {
    try {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      isDbConnected = true;
      statusBadge.textContent = "Supabase Connected";
      statusBadge.className = "badge badge-emerald";
      showToast("Connected to Supabase Cloud Database", "success");
    } catch (e) {
      console.error("Supabase config failed", e);
      isDbConnected = false;
      statusBadge.textContent = "Connection Error";
      statusBadge.className = "badge badge-red";
      showToast("Supabase connection configuration failed.", "error");
    }
  } else {
    isDbConnected = false;
    supabaseClient = null;
    statusBadge.textContent = "Offline Sandbox Mode";
    statusBadge.className = "badge badge-blue";
  }
}

// Global CRUD abstraction layer
async function loadData() {
  if (isDbConnected) {
    try {
      // 1. Load Sectors
      const { data: sectorData, error: sErr } = await supabaseClient.from("sectors").select("*");
      if (sErr) throw sErr;
      sectors = sectorData.map(s => ({
        id: s.id,
        name: s.name,
        index: s.index,
        level: s.level,
        color: s.color,
        polygon: typeof s.polygon === 'string' ? JSON.parse(s.polygon) : s.polygon,
        centroid: typeof s.centroid === 'string' ? JSON.parse(s.centroid) : s.centroid
      }));

      // 2. Load Systems
      const { data: systemData, error: sysErr } = await supabaseClient.from("systems").select("*");
      if (sysErr) throw sysErr;
      systems = systemData.map(sys => ({
        id: sys.id,
        name: sys.name,
        gameId: sys.game_id,
        designation: sys.designation,
        starType: sys.star_type,
        starColor: sys.star_color,
        index: sys.index,
        sectorId: sys.sector_id,
        color: sys.color,
        x: sys.x,
        y: sys.y
      }));

      // 2b. Load Planets
      const { data: planetData, error: pErr } = await supabaseClient.from("planets").select("*");
      if (pErr) throw pErr;
      planets = planetData.map(p => ({
        id: p.id,
        name: p.name,
        systemId: p.system_id,
        designation: p.designation,
        resources: p.resources || [],
        deposits: p.deposits || []
      }));

      // 2c. Load Stations
      const { data: stationData, error: stErr } = await supabaseClient.from("stations").select("*");
      if (stErr) throw stErr;
      stations = stationData.map(st => ({
        id: st.id,
        name: st.name,
        systemId: st.system_id,
        owner: st.owner || 'Independent',
        facilities: typeof st.facilities === 'string' ? JSON.parse(st.facilities) : (st.facilities || [])
      }));

      // 3. Load Connections
      const { data: connData, error: cErr } = await supabaseClient.from("connections").select("*");
      if (cErr) throw cErr;
      connections = connData.map(c => ({
        from_system_id: c.from_system_id,
        to_system_id: c.to_system_id,
        cost: c.cost
      }));

      calculateBounds();
      renderMap();
      populateDropdowns();
      runSearch();
    } catch (e) {
      console.error("Error fetching from Supabase", e);
      showToast("Cloud DB fetch failed. Falling back to local storage.", "warning");
      loadDataFromLocalStorage();
    }
  } else {
    loadDataFromLocalStorage();
  }
}

function loadDataFromLocalStorage() {
  const localSectors = safeGetItem("spacecraft_sectors");
  const localSystems = safeGetItem("spacecraft_systems");
  const localConns = safeGetItem("spacecraft_connections");
  const localPlanets = safeGetItem("spacecraft_planets");
  const localStations = safeGetItem("spacecraft_stations");

  if (localSectors && localSystems && localConns) {
    sectors = JSON.parse(localSectors);
    systems = JSON.parse(localSystems);
    connections = JSON.parse(localConns);
    planets = localPlanets ? JSON.parse(localPlanets) : [];
    stations = localStations ? JSON.parse(localStations) : [];
    calculateBounds();
  }

  renderMap();
  populateDropdowns();
  runSearch();
}

function saveLocalBackup() {
  if (!isDbConnected) {
    safeSetItem("spacecraft_sectors", JSON.stringify(sectors));
    safeSetItem("spacecraft_systems", JSON.stringify(systems));
    safeSetItem("spacecraft_connections", JSON.stringify(connections));
    safeSetItem("spacecraft_planets", JSON.stringify(planets));
    safeSetItem("spacecraft_stations", JSON.stringify(stations));
  }
}

function calculateBounds() {
  if (systems.length === 0) {
    bounds = { minX: 0, minY: 0, maxX: 2000, maxY: 2000 };
    return;
  }

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  systems.forEach(s => {
    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.y > maxY) maxY = s.y;
  });

  // Add visual padding
  bounds = {
    minX: minX - 400,
    minY: minY - 400,
    maxX: maxX + 400,
    maxY: maxY + 400
  };
}

// DB Write methods
async function dbSaveSector(sector) {
  const index = sectors.findIndex(s => s.id === sector.id);
  if (index !== -1) {
    sectors[index] = sector;
  } else {
    sectors.push(sector);
  }

  saveLocalBackup();

  if (isDbConnected) {
    const { error } = await supabaseClient.from("sectors").upsert({
      id: sector.id,
      name: sector.name,
      index: sector.index,
      level: sector.level,
      color: sector.color,
      polygon: JSON.stringify(sector.polygon),
      centroid: JSON.stringify(sector.centroid)
    });
    if (error) {
      console.error(error);
      showToast("Error updating sector in Supabase", "error");
    } else {
      showToast(`Sector '${sector.name}' synced successfully`, "success");
    }
  } else {
    showToast(`Sector '${sector.name}' saved locally`, "success");
  }
}

async function dbSaveSystem(sys) {
  const index = systems.findIndex(s => s.id === sys.id);
  if (index !== -1) {
    systems[index] = sys;
  } else {
    systems.push(sys);
  }

  calculateBounds();
  saveLocalBackup();

  if (isDbConnected) {
    const { error } = await supabaseClient.from("systems").upsert({
      id: sys.id,
      name: sys.name,
      game_id: sys.gameId,
      designation: sys.designation,
      star_type: sys.starType,
      star_color: sys.starColor,
      index: sys.index,
      sector_id: sys.sectorId,
      color: sys.color,
      x: sys.x,
      y: sys.y
    });
    if (error) {
      console.error(error);
      showToast("Error syncing system in Supabase", "error");
    } else {
      showToast(`System '${sys.name}' synced successfully`, "success");
    }
  } else {
    showToast(`System '${sys.name}' saved locally`, "success");
  }
}

async function dbSavePlanet(planet) {
  const index = planets.findIndex(p => p.id === planet.id);
  if (index !== -1) {
    planets[index] = planet;
  } else {
    planets.push(planet);
  }

  saveLocalBackup();

  if (isDbConnected) {
    const { error } = await supabaseClient.from("planets").upsert({
      id: planet.id,
      name: planet.name,
      system_id: planet.systemId,
      designation: planet.designation,
      resources: planet.resources,
      deposits: planet.deposits
    });
    if (error) {
      console.error(error);
      showToast("Error syncing planet in Supabase", "error");
    } else {
      showToast(`Planet '${planet.name}' synced successfully`, "success");
    }
  } else {
    showToast(`Planet '${planet.name}' saved locally`, "success");
  }
}

async function dbSaveStation(station) {
  const index = stations.findIndex(s => s.id === station.id);
  if (index !== -1) {
    stations[index] = station;
  } else {
    stations.push(station);
  }

  saveLocalBackup();

  if (isDbConnected) {
    const { error } = await supabaseClient.from("stations").upsert({
      id: station.id,
      name: station.name,
      system_id: station.systemId,
      owner: station.owner,
      facilities: JSON.stringify(station.facilities)
    });
    if (error) {
      console.error(error);
      showToast("Error syncing space station in Supabase", "error");
    } else {
      showToast(`Space Station '${station.name}' synced successfully`, "success");
    }
  } else {
    showToast(`Space Station '${station.name}' saved locally`, "success");
  }
}

async function dbDeleteStation(stationId) {
  stations = stations.filter(s => s.id !== stationId);
  saveLocalBackup();

  if (isDbConnected) {
    const { error } = await supabaseClient.from("stations").delete().eq("id", stationId);
    if (error) {
      console.error(error);
      showToast("Error deleting space station in Supabase", "error");
    } else {
      showToast("Space station deleted from database", "success");
    }
  } else {
    showToast("Space station deleted locally", "success");
  }
}

async function dbSaveConnection(conn) {
  // Check for duplicates
  const exists = connections.some(c =>
    (c.from_system_id === conn.from_system_id && c.to_system_id === conn.to_system_id) ||
    (c.from_system_id === conn.to_system_id && c.to_system_id === conn.from_system_id)
  );

  if (exists) {
    showToast("This FTL connection already exists!", "warning");
    return;
  }

  connections.push(conn);
  saveLocalBackup();

  if (isDbConnected) {
    const { error } = await supabaseClient.from("connections").insert({
      from_system_id: conn.from_system_id,
      to_system_id: conn.to_system_id,
      cost: conn.cost
    });
    if (error) {
      console.error(error);
      showToast("Error syncing connection in Supabase", "error");
    } else {
      showToast("FTL Jump Lane established on Supabase", "success");
    }
  } else {
    showToast("Connection saved locally", "success");
  }
}

async function dbDeleteSystem(sysId) {
  // Delete system
  systems = systems.filter(s => s.id !== sysId);
  // Delete system's connections
  connections = connections.filter(c => c.from_system_id !== sysId && c.to_system_id !== sysId);
  // Delete system's planets
  planets = planets.filter(p => p.systemId !== sysId);
  // Delete system's stations
  stations = stations.filter(s => s.systemId !== sysId);

  calculateBounds();
  saveLocalBackup();

  if (isDbConnected) {
    const { error } = await supabaseClient.from("systems").delete().eq("id", sysId);
    if (error) {
      console.error(error);
      showToast("Error deleting system in Supabase", "error");
    } else {
      showToast("System deleted from database", "success");
    }
  } else {
    showToast("System deleted locally", "success");
  }

  renderMap();
  populateDropdowns();
  runSearch();
  document.getElementById("details-panel").style.display = "none";
  document.getElementById("app-layout").classList.remove("details-open");
}

async function dbDeletePlanet(planetId) {
  // Delete planet
  planets = planets.filter(p => p.id !== planetId);

  saveLocalBackup();

  if (isDbConnected) {
    const { error } = await supabaseClient.from("planets").delete().eq("id", planetId);
    if (error) {
      console.error(error);
      showToast("Error deleting planet in Supabase", "error");
    } else {
      showToast("Planet deleted from database", "success");
    }
  } else {
    showToast("Planet deleted locally", "success");
  }
}

async function dbWipe() {
  sectors = [];
  systems = [];
  planets = [];
  stations = [];
  connections = [];
  bounds = { minX: 0, minY: 0, maxX: 2000, maxY: 2000 };

  saveLocalBackup();

  if (isDbConnected) {
    try {
      await supabaseClient.from("connections").delete().neq("id", 0);
      await supabaseClient.from("planets").delete().neq("id", "");
      await supabaseClient.from("stations").delete().neq("id", "");
      await supabaseClient.from("systems").delete().neq("id", "");
      await supabaseClient.from("sectors").delete().neq("id", "");
      showToast("Supabase Database Cleaned", "success");
    } catch (e) {
      console.error(e);
      showToast("Error wiping Supabase database tables", "error");
    }
  } else {
    showToast("Local database wiped clean", "success");
  }

  renderMap();
  populateDropdowns();
  runSearch();
}

// --- 4. TABS CONTROLLER ---
function initTabs() {
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabPanes = document.querySelectorAll(".tab-pane");

  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      tabButtons.forEach(b => b.classList.remove("active"));
      tabPanes.forEach(p => p.classList.remove("active"));

      btn.classList.add("active");
      const activeTabId = btn.getAttribute("data-tab");
      document.getElementById(activeTabId).classList.add("active");
    });
  });
}

// --- 5. SVG INTERACTIVE MAP CONTROLLER ---
function initMapEvents() {
  const svg = document.getElementById("map-viewport");
  const transformGroup = document.getElementById("map-transform-group");

  let dragStartClientX = 0;
  let dragStartClientY = 0;

  // Drag-to-Pan Handlers
  svg.addEventListener("mousedown", (e) => {
    // Avoid pan when clicking interactive elements (stars) or in Place Mode
    if (e.target.closest(".system-node") || isPlaceMode) return;

    isPanning = true;
    startX = e.clientX - translateX;
    startY = e.clientY - translateY;
    dragStartClientX = e.clientX;
    dragStartClientY = e.clientY;
    svg.style.cursor = "grabbing";
  });

  window.addEventListener("mousemove", (e) => {
    if (!isPanning) return;
    translateX = e.clientX - startX;
    translateY = e.clientY - startY;
    updateMapTransform();
  });

  window.addEventListener("mouseup", () => {
    if (isPanning) {
      isPanning = false;
      svg.style.cursor = "grab";
    }
  });

  // Click Handler for sector pinning
  svg.addEventListener("click", (e) => {
    const dragDistance = Math.hypot(e.clientX - dragStartClientX, e.clientY - dragStartClientY);
    if (dragDistance > 5) return;

    if (isSectorPinMode && isAdmin) {
      const rect = svg.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;

      const mapX = (clientX - translateX) / scale;
      const mapY = (clientY - translateY) / scale;

      tempSectorPoints.push([parseFloat(mapX.toFixed(1)), parseFloat(mapY.toFixed(1))]);
      document.getElementById("sector-polygon-input").value = JSON.stringify(tempSectorPoints);
      
      renderDraftSector();
    }
  });

  // Scroll-to-Zoom Handler
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();

    const zoomIntensity = 0.1;
    const rect = svg.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const oldScale = scale;
    if (e.deltaY < 0) {
      scale = Math.min(scale * (1 + zoomIntensity), 10);
    } else {
      scale = Math.max(scale * (1 - zoomIntensity), 0.05);
    }

    // Zoom relative to mouse cursor location
    translateX = mouseX - (mouseX - translateX) * (scale / oldScale);
    translateY = mouseY - (mouseY - translateY) * (scale / oldScale);

    updateMapTransform();
  });

  // Place Mode (Double click on map to create star system)
  svg.addEventListener("dblclick", (e) => {
    e.preventDefault();
    if (!isPlaceMode || !isAdmin) return;

    const rect = svg.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    // Convert screen pixel position to map space using active scale/translate
    const mapX = (clientX - translateX) / scale;
    const mapY = (clientY - translateY) / scale;

    // Populate form
    document.getElementById("system-x-input").value = mapX.toFixed(2);
    document.getElementById("system-y-input").value = mapY.toFixed(2);

    // Deactivate place mode banner
    disablePlaceMode();
    showToast("Coordinates set! Complete the form to save.", "info");
  });

  // HUD Zoom Controls
  document.getElementById("zoom-in-btn").addEventListener("click", () => {
    scale = Math.min(scale * 1.3, 10);
    updateMapTransform();
  });

  document.getElementById("zoom-out-btn").addEventListener("click", () => {
    scale = Math.max(scale / 1.3, 0.05);
    updateMapTransform();
  });

  document.getElementById("zoom-reset-btn").addEventListener("click", () => {
    recenterMap();
  });
}

function updateMapTransform() {
  const transformGroup = document.getElementById("map-transform-group");
  transformGroup.setAttribute("transform", `translate(${translateX}, ${translateY}) scale(${scale})`);

  // Redraw grid on change
  renderGrid();
}

function recenterMap() {
  const svg = document.getElementById("map-viewport");
  const width = svg.clientWidth || svg.parentNode.clientWidth;
  const height = svg.clientHeight || svg.parentNode.clientHeight;

  if (systems.length === 0) {
    scale = 1;
    translateX = 0;
    translateY = 0;
    updateMapTransform();
    return;
  }

  // Find data bounding box
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  systems.forEach(s => {
    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.y > maxY) maxY = s.y;
  });

  const mapW = maxX - minX || 100;
  const mapH = maxY - minY || 100;
  const centerX = minX + mapW / 2;
  const centerY = minY + mapH / 2;

  // Calculate best fit scale
  const padding = 100;
  const scaleX = (width - padding) / mapW;
  const scaleY = (height - padding) / mapH;
  scale = Math.min(scaleX, scaleY, 1.5); // Cap zoom at 1.5x
  scale = Math.max(scale, 0.1); // Floor at 0.1x

  // Calculate translations to center the bounding box
  translateX = width / 2 - centerX * scale;
  translateY = height / 2 - centerY * scale;

  updateMapTransform();
}

function flyToSystem(sysX, sysY) {
  const svg = document.getElementById("map-viewport");
  const width = svg.clientWidth || svg.parentNode.clientWidth;
  const height = svg.clientHeight || svg.parentNode.clientHeight;

  scale = 1.0; // zoom into 1.0 scale
  translateX = width / 2 - sysX * scale;
  translateY = height / 2 - sysY * scale;

  updateMapTransform();
}

// --- 6. RENDER LOGIC ---
function renderMap() {
  renderGrid();
  renderSectors();
  renderFTLLanes();
  renderStars();
}

// Dynamic Coordinate Grid Line drawing
function renderGrid() {
  const gridLayer = document.getElementById("grid-layer");
  const showGrid = document.getElementById("toggle-grid-checkbox").checked;
  gridLayer.innerHTML = "";

  if (!showGrid) return;

  const step = 200; // grid interval

  // Render grid within logical boundaries
  for (let x = Math.floor(bounds.minX / step) * step; x <= bounds.maxX; x += step) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", x);
    line.setAttribute("y1", bounds.minY);
    line.setAttribute("x2", x);
    line.setAttribute("y2", bounds.maxY);
    line.setAttribute("class", "grid-line");
    gridLayer.appendChild(line);
  }

  for (let y = Math.floor(bounds.minY / step) * step; y <= bounds.maxY; y += step) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", bounds.minX);
    line.setAttribute("y1", y);
    line.setAttribute("x2", bounds.maxX);
    line.setAttribute("y2", y);
    line.setAttribute("class", "grid-line");
    gridLayer.appendChild(line);
  }
}

// Sectors polygons and overlays
function renderSectors() {
  const sectorsLayer = document.getElementById("sectors-layer");
  const labelsLayer = document.getElementById("labels-layer");
  const showSectors = document.getElementById("toggle-sectors-checkbox").checked;

  sectorsLayer.innerHTML = "";

  // Remove existing sector labels
  const oldLabels = labelsLayer.querySelectorAll(".sector-label");
  oldLabels.forEach(l => l.remove());

  if (!showSectors) return;

  sectors.forEach(sec => {
    // Hide sector boundary if polygon points are empty or invalid
    if (!sec.polygon || sec.polygon.length < 3) return;

    // Draw polygon
    const pointsStr = sec.polygon.map(p => p.join(",")).join(" ");
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    poly.setAttribute("points", pointsStr);
    poly.setAttribute("class", "sector-polygon");
    poly.setAttribute("stroke", sec.color);
    poly.setAttribute("fill", sec.color);
    poly.setAttribute("id", `svg-${sec.id}`);

    sectorsLayer.appendChild(poly);

    // Draw sector name label at centroid
    if (sec.centroid) {
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", sec.centroid.x);
      text.setAttribute("y", sec.centroid.y);
      text.setAttribute("class", "sector-label");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("fill", sec.color);
      text.textContent = sec.name.toUpperCase();
      labelsLayer.appendChild(text);
    }
  });
}

// Draw FTL connections between stars
function renderFTLLanes() {
  const lanesLayer = document.getElementById("lanes-layer");
  lanesLayer.innerHTML = "";

  connections.forEach((conn, index) => {
    const fromSys = systems.find(s => s.id === conn.from_system_id);
    const toSys = systems.find(s => s.id === conn.to_system_id);

    if (fromSys && toSys) {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", fromSys.x);
      line.setAttribute("y1", fromSys.y);
      line.setAttribute("x2", toSys.x);
      line.setAttribute("y2", toSys.y);
      line.setAttribute("class", "connection-lane");
      line.setAttribute("id", `lane-${fromSys.id}-${toSys.id}`);

      // Store connection metadata
      line.dataset.from = fromSys.id;
      line.dataset.to = toSys.id;
      line.dataset.cost = conn.cost;

      lanesLayer.appendChild(line);
    }
  });
}

// Draw interactive Star Nodes
function renderStars() {
  const starsLayer = document.getElementById("stars-layer");
  const labelsLayer = document.getElementById("labels-layer");
  const showLabels = document.getElementById("toggle-labels-checkbox").checked;
  const colorMode = document.getElementById("color-mode-select").value;
  const starSize = parseInt(document.getElementById("star-size-slider").value);

  starsLayer.innerHTML = "";

  // Clean planet labels
  const oldLabels = labelsLayer.querySelectorAll(".system-label");
  oldLabels.forEach(l => l.remove());

  systems.forEach(sys => {
    // Determine system node color
    let sysColor = "#ffffff";
    if (colorMode === "sector") {
      const sec = sectors.find(s => s.id === sys.sectorId);
      if (sec) sysColor = sec.color;
    } else {
      // Color by star classification type
      if (sys.starColor === "Yellow") sysColor = "#f5d271";
      else if (sys.starColor === "Blue") sysColor = "#5aa9e6";
      else if (sys.starColor === "Red") sysColor = "#ef4444";
      else if (sys.starColor === "Purple") sysColor = "#c084fc";
    }

    // Group container
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "system-node");
    g.setAttribute("id", `node-${sys.id}`);
    g.dataset.id = sys.id;

    // Main Solid Circle
    const mainCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    mainCircle.setAttribute("cx", sys.x);
    mainCircle.setAttribute("cy", sys.y);
    mainCircle.setAttribute("r", starSize / 2);
    mainCircle.setAttribute("fill", sysColor);
    mainCircle.setAttribute("stroke", "#ffffff");
    mainCircle.setAttribute("stroke-width", 1.5);
    g.appendChild(mainCircle);

    // Event listeners
    g.addEventListener("click", (e) => {
      e.stopPropagation();
      selectSystem(sys.id);
    });

    starsLayer.appendChild(g);

    // Text labels
    if (showLabels) {
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", sys.x);
      text.setAttribute("y", sys.y - (starSize / 2) - 6);
      text.setAttribute("class", "system-label");
      text.setAttribute("text-anchor", "middle");
      text.textContent = sys.name;
      text.setAttribute("id", `label-${sys.id}`);
      labelsLayer.appendChild(text);
    }
  });

  // Highlight active selected system if any
  if (selectedSystemId) {
    highlightSelectedNode(selectedSystemId);
  }
}

function selectSystem(sysId) {
  selectedSystemId = sysId;
  const sys = systems.find(s => s.id === sysId);
  if (!sys) return;

  // Highlight node
  highlightSelectedNode(sysId);

  // Show Details Sidebar Panel
  const panel = document.getElementById("details-panel");
  panel.style.display = "flex";
  document.getElementById("app-layout").classList.add("details-open");

  document.getElementById("detail-system-name").textContent = sys.name;
  document.getElementById("detail-system-designation").textContent = sys.designation || "NO DESIGNATION";

  const sec = sectors.find(s => s.id === sys.sectorId);
  document.getElementById("detail-system-sector").textContent = sec ? sec.name : "Unknown Sector";
  document.getElementById("detail-system-coords").textContent = `X: ${sys.x.toFixed(1)}, Y: ${sys.y.toFixed(1)}`;

  const starBadge = document.getElementById("detail-system-star-type");
  starBadge.textContent = sys.starType.replace("Star", " Star");
  starBadge.className = `badge badge-${getStarColorClass(sys.starColor)}`;

  // Populate Planets list
  const planetSelect = document.getElementById("detail-planet-select");
  const noPlanetsMsg = document.getElementById("no-planets-msg");
  const subpanel = document.getElementById("planet-details-subpanel");
  
  planetSelect.innerHTML = "";
  
  const sysPlanets = planets.filter(p => p.systemId === sysId);
  if (sysPlanets.length > 0) {
    noPlanetsMsg.style.display = "none";
    sysPlanets.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      planetSelect.appendChild(opt);
    });
    // Select first planet by default
    selectPlanetInDetails(sysPlanets[0].id);
  } else {
    noPlanetsMsg.style.display = "block";
    if (subpanel) subpanel.style.display = "none";
    selectedPlanetId = null;
  }

  // Populate Space Stations list
  const stationSelect = document.getElementById("detail-station-select");
  const noStationsMsg = document.getElementById("no-stations-msg");
  const stationSubpanel = document.getElementById("station-details-subpanel");

  stationSelect.innerHTML = "";

  const sysStations = stations.filter(st => st.systemId === sysId);
  if (sysStations.length > 0) {
    noStationsMsg.style.display = "none";
    sysStations.forEach(st => {
      const opt = document.createElement("option");
      opt.value = st.id;
      opt.textContent = st.name;
      stationSelect.appendChild(opt);
    });
    // Select first station by default
    selectStationInDetails(sysStations[0].id);
  } else {
    noStationsMsg.style.display = "block";
    if (stationSubpanel) stationSubpanel.style.display = "none";
    selectedStationId = null;
  }

  // Center on viewport
  flyToSystem(sys.x, sys.y);
}

window.selectPlanetInDetails = function(planetId) {
  selectedPlanetId = planetId;
  const planet = planets.find(p => p.id === planetId);
  const subpanel = document.getElementById("planet-details-subpanel");
  
  if (!planet) {
    if (subpanel) subpanel.style.display = "none";
    return;
  }

  if (subpanel) subpanel.style.display = "block";
  document.getElementById("detail-planet-designation").textContent = planet.designation || "NO DESIGNATION";

  // Resources List
  const resourcesList = document.getElementById("detail-planet-resources-list");
  const noResourcesMsg = document.getElementById("planet-no-resources-msg");
  resourcesList.innerHTML = "";

  if (planet.resources && planet.resources.length > 0) {
    noResourcesMsg.style.display = "none";
    planet.resources.forEach(r => {
      const chip = document.createElement("span");
      chip.className = "chip";
      const removeBtn = isAdmin ? `<button type="button" class="admin-only" onclick="removePlanetResource('${planet.id}', '${r}')">✕</button>` : '';
      chip.innerHTML = `
        ${r} 
        ${removeBtn}
      `;
      resourcesList.appendChild(chip);
    });
  } else {
    noResourcesMsg.style.display = "block";
  }

  // Deposits List
  const depositsList = document.getElementById("detail-planet-deposits-list");
  const noDepositsMsg = document.getElementById("planet-no-deposits-msg");
  depositsList.innerHTML = "";

  if (planet.deposits && planet.deposits.length > 0) {
    noDepositsMsg.style.display = "none";
    planet.deposits.forEach(d => {
      const chip = document.createElement("span");
      chip.className = "chip";
      const removeBtn = isAdmin ? `<button type="button" class="admin-only" onclick="removePlanetDeposit('${planet.id}', '${d}')">✕</button>` : '';
      chip.innerHTML = `
        <code>${d}</code>
        ${removeBtn}
      `;
      depositsList.appendChild(chip);
    });
  } else {
    noDepositsMsg.style.display = "block";
  }
};

window.selectStationInDetails = function(stationId) {
  selectedStationId = stationId;
  const station = stations.find(s => s.id === stationId);
  const subpanel = document.getElementById("station-details-subpanel");

  if (!station) {
    if (subpanel) subpanel.style.display = "none";
    return;
  }

  if (subpanel) subpanel.style.display = "block";
  document.getElementById("detail-station-owner").textContent = station.owner || "Independent";

  // Facilities List
  const facilitiesList = document.getElementById("detail-station-facilities-list");
  facilitiesList.innerHTML = "";

  if (station.facilities && station.facilities.length > 0) {
    station.facilities.forEach(f => {
      const chip = document.createElement("span");
      chip.className = "chip";
      const removeBtn = isAdmin ? `<button type="button" class="admin-only" onclick="removeStationFacility('${station.id}', '${f.type}')">✕</button>` : '';
      chip.innerHTML = `
        <span class="badge badge-blue" style="font-size:0.75rem;">${f.type}</span>
        ${removeBtn}
      `;
      facilitiesList.appendChild(chip);
    });
  } else {
    facilitiesList.innerHTML = `<div style="color:var(--text-muted); font-size:0.8rem; font-style:italic;">No facilities recorded.</div>`;
  }
};

window.removePlanetResource = async function (planetId, resName) {
  if (!isAdmin) return;
  const planet = planets.find(p => p.id === planetId);
  if (planet) {
    planet.resources = planet.resources.filter(r => r !== resName);
    await dbSavePlanet(planet);
    selectPlanetInDetails(planetId);
    populateDropdowns();
  }
};

window.removePlanetDeposit = async function (planetId, depName) {
  if (!isAdmin) return;
  const planet = planets.find(p => p.id === planetId);
  if (planet) {
    planet.deposits = planet.deposits.filter(d => d !== depName);
    await dbSavePlanet(planet);
    selectPlanetInDetails(planetId);
  }
};

window.removeStationFacility = async function (stationId, facilityType) {
  if (!isAdmin) return;
  const station = stations.find(s => s.id === stationId);
  if (station) {
    station.facilities = station.facilities.filter(f => f.type !== facilityType);
    await dbSaveStation(station);
    selectStationInDetails(stationId);
  }
};

function highlightSelectedNode(sysId) {
  // Remove visual highlights from others
  const nodes = document.querySelectorAll(".system-node");
  nodes.forEach(n => {
    const c = n.querySelector("circle");
    if (c) {
      c.setAttribute("stroke", "#ffffff");
      c.setAttribute("stroke-width", "1.5");
    }
  });

  const selectedNode = document.getElementById(`node-${sysId}`);
  if (selectedNode) {
    const c = selectedNode.querySelector("circle");
    if (c) {
      c.setAttribute("stroke", "var(--accent-blue)");
      c.setAttribute("stroke-width", "3.0");
    }
  }
}

function getStarColorClass(color) {
  if (color === "Yellow") return "yellow";
  if (color === "Blue") return "blue";
  if (color === "Red") return "red";
  if (color === "Purple") return "purple";
  return "blue";
}

// --- 7. SEARCH MODULE ---
function runSearch() {
  const query = document.getElementById("search-input").value.toLowerCase();
  const selectedResource = document.getElementById("resource-filter").value;

  const resultsList = document.getElementById("search-results-list");
  resultsList.innerHTML = "";

  const filtered = systems.filter(sys => {
    const nameMatch = sys.name.toLowerCase().includes(query) ||
      (sys.designation && sys.designation.toLowerCase().includes(query));

    const sysPlanets = planets.filter(p => p.systemId === sys.id);
    const resourceMatch = !selectedResource || sysPlanets.some(p => p.resources && p.resources.includes(selectedResource));

    return nameMatch && resourceMatch;
  });

  document.getElementById("results-count").textContent = filtered.length;

  filtered.forEach(sys => {
    const item = document.createElement("div");
    item.className = "result-item";
    item.addEventListener("click", () => selectSystem(sys.id));

    const sec = sectors.find(s => s.id === sys.sectorId);

    item.innerHTML = `
      <div class="result-header">
        <span>${sys.name}</span>
        <span class="badge badge-${getStarColorClass(sys.starColor)}">${sys.starColor}</span>
      </div>
      <div class="result-subtitle">Sector: ${sec ? sec.name : 'Unknown'} • Code: ${sys.designation || 'None'}</div>
    `;
    resultsList.appendChild(item);
  });
}

// --- 8. DIJKSTRA SHORTPATH ROUTING CONTROLLER ---
function calculateRoute() {
  const startId = document.getElementById("route-start-select").value;
  const endId = document.getElementById("route-end-select").value;

  if (!startId || !endId) {
    showToast("Please select both starting and destination systems", "warning");
    return;
  }

  if (startId === endId) {
    showToast("Starting and destination systems are the same!", "warning");
    return;
  }

  // Clear any existing highlights
  clearRouteHighlights();

  // 1. Build adjacency list graph from connection records (bidirectional)
  const graph = {};
  systems.forEach(s => graph[s.id] = []);

  connections.forEach(conn => {
    // Verify systems exist
    if (graph[conn.from_system_id] && graph[conn.to_system_id]) {
      graph[conn.from_system_id].push({ id: conn.to_system_id, cost: conn.cost });
      graph[conn.to_system_id].push({ id: conn.from_system_id, cost: conn.cost });
    }
  });

  // 2. Run Dijkstra Algorithm
  const distances = {};
  const previous = {};
  const queue = new Set();

  systems.forEach(s => {
    distances[s.id] = Infinity;
    previous[s.id] = null;
    queue.add(s.id);
  });

  distances[startId] = 0;

  while (queue.size > 0) {
    // Find node with minimum distance in the queue
    let minDistance = Infinity;
    let minNode = null;

    queue.forEach(nodeId => {
      if (distances[nodeId] < minDistance) {
        minDistance = distances[nodeId];
        minNode = nodeId;
      }
    });

    if (minNode === null || distances[minNode] === Infinity) {
      break; // Destination unreachable or queue empty
    }

    if (minNode === endId) {
      break; // Found shortest path to target
    }

    queue.delete(minNode);

    // Visit neighbors
    const neighbors = graph[minNode] || [];
    neighbors.forEach(neighbor => {
      if (!queue.has(neighbor.id)) return;

      const alt = distances[minNode] + neighbor.cost;
      if (alt < distances[neighbor.id]) {
        distances[neighbor.id] = alt;
        previous[neighbor.id] = minNode;
      }
    });
  }

  // 3. Reconstruct shortest path
  const path = [];
  let current = endId;
  while (current !== null) {
    path.push(current);
    current = previous[current];
  }
  path.reverse();

  if (path.length <= 1 || path[0] !== startId) {
    showToast("No FTL jump connection path found between these star systems.", "error");
    return;
  }

  // 4. Highlight path in GUI SVG
  const cost = distances[endId];
  const stepsList = document.getElementById("route-steps-list");
  stepsList.innerHTML = "";

  document.getElementById("route-jumps").textContent = path.length - 1;
  document.getElementById("route-cost").textContent = cost;
  document.getElementById("route-details").style.display = "block";

  // Highlight lanes
  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i];
    const to = path[i + 1];

    // Add visual glowing lane style
    const lane1 = document.getElementById(`lane-${from}-${to}`);
    const lane2 = document.getElementById(`lane-${to}-${from}`);
    if (lane1) lane1.classList.add("active-path");
    if (lane2) lane2.classList.add("active-path");

    // Generate step card
    const fromSys = systems.find(s => s.id === from);
    const toSys = systems.find(s => s.id === to);

    const stepItem = document.createElement("li");
    stepItem.innerHTML = `Jump to <strong>${toSys.name}</strong> <span style="color:var(--text-secondary)">(${fromSys.name} ➔ ${toSys.name})</span>`;
    stepsList.appendChild(stepItem);
  }

  showToast("FTL route calculated and highlighted!", "success");
}

function clearRouteHighlights() {
  document.querySelectorAll(".connection-lane").forEach(lane => {
    lane.classList.remove("active-path");
  });
  document.getElementById("route-details").style.display = "none";
}

// --- 9. ADMINISTRATIVE PORTALS (AUTHENTICATION & CREATOR) ---
function initForms() {
  // Login flow
  const loginNavBtn = document.getElementById("login-nav-btn");
  const logoutNavBtn = document.getElementById("logout-nav-btn");
  const loginModal = document.getElementById("login-modal");
  const closeLoginBtn = document.getElementById("close-login-btn");
  const loginForm = document.getElementById("login-form");
  const loginError = document.getElementById("login-error");

  loginNavBtn.addEventListener("click", () => {
    loginModal.classList.add("active");
    loginError.style.display = "none";
  });

  closeLoginBtn.addEventListener("click", () => {
    loginModal.classList.remove("active");
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const user = document.getElementById("login-username").value;
    const pass = document.getElementById("login-password").value;

    let loginSuccess = false;

    if (isDbConnected) {
      // Authenticate with Supabase Auth
      try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
          email: user, // using username field as email
          password: pass
        });
        if (error) throw error;
        loginSuccess = true;
      } catch (err) {
        console.error("Supabase Auth error", err);
        loginError.textContent = "Auth Error: " + err.message;
        loginError.style.display = "block";
      }
    } else {
      // Local Sandbox mock auth
      if (user === "admin" && pass === "admin") {
        loginSuccess = true;
      } else {
        loginError.textContent = "Invalid username or password.";
        loginError.style.display = "block";
      }
    }

    if (loginSuccess) {
      isAdmin = true;
      document.body.classList.add("admin-mode");
      document.getElementById("creator-locked-message").style.display = "none";
      document.getElementById("creator-tools-panel").style.display = "flex";
      loginModal.classList.remove("active");
      loginForm.reset();
      showToast("Administrator Mode Unlocked", "success");

      // Re-render nodes to show resource removal buttons in detail panel if open
      if (selectedSystemId) {
        selectSystem(selectedSystemId);
      }
      renderStars();
    }
  });

  logoutNavBtn.addEventListener("click", async () => {
    if (isDbConnected) {
      await supabaseClient.auth.signOut();
    }
    isAdmin = false;
    document.body.classList.remove("admin-mode");
    document.getElementById("creator-locked-message").style.display = "block";
    document.getElementById("creator-tools-panel").style.display = "none";
    showToast("Logged out successfully");

    // If an admin-only tab is active, switch back to Systems tab
    const activeTab = document.querySelector(".tab-btn.active");
    if (activeTab && (activeTab.getAttribute("data-tab") === "admin-tab" || activeTab.getAttribute("data-tab") === "settings-tab")) {
      const systemsTabBtn = document.querySelector('.tab-btn[data-tab="search-tab"]');
      if (systemsTabBtn) {
        systemsTabBtn.click();
      }
    }

    if (selectedSystemId) {
      selectSystem(selectedSystemId);
    }
    renderStars();
  });

  // Creator: Place Node Button
  const placeBtn = document.getElementById("activate-place-mode-btn");
  placeBtn.addEventListener("click", () => {
    if (!isAdmin) return;
    isPlaceMode = true;
    document.getElementById("place-banner").classList.add("active");
  });

  document.getElementById("cancel-place-btn").addEventListener("click", disablePlaceMode);

  // Creator Forms Submission
  document.getElementById("create-sector-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!isAdmin) return;

    const id = document.getElementById("sector-id-input").value.trim();
    const name = document.getElementById("sector-name-input").value.trim();
    const color = document.getElementById("sector-color-input").value;
    const polyStr = document.getElementById("sector-polygon-input").value.trim();

    try {
      const polygon = JSON.parse(polyStr);
      if (!Array.isArray(polygon) || polygon.some(p => !Array.isArray(p) || p.length !== 2)) {
        throw new Error("Invalid coordinate format. Must be Array of pairs: [[x1,y1],[x2,y2]]");
      }

      // Calculate Centroid (average coordinate)
      let sumX = 0, sumY = 0;
      polygon.forEach(p => {
        sumX += p[0];
        sumY += p[1];
      });
      const centroid = {
        x: sumX / polygon.length,
        y: sumY / polygon.length
      };

      const newSector = {
        id,
        name,
        color,
        polygon,
        centroid,
        index: sectors.length
      };

      await dbSaveSector(newSector);
      e.target.reset();
      disableSectorPinMode();

      populateDropdowns();
      renderMap();
    } catch (err) {
      showToast(`Sector creation failed: ${err.message}`, "error");
    }
  });

  document.getElementById("create-system-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!isAdmin) return;

    const id = document.getElementById("system-id-input").value.trim();
    const name = document.getElementById("system-name-input").value.trim();
    const designation = document.getElementById("system-designation-input").value.trim();
    const x = parseFloat(document.getElementById("system-x-input").value);
    const y = parseFloat(document.getElementById("system-y-input").value);
    const sectorId = document.getElementById("system-sector-select").value;

    const starVal = document.getElementById("system-star-color-select").value.split("_");
    const starColor = starVal[0];
    const starType = starVal[1];

    const newSys = {
      id,
      name,
      designation,
      x,
      y,
      sectorId,
      starColor,
      starType,
      color: "#ffffff", // Sector color override is handled dynamically
      index: systems.length
    };

    await dbSaveSystem(newSys);
    e.target.reset();

    populateDropdowns();
    renderMap();
    runSearch();
  });

  // Creator: Save Planet Form Submission
  document.getElementById("create-planet-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!isAdmin) return;

    const id = document.getElementById("planet-id-input").value.trim();
    const name = document.getElementById("planet-name-input").value.trim();
    const designation = document.getElementById("planet-designation-input").value.trim();
    const systemId = document.getElementById("planet-system-select").value;

    const newPlanet = {
      id,
      name,
      designation,
      systemId,
      resources: [],
      deposits: []
    };

    await dbSavePlanet(newPlanet);
    e.target.reset();

    populateDropdowns();
  });

  // Creator: Save Space Station Form Submission
  document.getElementById("create-station-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!isAdmin) return;

    const id = document.getElementById("station-id-input").value.trim();
    const name = document.getElementById("station-name-input").value.trim();
    const owner = document.getElementById("station-owner-input").value.trim() || "Independent";
    const systemId = document.getElementById("station-system-select").value;

    const newStation = {
      id,
      name,
      owner,
      systemId,
      facilities: []
    };

    await dbSaveStation(newStation);
    e.target.reset();

    populateDropdowns();
  });

  document.getElementById("create-connection-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!isAdmin) return;

    const from_system_id = document.getElementById("conn-from-select").value;
    const to_system_id = document.getElementById("conn-to-select").value;
    const cost = parseInt(document.getElementById("conn-cost-input").value);

    if (from_system_id === to_system_id) {
      showToast("Cannot connect a system to itself!", "warning");
      return;
    }

    const newConn = { from_system_id, to_system_id, cost };
    await dbSaveConnection(newConn);

    e.target.reset();
    renderMap();
  });

  // Creator: Pin/Drawing buttons listeners
  document.getElementById("activate-sector-pin-btn").addEventListener("click", () => {
    if (isSectorPinMode) {
      disableSectorPinMode();
    } else {
      enableSectorPinMode();
    }
  });

  document.getElementById("undo-sector-pin-btn").addEventListener("click", undoSectorPoint);
  document.getElementById("clear-sector-pin-btn").addEventListener("click", clearSectorPoints);

  // Wipe Database click handler
  document.getElementById("clear-database-btn").addEventListener("click", () => {
    if (!isAdmin) return;
    if (confirm("🚨 WARNING: Are you sure you want to delete ALL custom sectors, systems, and FTL pathways? This action cannot be undone.")) {
      dbWipe();
    }
  });

  // Delete system click handler
  document.getElementById("delete-system-btn").addEventListener("click", () => {
    if (selectedSystemId && isAdmin) {
      if (confirm(`Delete system ${selectedSystemId}?`)) {
        dbDeleteSystem(selectedSystemId);
      }
    }
  });

  // JSON Portability Trigger Actions
  document.getElementById("export-json-btn").addEventListener("click", exportGalaxyJson);

  const fileInput = document.getElementById("import-json-file-input");
  document.getElementById("import-json-trigger-btn").addEventListener("click", () => {
    fileInput.click();
  });

  fileInput.addEventListener("change", importGalaxyJson);
}



function disablePlaceMode() {
  isPlaceMode = false;
  if (!isSectorPinMode) {
    document.getElementById("place-banner").classList.remove("active");
  }
}

function enableSectorPinMode() {
  isSectorPinMode = true;
  isPlaceMode = false;
  document.getElementById("place-banner").classList.remove("active");
  
  const banner = document.getElementById("place-banner");
  banner.querySelector("span").innerHTML = `<strong>Sector Pin Mode Active:</strong> Click on the map to add boundary points.`;
  banner.classList.add("active");

  document.getElementById("undo-sector-pin-btn").style.display = "inline-flex";
  document.getElementById("clear-sector-pin-btn").style.display = "inline-flex";
  document.getElementById("activate-sector-pin-btn").textContent = "Stop Pinning";
}

function disableSectorPinMode() {
  isSectorPinMode = false;
  document.getElementById("place-banner").classList.remove("active");
  document.getElementById("undo-sector-pin-btn").style.display = "none";
  document.getElementById("clear-sector-pin-btn").style.display = "none";
  document.getElementById("activate-sector-pin-btn").textContent = "📍 Pin Points on Map";
  
  const draftLayer = document.getElementById("draft-sector-layer");
  if (draftLayer) draftLayer.innerHTML = "";
}

function undoSectorPoint() {
  if (tempSectorPoints.length > 0) {
    tempSectorPoints.pop();
    document.getElementById("sector-polygon-input").value = tempSectorPoints.length > 0 ? JSON.stringify(tempSectorPoints) : "";
    renderDraftSector();
  }
}

function clearSectorPoints() {
  tempSectorPoints = [];
  document.getElementById("sector-polygon-input").value = "";
  renderDraftSector();
}

function renderDraftSector() {
  const draftLayer = document.getElementById("draft-sector-layer");
  if (!draftLayer) return;
  draftLayer.innerHTML = "";

  if (tempSectorPoints.length === 0) return;

  const color = document.getElementById("sector-color-input").value || "#a855f7";

  if (tempSectorPoints.length >= 2) {
    const pointsStr = tempSectorPoints.map(p => p.join(",")).join(" ");
    const elementTag = tempSectorPoints.length >= 3 ? "polygon" : "polyline";
    const shape = document.createElementNS("http://www.w3.org/2000/svg", elementTag);
    shape.setAttribute("points", pointsStr);
    shape.setAttribute("stroke", color);
    shape.setAttribute("stroke-width", "2.0");
    shape.setAttribute("fill", color);
    shape.setAttribute("fill-opacity", "0.15");
    shape.setAttribute("stroke-dasharray", "4 4");
    draftLayer.appendChild(shape);
  }

  tempSectorPoints.forEach((p, idx) => {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", p[0]);
    circle.setAttribute("cy", p[1]);
    circle.setAttribute("r", "5");
    circle.setAttribute("fill", color);
    circle.setAttribute("stroke", "#ffffff");
    circle.setAttribute("stroke-width", "1.5");
    draftLayer.appendChild(circle);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", p[0] + 8);
    text.setAttribute("y", p[1] + 4);
    text.setAttribute("fill", "#ffffff");
    text.setAttribute("font-size", "10px");
    text.setAttribute("font-family", "monospace");
    text.textContent = idx + 1;
    draftLayer.appendChild(text);
  });
}

function populateDropdowns() {
  // 1. Sector assignment dropdowns
  const sectorSelect = document.getElementById("system-sector-select");
  sectorSelect.innerHTML = '<option value="">Select Sector...</option>';
  sectors.forEach(s => {
    sectorSelect.innerHTML += `<option value="${s.id}">${s.name}</option>`;
  });

  // 2. Connection dropdowns
  const connFrom = document.getElementById("conn-from-select");
  const connTo = document.getElementById("conn-to-select");
  connFrom.innerHTML = '<option value="">Select System...</option>';
  connTo.innerHTML = '<option value="">Select System...</option>';

  // Sort systems alphabetically
  const sorted = [...systems].sort((a, b) => a.name.localeCompare(b.name));
  sorted.forEach(s => {
    const opt = `<option value="${s.id}">${s.name}</option>`;
    connFrom.innerHTML += opt;
    connTo.innerHTML += opt;
  });

  // 3. Routing start/end dropdowns
  const routeStart = document.getElementById("route-start-select");
  const routeEnd = document.getElementById("route-end-select");
  routeStart.innerHTML = '<option value="">Select Origin...</option>';
  routeEnd.innerHTML = '<option value="">Select Destination...</option>';

  sorted.forEach(s => {
    const opt = `<option value="${s.id}">${s.name}</option>`;
    routeStart.innerHTML += opt;
    routeEnd.innerHTML += opt;
  });

  // 4. Resources filter dropdown
  const resourceFilter = document.getElementById("resource-filter");
  const uniqueResources = new Set();
  planets.forEach(p => {
    if (p.resources) p.resources.forEach(r => uniqueResources.add(r));
  });

  resourceFilter.innerHTML = '<option value="">All Resources</option>';
  [...uniqueResources].sort().forEach(r => {
    resourceFilter.innerHTML += `<option value="${r}">${r}</option>`;
  });

  // 5. Planet system assignment dropdown
  const planetSystemSelect = document.getElementById("planet-system-select");
  if (planetSystemSelect) {
    planetSystemSelect.innerHTML = '<option value="">Select System...</option>';
    sorted.forEach(s => {
      planetSystemSelect.innerHTML += `<option value="${s.id}">${s.name}</option>`;
    });
  }

  // 6. Station system assignment dropdown
  const stationSystemSelect = document.getElementById("station-system-select");
  if (stationSystemSelect) {
    stationSystemSelect.innerHTML = '<option value="">Select System...</option>';
    sorted.forEach(s => {
      stationSystemSelect.innerHTML += `<option value="${s.id}">${s.name}</option>`;
    });
  }
}

// JSON Portability (Export)
function exportGalaxyJson() {
  const exportData = {
    bounds,
    sectors,
    systems,
    planets,
    stations,
    // Format connections into structural object to match sample template
    connections: {}
  };

  // Map bidirectional connection list
  systems.forEach(s => exportData.connections[s.id] = []);
  connections.forEach(c => {
    if (exportData.connections[c.from_system_id]) {
      exportData.connections[c.from_system_id].push({ id: c.to_system_id, cost: c.cost });
    }
  });

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "custom_galaxy_map.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("Galaxy JSON configuration exported successfully", "success");
}

// JSON Portability (Import)
async function importGalaxyJson(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const data = JSON.parse(event.target.result);
      if (!data.sectors || !data.systems) {
        throw new Error("Missing sectors or systems data arrays.");
      }

      // Clean database first
      await dbWipe();

      // 1. Upload Sectors
      for (const sec of data.sectors) {
        await dbSaveSector(sec);
      }

      // 2. Upload Systems
      for (const sys of data.systems) {
        await dbSaveSystem(sys);
      }

      // 2b. Upload Planets
      if (data.planets) {
        for (const planet of data.planets) {
          await dbSavePlanet(planet);
        }
      }

      // 2c. Upload Stations
      if (data.stations) {
        for (const station of data.stations) {
          await dbSaveStation(station);
        }
      }

      // 3. Upload Connections
      if (data.connections) {
        // connections object format
        for (const [fromId, list] of Object.entries(data.connections)) {
          for (const c of list) {
            // Check that destination system exists
            if (systems.some(s => s.id === c.id)) {
              await dbSaveConnection({ from_system_id: fromId, to_system_id: c.id, cost: c.cost });
            }
          }
        }
      }

      calculateBounds();
      renderMap();
      populateDropdowns();
      runSearch();
      recenterMap();

      showToast("Galaxy layout imported successfully", "success");
    } catch (err) {
      console.error(err);
      showToast(`Import failed: ${err.message}`, "error");
    }
  };
  reader.readAsText(file);
}

// --- 10. SYSTEM CONFIGURATION & DIALOG SETTINGS ---
function initSettings() {
  const urlInput = document.getElementById("db-url-input");
  const keyInput = document.getElementById("db-key-input");

  // Supabase Credential form handler
  document.getElementById("db-config-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    const key = keyInput.value.trim();

    if (url && key) {
      safeSetItem("spacecraft_supabase_url", url);
      safeSetItem("spacecraft_supabase_key", key);

      SUPABASE_URL = url;
      SUPABASE_KEY = key;

      connectToSupabase();
      loadData();
    } else {
      showToast("Please provide both Supabase URL and Key", "warning");
    }
  });

  document.getElementById("disconnect-db-btn").addEventListener("click", () => {
    safeRemoveItem("spacecraft_supabase_url");
    safeRemoveItem("spacecraft_supabase_key");

    SUPABASE_URL = "";
    SUPABASE_KEY = "";
    urlInput.value = "";
    keyInput.value = "";

    connectToSupabase();
    loadData();
  });

  // UI Display Toggles
  const toggle_grid_checkbox_el = document.getElementById("toggle-grid-checkbox"); if (toggle_grid_checkbox_el) toggle_grid_checkbox_el.addEventListener("change", renderGrid);
  const toggle_sectors_checkbox_el = document.getElementById("toggle-sectors-checkbox"); if (toggle_sectors_checkbox_el) toggle_sectors_checkbox_el.addEventListener("change", renderMap);
  const toggle_labels_checkbox_el = document.getElementById("toggle-labels-checkbox"); if (toggle_labels_checkbox_el) toggle_labels_checkbox_el.addEventListener("change", renderStars);
  const color_mode_select_el = document.getElementById("color-mode-select"); if (color_mode_select_el) color_mode_select_el.addEventListener("change", renderStars);

  const sizeSlider = document.getElementById("star-size-slider");
  const sizeVal = document.getElementById("star-size-val");
  sizeSlider.addEventListener("input", () => {
    sizeVal.textContent = `${sizeSlider.value}px`;
    renderStars();
  });

  // Details sidebar buttons
  document.getElementById("close-details-btn").addEventListener("click", () => {
    document.getElementById("details-panel").style.display = "none";
    selectedSystemId = null;
    renderStars();
  });

  document.getElementById("route-set-start-btn").addEventListener("click", () => {
    if (selectedSystemId) {
      document.getElementById("route-start-select").value = selectedSystemId;
      showToast(`Origin set to: ${selectedSystemId}`);
    }
  });

  document.getElementById("route-set-end-btn").addEventListener("click", () => {
    if (selectedSystemId) {
      document.getElementById("route-end-select").value = selectedSystemId;
      showToast(`Destination set to: ${selectedSystemId}`);
    }
  });

  // Route calculating planner actions
  const calculate_route_btn_el = document.getElementById("calculate-route-btn"); if (calculate_route_btn_el) calculate_route_btn_el.addEventListener("click", calculateRoute);
  document.getElementById("clear-route-btn").addEventListener("click", () => {
    document.getElementById("route-start-select").value = "";
    document.getElementById("route-end-select").value = "";
    clearRouteHighlights();
    showToast("FTL path highlights cleared.");
  });

  // Search filtering event hooks
  const search_input_el = document.getElementById("search-input"); if (search_input_el) search_input_el.addEventListener("input", runSearch);
  const resource_filter_el = document.getElementById("resource-filter"); if (resource_filter_el) resource_filter_el.addEventListener("change", runSearch);

  // Planet selector change listener
  const detailPlanetSelect = document.getElementById("detail-planet-select");
  if (detailPlanetSelect) {
    detailPlanetSelect.addEventListener("change", (e) => {
      selectPlanetInDetails(e.target.value);
    });
  }

  // Resource Form
  const addPlanetResForm = document.getElementById("add-planet-resource-form");
  if (addPlanetResForm) {
    addPlanetResForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!selectedPlanetId || !isAdmin) return;

      const planet = planets.find(p => p.id === selectedPlanetId);
      if (!planet) return;

      const resName = document.getElementById("new-planet-resource-input").value.trim();
      if (resName && !planet.resources.includes(resName)) {
        planet.resources.push(resName);
        await dbSavePlanet(planet);
        selectPlanetInDetails(selectedPlanetId);
        populateDropdowns();
      }
      e.target.reset();
    });
  }

  // Deposit Form
  const addPlanetDepForm = document.getElementById("add-planet-deposit-form");
  if (addPlanetDepForm) {
    addPlanetDepForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!selectedPlanetId || !isAdmin) return;

      const planet = planets.find(p => p.id === selectedPlanetId);
      if (!planet) return;

      const depName = document.getElementById("new-planet-deposit-input").value.trim();
      if (depName && !planet.deposits.includes(depName)) {
        planet.deposits.push(depName);
        await dbSavePlanet(planet);
        selectPlanetInDetails(selectedPlanetId);
      }
      e.target.reset();
    });
  }

  // Station selector change listener
  const detailStationSelect = document.getElementById("detail-station-select");
  if (detailStationSelect) {
    detailStationSelect.addEventListener("change", (e) => {
      selectStationInDetails(e.target.value);
    });
  }

  // Facility Form
  const addStationFacilityForm = document.getElementById("add-station-facility-form");
  if (addStationFacilityForm) {
    addStationFacilityForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!selectedStationId || !isAdmin) return;

      const station = stations.find(s => s.id === selectedStationId);
      if (!station) return;

      const facType = document.getElementById("new-station-facility-select").value;
      if (!station.facilities) station.facilities = [];

      // Check if facility already exists
      if (!station.facilities.some(f => f.type === facType)) {
        station.facilities.push({ type: facType });
        await dbSaveStation(station);
        selectStationInDetails(selectedStationId);
      } else {
        showToast("Facility already exists on this station!", "warning");
      }
    });
  }

  // Delete Station Button
  const deleteStationBtn = document.getElementById("delete-station-btn");
  if (deleteStationBtn) {
    deleteStationBtn.addEventListener("click", async () => {
      if (selectedStationId && isAdmin) {
        if (confirm(`Are you sure you want to delete space station ${selectedStationId}?`)) {
          const sysId = selectedSystemId;
          await dbDeleteStation(selectedStationId);
          if (sysId) {
            selectSystem(sysId);
          }
        }
      }
    });
  }

  // Delete Planet Button
  const deletePlanetBtn = document.getElementById("delete-planet-btn");
  if (deletePlanetBtn) {
    deletePlanetBtn.addEventListener("click", async () => {
      if (selectedPlanetId && isAdmin) {
        if (confirm(`Are you sure you want to delete planet ${selectedPlanetId}?`)) {
          const sysId = selectedSystemId;
          await dbDeletePlanet(selectedPlanetId);
          if (sysId) {
            selectSystem(sysId);
          }
        }
      }
    });
  }

}

// --- 11. SST FILE DROPZONE WORKER SCANNER ---
function initSstDropzone() {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("sst-file-input");

  dropzone.addEventListener("click", () => fileInput.click());

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.style.borderColor = "var(--accent-purple)";
    dropzone.style.background = "rgba(139, 92, 246, 0.05)";
  });

  dropzone.addEventListener("dragleave", () => {
    dropzone.style.borderColor = "var(--border-light)";
    dropzone.style.background = "rgba(0,0,0,0.15)";
  });

  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.style.borderColor = "var(--border-light)";
    dropzone.style.background = "rgba(0,0,0,0.15)";

    const files = Array.from(e.dataTransfer.files);
    handleSstFiles(files);
  });

  fileInput.addEventListener("change", (e) => {
    const files = Array.from(e.target.files);
    handleSstFiles(files);
  });
}

function handleSstFiles(files) {
  const savFiles = files.filter(f => f.name.toLowerCase().endsWith(".sav"));
  if (savFiles.length > 0) {
    showToast("⚠️ You uploaded a .sav file. That stores player inventory and profile progress, not the map layout! To build the map, navigate to the 'RocksDB/Worlds/[World ID]/' folder and select the .sst files there.", "warning");
    return;
  }

  const sstFiles = files.filter(f => f.name.toLowerCase().endsWith(".sst"));
  if (sstFiles.length === 0) {
    showToast("Please drop or choose valid SpaceCraft .sst save files.", "error");
    return;
  }

  // Initialize worker
  if (!sstWorker) {
    try {
      sstWorker = new Worker("worker.js");

      sstWorker.onmessage = async (e) => {
        const msg = e.data;

        if (msg.type === "progress") {
          updateWorkerStatus(`Reading save files... ${msg.progress.fileIndex + 1}/${msg.progress.fileCount}`, (msg.progress.fileIndex / msg.progress.fileCount) * 100);
        }
        else if (msg.type === "complete") {
          hideWorkerStatus();
          await importParsedWorkerLayout(msg.result);
        }
        else if (msg.type === "error") {
          hideWorkerStatus();
          showToast(`SST Scan Failed: ${msg.error}`, "error");
          console.error(msg);
        }
      };
    } catch (e) {
      console.error(e);
      showToast("Failed to initialize background save-file worker parser.", "error");
      return;
    }
  }

  // Start scan inside worker
  updateWorkerStatus("Analyzing save layout...", 0);
  sstWorker.postMessage({ type: "scan", files: sstFiles });
}

function updateWorkerStatus(text, pct) {
  document.getElementById("upload-status").style.display = "block";
  document.getElementById("upload-status-text").textContent = text;
  document.getElementById("upload-progress-fill").style.width = `${pct}%`;
}

function hideWorkerStatus() {
  document.getElementById("upload-status").style.display = "none";
}

// Convert parsed SST worker output to map layout format and save
async function importParsedWorkerLayout(result) {
  try {
    console.log("Parsed SST World Save layout:", result);

    if (!isAdmin) {
      showToast("Unlock admin mode (admin/admin) first to write parsed data to the map.", "warning");
      return;
    }

    if (!confirm(`SST Scan complete! Found World Seed: ${result.seed}. Do you want to load these custom terrain placements onto your galaxy map? This will overwrite the current layout.`)) {
      return;
    }

    // Wipe layout
    await dbWipe();

    // 1. Create a default Sector for the generated land
    const defaultSector = {
      id: "sector-scanned",
      name: `Galaxy Seed ${result.seed}`,
      index: 0,
      level: "Exploration",
      color: "#10b981",
      polygon: [
        [-5000, -5000],
        [15000, -5000],
        [15000, 10000],
        [-5000, 10000]
      ],
      centroid: { x: 5000, y: 2500 }
    };
    await dbSaveSector(defaultSector);

    // 2. Iterate and save systems
    // The parsed terrain placements have coordinates and slot offsets
    for (let i = 0; i < result.terrainPlacements.length; i++) {
      const tp = result.terrainPlacements[i];
      const newSys = {
        id: `sys-${tp.slot}`,
        name: `Sector Node ${tp.slot}`,
        gameId: `Terrain_${tp.slot}`,
        designation: `SEED-${result.seed}-${tp.slot}`,
        starType: "DefaultStar",
        starColor: "Yellow",
        index: i,
        sectorId: defaultSector.id,
        color: "#ffffff",
        x: tp.center.x,
        y: tp.center.y
      };

      await dbSaveSystem(newSys);

      // Create a default planet for this system
      const newPlanet = {
        id: `planet-scanned-${tp.slot}`,
        name: `Planet ${tp.slot}`,
        systemId: newSys.id,
        designation: `PLANET-SEED-${result.seed}-${tp.slot}`,
        resources: [],
        deposits: [],
        stations: []
      };
      await dbSavePlanet(newPlanet);
    }

    calculateBounds();
    renderMap();
    populateDropdowns();
    runSearch();
    recenterMap();

    showToast(`Successfully scanned & loaded ${result.terrainPlacements.length} systems from save folder!`, "success");
  } catch (e) {
    console.error(e);
    showToast("Error loading parsed layout: " + e.message, "error");
  }
}
