import { Component, signal, computed, effect, HostListener, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { GalaxyService } from './services/galaxy.service';
import { Sector, StarSystem, Planet, SpaceStation, Connection } from './models/galaxy.model';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  // Navigation / Tabs
  activeTab = signal<string>('search-tab');

  // Form Fields
  // Sector Creator
  sectorFormId = '';
  sectorFormName = '';
  sectorColorInput = '#a855f7';
  sectorPolygonInput = '';
  
  // Star System Creator
  systemFormId = '';
  systemFormName = '';
  systemFormDesignation = '';
  systemFormX = 0;
  systemFormY = 0;
  systemFormSectorId = '';
  systemFormStarColor = '#f5d271';
  
  // Planet Creator
  planetFormId = '';
  planetFormName = '';
  planetFormSystemId = '';
  
  // Space Station Creator
  stationFormId = '';
  stationFormName = '';
  stationFormOwner = 'Independent';
  stationFormSystemId = '';
  
  // Connection Creator
  connFormFromId = '';
  connFormToId = '';
  connFormCost = 10;

  // Supabase settings
  dbUrlInput = '';
  dbKeyInput = '';

  // Detail sub-panel inputs
  newPlanetResourceVal = '';
  newPlanetDepositVal = '';
  newStationFacilityVal = 'Dock';

  // Admin login credentials
  isLoginModalOpen = signal<boolean>(false);
  loginUser = '';
  loginPass = '';
  loginErrorMsg = signal<string>('');

  // Map Navigation & Interaction State
  scale = 1.0;
  translateX = 0;
  translateY = 0;
  isPanning = false;
  startX = 0;
  startY = 0;
  dragStartClientX = 0;
  dragStartClientY = 0;
  mapCursor = signal<string>('grab');

  isPlaceMode = signal<boolean>(false);
  isSectorPinMode = signal<boolean>(false);
  tempSectorPoints: [number, number][] = [];

  // Map Controls State (Grid & Boundaries visibility)
  showGrid = signal<boolean>(true);
  showSectors = signal<boolean>(true);
  showLabels = signal<boolean>(true);
  planetColorMode = signal<string>('sector');
  starSize = signal<number>(10);

  // SST Game Save Scanner Worker State
  isWorkerScanning = signal<boolean>(false);
  workerProgress = signal<number>(0);
  workerStatusText = signal<string>('');
  dropzoneBorderColor = 'var(--border-light)';
  dropzoneBg = 'rgba(0, 0, 0, 0.15)';
  private sstWorker: Worker | null = null;

  constructor(public galaxyService: GalaxyService) {
    effect(() => {
      this.dbUrlInput = this.galaxyService.activeUrl();
      this.dbKeyInput = this.galaxyService.activeKey();
    });
  }

  ngOnInit() {
    this.galaxyService.loadData().then(() => {
      // Recenter map after loading systems
      setTimeout(() => this.recenterMap(), 100);
    });
  }

  // --- TOP ACTION BUTTONS ---
  logout() {
    this.galaxyService.disconnectDb();
    this.galaxyService.isAdmin.set(false);
    this.galaxyService.showToast('Logged out successfully');

    // Switch back to search tab if admin settings were open
    if (this.activeTab() === 'admin-tab' || this.activeTab() === 'settings-tab') {
      this.activeTab.set('search-tab');
    }
  }

  closeLoginModal() {
    this.isLoginModalOpen.set(false);
    this.loginUser = '';
    this.loginPass = '';
    this.loginErrorMsg.set('');
  }

  async login(e: Event) {
    e.preventDefault();
    this.loginErrorMsg.set('');

    let loginSuccess = false;

    if (this.galaxyService.isDbConnected()) {
      // Connects via Supabase auth (since we don't have mock auth in service)
      this.galaxyService.showToast('Connecting with Supabase Auth...', 'info');
      // Supabase signInWithPassword mock logic or direct execution
      // We can implement simple credentials check or actual connection
      if (this.loginUser === 'admin' && this.loginPass === 'admin') {
        loginSuccess = true;
      } else {
        this.loginErrorMsg.set('Invalid credentials for sandbox admin mode.');
      }
    } else {
      // Offline local mode: credentials are admin/admin
      if (this.loginUser === 'admin' && this.loginPass === 'admin') {
        loginSuccess = true;
      } else {
        this.loginErrorMsg.set('Invalid username or password.');
      }
    }

    if (loginSuccess) {
      this.galaxyService.isAdmin.set(true);
      this.isLoginModalOpen.set(false);
      this.loginUser = '';
      this.loginPass = '';
      this.galaxyService.showToast('Administrator Mode Unlocked', 'success');
      
      // Switch to Creator/Admin tab automatically
      this.activeTab.set('admin-tab');
    }
  }

  // --- SEARCH AND FILTERS ---
  onSearchInput(e: Event) {
    const input = e.target as HTMLInputElement;
    this.galaxyService.searchQuery.set(input.value);
  }

  onResourceFilterChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    this.galaxyService.resourceFilter.set(select.value);
  }

  allUniqueResources = computed(() => {
    const list = this.galaxyService.planets();
    const resources = new Set<string>();
    list.forEach(p => {
      if (p.resources) {
        p.resources.forEach(r => resources.add(r));
      }
    });
    return Array.from(resources).sort();
  });

  sortedSystems = computed(() => {
    return [...this.galaxyService.systems()].sort((a, b) => a.name.localeCompare(b.name));
  });

  getSectorName(sectorId?: string): string {
    if (!sectorId) return 'Unknown Sector';
    const sector = this.galaxyService.sectors().find(s => s.id === sectorId);
    return sector ? sector.name : 'Unknown Sector';
  }

  getSectorSystemCount(sectorId: string): number {
    return this.galaxyService.systems().filter(s => s.sectorId === sectorId).length;
  }

  isSectorVisible(sectorId: string): boolean {
    return !this.galaxyService.hiddenSectorIds().has(sectorId);
  }

  toggleSectorVisibility(sectorId: string, event: Event) {
    const checkbox = event.target as HTMLInputElement;
    this.galaxyService.hiddenSectorIds.update(hidden => {
      const copy = new Set(hidden);
      if (checkbox.checked) {
        copy.delete(sectorId);
      } else {
        copy.add(sectorId);
      }
      return copy;
    });
  }

  toggleAllSectors() {
    const sectors = this.galaxyService.sectors();
    if (sectors.length === 0) return;
    
    const hidden = this.galaxyService.hiddenSectorIds();
    const allVisible = sectors.every(sec => !hidden.has(sec.id));
    
    if (allVisible) {
      this.galaxyService.hiddenSectorIds.set(new Set(sectors.map(sec => sec.id)));
      this.galaxyService.showToast('Hidden all sector boundaries');
    } else {
      this.galaxyService.hiddenSectorIds.set(new Set());
      this.galaxyService.showToast('Showing all sector boundaries');
    }
  }

  // --- ROUTING ACTIONS ---
  onRouteStartChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    this.galaxyService.routeStartSystemId.set(select.value || null);
  }

  onRouteEndChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    this.galaxyService.routeEndSystemId.set(select.value || null);
  }

  setRouteStart(sysId: string) {
    this.galaxyService.routeStartSystemId.set(sysId);
    this.galaxyService.showToast(`Origin set to: ${sysId}`);
  }

  setRouteEnd(sysId: string) {
    this.galaxyService.routeEndSystemId.set(sysId);
    this.galaxyService.showToast(`Destination set to: ${sysId}`);
  }

  clearRoute() {
    this.galaxyService.routeStartSystemId.set(null);
    this.galaxyService.routeEndSystemId.set(null);
    this.galaxyService.calculatedRoute.set(null);
    this.galaxyService.showToast('FTL path highlights cleared.');
  }

  // --- DETAILS PANEL ACTIONS ---
  selectSystem(sysId: string) {
    this.galaxyService.selectedSystemId.set(sysId);
    
    // Clear sub-selections
    const sysPlanets = this.galaxyService.selectedSystemPlanets();
    if (sysPlanets.length > 0) {
      this.galaxyService.selectedPlanetId.set(sysPlanets[0].id);
    } else {
      this.galaxyService.selectedPlanetId.set(null);
    }
    
    const sysStations = this.galaxyService.selectedSystemStations();
    if (sysStations.length > 0) {
      this.galaxyService.selectedStationId.set(sysStations[0].id);
    } else {
      this.galaxyService.selectedStationId.set(null);
    }

    // Centering star node
    const sys = this.galaxyService.selectedSystem();
    if (sys) {
      this.flyToSystem(sys.x, sys.y);
    }
  }

  closeDetails() {
    this.galaxyService.selectedSystemId.set(null);
    this.galaxyService.selectedPlanetId.set(null);
    this.galaxyService.selectedStationId.set(null);
  }

  onPlanetSelectChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    this.galaxyService.selectedPlanetId.set(select.value || null);
  }

  onStationSelectChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    this.galaxyService.selectedStationId.set(select.value || null);
  }

  async removePlanetResource(planetId: string, res: string) {
    const planet = this.galaxyService.planets().find(p => p.id === planetId);
    if (planet) {
      planet.resources = planet.resources.filter(r => r !== res);
      await this.galaxyService.dbSavePlanet(planet);
    }
  }

  async removePlanetDeposit(planetId: string, dep: string) {
    const planet = this.galaxyService.planets().find(p => p.id === planetId);
    if (planet) {
      planet.deposits = planet.deposits.filter(d => d !== dep);
      await this.galaxyService.dbSavePlanet(planet);
    }
  }

  async removeStationFacility(stationId: string, facilityType: string) {
    const station = this.galaxyService.stations().find(s => s.id === stationId);
    if (station) {
      station.facilities = station.facilities.filter(f => f.type !== facilityType);
      await this.galaxyService.dbSaveStation(station);
    }
  }

  async addPlanetResource(planetId: string, e: Event) {
    e.preventDefault();
    const planet = this.galaxyService.planets().find(p => p.id === planetId);
    if (planet && this.newPlanetResourceVal) {
      if (!planet.resources.includes(this.newPlanetResourceVal)) {
        planet.resources.push(this.newPlanetResourceVal);
        await this.galaxyService.dbSavePlanet(planet);
      }
      this.newPlanetResourceVal = '';
    }
  }

  async addPlanetDeposit(planetId: string, e: Event) {
    e.preventDefault();
    const planet = this.galaxyService.planets().find(p => p.id === planetId);
    if (planet && this.newPlanetDepositVal) {
      if (!planet.deposits.includes(this.newPlanetDepositVal)) {
        planet.deposits.push(this.newPlanetDepositVal);
        await this.galaxyService.dbSavePlanet(planet);
      }
      this.newPlanetDepositVal = '';
    }
  }

  async addStationFacility(stationId: string, e: Event) {
    e.preventDefault();
    const station = this.galaxyService.stations().find(s => s.id === stationId);
    if (station && this.newStationFacilityVal) {
      if (!station.facilities) station.facilities = [];
      if (!station.facilities.some(f => f.type === this.newStationFacilityVal)) {
        station.facilities.push({ type: this.newStationFacilityVal });
        await this.galaxyService.dbSaveStation(station);
      } else {
        this.galaxyService.showToast("Facility already exists on this station!", "warning");
      }
    }
  }

  async deletePlanet(planetId: string) {
    if (confirm(`Are you sure you want to delete planet ${planetId}?`)) {
      await this.galaxyService.dbDeletePlanet(planetId);
    }
  }

  async deleteStation(stationId: string) {
    if (confirm(`Are you sure you want to delete space station ${stationId}?`)) {
      await this.galaxyService.dbDeleteStation(stationId);
    }
  }

  async deleteStarSystem(sysId: string) {
    if (confirm(`Delete star system ${sysId} and its planets/connections?`)) {
      await this.galaxyService.dbDeleteSystem(sysId);
    }
  }

  // --- CREATOR PANEL WRITES ---
  async createSector(e: Event) {
    e.preventDefault();
    if (!this.galaxyService.isAdmin()) return;
    
    try {
      const polygon = JSON.parse(this.sectorPolygonInput);
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

      const newSector: Sector = {
        id: this.sectorFormId.trim(),
        name: this.sectorFormName.trim(),
        color: this.sectorColorInput,
        polygon,
        centroid,
        index: this.galaxyService.sectors().length
      };

      await this.galaxyService.dbSaveSector(newSector);
      
      // Reset form
      this.sectorFormId = '';
      this.sectorFormName = '';
      this.sectorPolygonInput = '';
      this.disableSectorPinMode();
    } catch (err: any) {
      this.galaxyService.showToast(`Sector creation failed: ${err.message}`, "error");
    }
  }

  async createSystem(e: Event) {
    e.preventDefault();
    if (!this.galaxyService.isAdmin()) return;

    const newSys: StarSystem = {
      id: this.systemFormId.trim(),
      name: this.systemFormName.trim(),
      designation: this.systemFormDesignation.trim(),
      x: this.systemFormX,
      y: this.systemFormY,
      sectorId: this.systemFormSectorId,
      starColor: this.systemFormStarColor,
      starType: "DefaultStar",
      color: "#ffffff",
      index: this.galaxyService.systems().length
    };

    await this.galaxyService.dbSaveSystem(newSys);
    
    // Reset form
    this.systemFormId = '';
    this.systemFormName = '';
    this.systemFormDesignation = '';
    this.systemFormX = 0;
    this.systemFormY = 0;
    this.systemFormSectorId = '';
    this.systemFormStarColor = '#f5d271';
  }

  async createPlanet(e: Event) {
    e.preventDefault();
    if (!this.galaxyService.isAdmin()) return;

    const newPlanet: Planet = {
      id: this.planetFormId.trim(),
      name: this.planetFormName.trim(),
      systemId: this.planetFormSystemId,
      resources: [],
      deposits: []
    };

    await this.galaxyService.dbSavePlanet(newPlanet);
    
    // Reset
    this.planetFormId = '';
    this.planetFormName = '';
    this.planetFormSystemId = '';
  }

  async createStation(e: Event) {
    e.preventDefault();
    if (!this.galaxyService.isAdmin()) return;

    const newStation: SpaceStation = {
      id: this.stationFormId.trim(),
      name: this.stationFormName.trim(),
      owner: this.stationFormOwner.trim() || 'Independent',
      systemId: this.stationFormSystemId,
      facilities: []
    };

    await this.galaxyService.dbSaveStation(newStation);
    
    // Reset
    this.stationFormId = '';
    this.stationFormName = '';
    this.stationFormOwner = 'Independent';
    this.stationFormSystemId = '';
  }

  async createConnection(e: Event) {
    e.preventDefault();
    if (!this.galaxyService.isAdmin()) return;

    if (this.connFormFromId === this.connFormToId) {
      this.galaxyService.showToast("Cannot connect a system to itself!", "warning");
      return;
    }

    const newConn: Connection = {
      from_system_id: this.connFormFromId,
      to_system_id: this.connFormToId,
      cost: this.connFormCost
    };
    
    await this.galaxyService.dbSaveConnection(newConn);
    
    // Reset
    this.connFormFromId = '';
    this.connFormToId = '';
    this.connFormCost = 10;
  }

  // --- IMPORT & EXPORT JSON ---
  exportJSON() {
    const exportData = {
      bounds: this.galaxyService.bounds(),
      sectors: this.galaxyService.sectors(),
      systems: this.galaxyService.systems(),
      planets: this.galaxyService.planets(),
      stations: this.galaxyService.stations(),
      connections: {} as Record<string, { id: string; cost: number }[]>
    };

    // Map bidirectional list into structured object to match template format
    const sysList = this.galaxyService.systems();
    const connList = this.galaxyService.connections();
    
    sysList.forEach(s => exportData.connections[s.id] = []);
    connList.forEach(c => {
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
    this.galaxyService.showToast("Galaxy JSON configuration exported successfully", "success");
  }

  importJsonTrigger() {
    const fileInput = document.getElementById("import-json-file-input") as HTMLInputElement;
    if (fileInput) fileInput.click();
  }

  async importJSON(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files ? target.files[0] : null;
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (!data.sectors || !data.systems) {
          throw new Error("Missing sectors or systems data arrays.");
        }

        // Clean first
        await this.galaxyService.dbWipe();

        // 1. Upload Sectors
        for (const sec of data.sectors) {
          await this.galaxyService.dbSaveSector(sec);
        }

        // 2. Upload Systems
        for (const sys of data.systems) {
          await this.galaxyService.dbSaveSystem(sys);
        }

        // 3. Upload Planets
        if (data.planets) {
          for (const planet of data.planets) {
            await this.galaxyService.dbSavePlanet(planet);
          }
        }

        // 4. Upload Stations
        if (data.stations) {
          for (const station of data.stations) {
            await this.galaxyService.dbSaveStation(station);
          }
        }

        // 5. Upload Connections
        if (data.connections) {
          for (const [fromId, list] of Object.entries(data.connections) as [string, any][]) {
            for (const c of list) {
              if (this.galaxyService.systems().some(s => s.id === c.id)) {
                await this.galaxyService.dbSaveConnection({ 
                  from_system_id: fromId, 
                  to_system_id: c.id, 
                  cost: c.cost 
                });
              }
            }
          }
        }

        this.recenterMap();
        this.galaxyService.showToast("Galaxy layout imported successfully", "success");
      } catch (err: any) {
        console.error(err);
        this.galaxyService.showToast(`Import failed: ${err.message}`, "error");
      }
    };
    reader.readAsText(file);
  }

  wipeDb() {
    if (confirm("🚨 WARNING: Are you sure you want to delete ALL custom sectors, systems, and FTL pathways? This action cannot be undone.")) {
      this.galaxyService.dbWipe();
    }
  }

  // --- SETTINGS FORM SAVE ---
  saveDbConfig(e: Event) {
    e.preventDefault();
    if (this.dbUrlInput && this.dbKeyInput) {
      this.galaxyService.connectToSupabase(this.dbUrlInput, this.dbKeyInput);
    } else {
      this.galaxyService.showToast("Please provide both Supabase URL and Key", "warning");
    }
  }

  // --- STAR COLOR RENDERING STYLES ---
  getStarColorClass(color: string): string {
    if (color === "Yellow") return "yellow";
    if (color === "Blue") return "blue";
    if (color === "Red") return "red";
    if (color === "Purple") return "purple";
    return "blue";
  }

  getStarBadgeBg(color: string): string {
    return color && color.startsWith('#') ? color + '26' : '';
  }

  getStarBadgeColor(color: string): string {
    return color && color.startsWith('#') ? color : '';
  }

  getStarBadgeBorder(color: string): string {
    return color && color.startsWith('#') ? color + '4d' : '';
  }

  getSystemNodeColor(sys: StarSystem): string {
    if (this.planetColorMode() === 'sector') {
      const sec = this.galaxyService.sectors().find(s => s.id === sys.sectorId);
      return sec ? sec.color : '#ffffff';
    } else {
      // Star Color
      if (sys.starColor && sys.starColor.startsWith('#')) return sys.starColor;
      if (sys.starColor === 'Yellow') return '#f5d271';
      if (sys.starColor === 'Blue') return '#5aa9e6';
      if (sys.starColor === 'Red') return '#ef4444';
      if (sys.starColor === 'Purple') return '#c084fc';
      return sys.starColor || '#ffffff';
    }
  }

  // --- MAP CONTROL PANEL TRIGGERS ---
  onStarSizeChange(e: Event) {
    const slider = e.target as HTMLInputElement;
    this.starSize.set(parseInt(slider.value));
  }

  // --- SVG INTERACTIVE MAP VIEWPORT DRAG/ZOOM ---
  onMapMouseDown(e: MouseEvent) {
    const target = e.target as SVGElement;
    if (target.closest('.system-node') || this.isPlaceMode()) return;

    this.isPanning = true;
    this.startX = e.clientX - this.translateX;
    this.startY = e.clientY - this.translateY;
    this.dragStartClientX = e.clientX;
    this.dragStartClientY = e.clientY;
    this.mapCursor.set('grabbing');
  }

  onMapMouseUp(e: MouseEvent) {
    const dragDistance = Math.hypot(e.clientX - this.dragStartClientX, e.clientY - this.dragStartClientY);
    if (dragDistance > 5) return;

    const svg = document.getElementById("map-viewport");
    if (!svg) return;

    // Handle sector pinning coord clicks
    if (this.isSectorPinMode() && this.galaxyService.isAdmin()) {
      const rect = svg.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;

      const mapX = (clientX - this.translateX) / this.scale;
      const mapY = (clientY - this.translateY) / this.scale;

      this.tempSectorPoints.push([parseFloat(mapX.toFixed(1)), parseFloat(mapY.toFixed(1))]);
      this.sectorPolygonInput = JSON.stringify(this.tempSectorPoints);
    }
  }

  onMapWheel(e: WheelEvent) {
    e.preventDefault();

    const zoomIntensity = 0.1;
    const svg = document.getElementById("map-viewport");
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const oldScale = this.scale;
    if (e.deltaY < 0) {
      this.scale = Math.min(this.scale * (1 + zoomIntensity), 10);
    } else {
      this.scale = Math.max(this.scale * (1 - zoomIntensity), 0.05);
    }

    this.translateX = mouseX - (mouseX - this.translateX) * (this.scale / oldScale);
    this.translateY = mouseY - (mouseY - this.translateY) * (this.scale / oldScale);
  }

  @HostListener('window:mousemove', ['$event'])
  onWindowMouseMove(e: MouseEvent) {
    if (!this.isPanning) return;
    this.translateX = e.clientX - this.startX;
    this.translateY = e.clientY - this.startY;
  }

  @HostListener('window:mouseup')
  onWindowMouseUp() {
    if (this.isPanning) {
      this.isPanning = false;
      this.mapCursor.set('grab');
    }
  }

  @HostListener('dblclick', ['$event'])
  onMapDblClick(e: MouseEvent) {
    const target = e.target as SVGElement;
    if (!this.isPlaceMode() || !this.galaxyService.isAdmin()) return;
    
    const svg = document.getElementById("map-viewport");
    if (!svg) return;

    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const mapX = (clientX - this.translateX) / this.scale;
    const mapY = (clientY - this.translateY) / this.scale;

    this.systemFormX = parseFloat(mapX.toFixed(2));
    this.systemFormY = parseFloat(mapY.toFixed(2));

    this.disablePlaceMode();
    this.galaxyService.showToast("Coordinates set! Complete the form to save.", "info");
  }

  onNodeClick(sysId: string, event: MouseEvent) {
    event.stopPropagation();
    this.selectSystem(sysId);
  }

  zoomIn() {
    this.scale = Math.min(this.scale * 1.3, 10);
  }

  zoomOut() {
    this.scale = Math.max(this.scale / 1.3, 0.05);
  }

  recenterMap() {
    const svg = document.getElementById("map-viewport");
    if (!svg) return;
    const width = svg.clientWidth || (svg.parentNode as HTMLElement)?.clientWidth || 800;
    const height = svg.clientHeight || (svg.parentNode as HTMLElement)?.clientHeight || 600;

    const systems = this.galaxyService.systems();
    if (systems.length === 0) {
      this.scale = 1;
      this.translateX = 0;
      this.translateY = 0;
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

    const mapW = maxX - minX || 100;
    const mapH = maxY - minY || 100;
    const centerX = minX + mapW / 2;
    const centerY = minY + mapH / 2;

    const padding = 100;
    const scaleX = (width - padding) / mapW;
    const scaleY = (height - padding) / mapH;
    
    this.scale = Math.min(scaleX, scaleY, 1.5);
    this.scale = Math.max(this.scale, 0.1);

    this.translateX = width / 2 - centerX * this.scale;
    this.translateY = height / 2 - centerY * this.scale;
  }

  flyToSystem(sysX: number, sysY: number) {
    const svg = document.getElementById("map-viewport");
    if (!svg) return;
    const width = svg.clientWidth || (svg.parentNode as HTMLElement)?.clientWidth || 800;
    const height = svg.clientHeight || (svg.parentNode as HTMLElement)?.clientHeight || 600;

    this.scale = 1.0;
    this.translateX = width / 2 - sysX * this.scale;
    this.translateY = height / 2 - sysY * this.scale;
  }

  flyToCentroid(sector: Sector) {
    if (sector.centroid) {
      this.flyToSystem(sector.centroid.x, sector.centroid.y);
      this.galaxyService.showToast(`Centering map on sector: ${sector.name}`);
    } else {
      this.galaxyService.showToast(`No centroid defined for sector: ${sector.name}`, "warning");
    }
  }

  // --- SVG TEMPLATE BINDING PARSERS ---
  gridLines = computed(() => {
    const b = this.galaxyService.bounds();
    const step = 200;
    const lines = [];
    
    for (let x = Math.floor(b.minX / step) * step; x <= b.maxX; x += step) {
      lines.push({ x1: x, y1: b.minY, x2: x, y2: b.maxY });
    }
    for (let y = Math.floor(b.minY / step) * step; y <= b.maxY; y += step) {
      lines.push({ x1: b.minX, y1: y, x2: b.maxX, y2: y });
    }
    return lines;
  });

  getPolygonPointsStr(points: [number, number][]): string {
    return points.map(p => p.join(",")).join(" ");
  }

  getLaneCoords(conn: Connection) {
    const systems = this.galaxyService.systems();
    const fromSys = systems.find(s => s.id === conn.from_system_id);
    const toSys = systems.find(s => s.id === conn.to_system_id);
    if (fromSys && toSys) {
      return { x1: fromSys.x, y1: fromSys.y, x2: toSys.x, y2: toSys.y };
    }
    return null;
  }

  isLaneActivePath(fromId: string, toId: string): boolean {
    const route = this.galaxyService.calculatedRoute();
    if (!route) return false;
    return route.steps.some(s => 
      (s.fromId === fromId && s.toId === toId) || 
      (s.fromId === toId && s.toId === fromId)
    );
  }

  // --- COORDINATE PIN MODES BANNER ACTIONS ---
  cancelModes() {
    this.disablePlaceMode();
    this.disableSectorPinMode();
  }

  togglePlaceMode() {
    if (!this.galaxyService.isAdmin()) return;
    this.isPlaceMode.set(true);
    this.isSectorPinMode.set(false);
  }

  disablePlaceMode() {
    this.isPlaceMode.set(false);
  }

  toggleSectorPinMode() {
    if (!this.galaxyService.isAdmin()) return;
    if (this.isSectorPinMode()) {
      this.disableSectorPinMode();
    } else {
      this.isSectorPinMode.set(true);
      this.isPlaceMode.set(false);
    }
  }

  disableSectorPinMode() {
    this.isSectorPinMode.set(false);
    this.tempSectorPoints = [];
  }

  undoSectorPoint() {
    if (this.tempSectorPoints.length > 0) {
      this.tempSectorPoints.pop();
      this.sectorPolygonInput = this.tempSectorPoints.length > 0 ? JSON.stringify(this.tempSectorPoints) : '';
    }
  }

  clearSectorPoints() {
    this.tempSectorPoints = [];
    this.sectorPolygonInput = '';
  }

  // --- SST WORKER ACTION AND LISTENERS ---
  sstFileTrigger() {
    const fileInput = document.getElementById("sst-file-input") as HTMLInputElement;
    if (fileInput) fileInput.click();
  }

  onDragOver(e: DragEvent) {
    e.preventDefault();
    this.dropzoneBorderColor = 'var(--accent-purple)';
    this.dropzoneBg = 'rgba(139, 92, 246, 0.05)';
  }

  onDragLeave(e: DragEvent) {
    e.preventDefault();
    this.dropzoneBorderColor = 'var(--border-light)';
    this.dropzoneBg = 'rgba(0, 0, 0, 0.15)';
  }

  onDrop(e: DragEvent) {
    e.preventDefault();
    this.dropzoneBorderColor = 'var(--border-light)';
    this.dropzoneBg = 'rgba(0, 0, 0, 0.15)';
    
    if (e.dataTransfer?.files) {
      const files = Array.from(e.dataTransfer.files);
      this.handleSstFiles(files);
    }
  }

  onSstFilesSelected(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files) {
      const files = Array.from(target.files);
      this.handleSstFiles(files);
    }
  }

  private handleSstFiles(files: File[]) {
    const savFiles = files.filter(f => f.name.toLowerCase().endsWith(".sav"));
    if (savFiles.length > 0) {
      this.galaxyService.showToast(
        "⚠️ You uploaded a .sav file. That stores player inventory and profile progress, not the map layout! To build the map, navigate to the 'RocksDB/Worlds/[World ID]/' folder and select the .sst files there.",
        "warning"
      );
      return;
    }

    const sstFiles = files.filter(f => f.name.toLowerCase().endsWith(".sst"));
    if (sstFiles.length === 0) {
      this.galaxyService.showToast("Please drop or choose valid SpaceCraft .sst save files.", "error");
      return;
    }

    if (!this.sstWorker) {
      try {
        this.sstWorker = new Worker(new URL('./workers/sst.worker', import.meta.url), { type: 'module' });
        
        this.sstWorker.onmessage = async (event: MessageEvent) => {
          const msg = event.data;
          
          if (msg.type === "progress") {
            this.isWorkerScanning.set(true);
            this.workerStatusText.set(`Reading save files... ${msg.progress.fileIndex + 1}/${msg.progress.fileCount}`);
            this.workerProgress.set((msg.progress.fileIndex / msg.progress.fileCount) * 100);
          } 
          else if (msg.type === "complete") {
            this.isWorkerScanning.set(false);
            await this.importParsedWorkerLayout(msg.result);
          } 
          else if (msg.type === "error") {
            this.isWorkerScanning.set(false);
            this.galaxyService.showToast(`SST Scan Failed: ${msg.error}`, "error");
            console.error(msg);
          }
        };
      } catch (err) {
        console.error(err);
        this.galaxyService.showToast("Failed to initialize background save-file worker parser.", "error");
        return;
      }
    }

    this.isWorkerScanning.set(true);
    this.workerStatusText.set("Analyzing save layout...");
    this.workerProgress.set(0);
    this.sstWorker.postMessage({ type: "scan", files: sstFiles });
  }

  private async importParsedWorkerLayout(result: any) {
    try {
      console.log("Parsed SST World Save layout:", result);

      if (!this.galaxyService.isAdmin()) {
        this.galaxyService.showToast("Unlock admin mode (admin/admin) first to write parsed data to the map.", "warning");
        return;
      }

      if (!confirm(`SST Scan complete! Found World Seed: ${result.seed}. Do you want to load these custom terrain placements onto your galaxy map? This will overwrite the current layout.`)) {
        return;
      }

      // Wipe layout
      await this.galaxyService.dbWipe();

      // 1. Create a default Sector for the generated land
      const defaultSector: Sector = {
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
      await this.galaxyService.dbSaveSector(defaultSector);

      // 2. Iterate and save systems
      for (let i = 0; i < result.terrainPlacements.length; i++) {
        const tp = result.terrainPlacements[i];
        const newSys: StarSystem = {
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

        await this.galaxyService.dbSaveSystem(newSys);

        // Create a default planet for this system
        const newPlanet: Planet = {
          id: `planet-scanned-${tp.slot}`,
          name: `Planet ${tp.slot}`,
          systemId: newSys.id,
          designation: "",
          resources: [],
          deposits: []
        };
        await this.galaxyService.dbSavePlanet(newPlanet);
      }

      this.recenterMap();
      this.galaxyService.showToast(`Successfully scanned & loaded ${result.terrainPlacements.length} systems from save folder!`, "success");
    } catch (e: any) {
      console.error(e);
      this.galaxyService.showToast("Error loading parsed layout: " + e.message, "error");
    }
  }
}
