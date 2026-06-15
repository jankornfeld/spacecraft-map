import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { TranslateService } from '@ngx-translate/core';
import { Sector, StarSystem, Planet, SpaceStation, Connection, CalculatedRoute, CalculatedRouteStep, PlanetBase } from '../models/galaxy.model';

@Injectable({
  providedIn: 'root'
})
export class GalaxyService {
  // Constants
  readonly ALL_RESOURCES = [
    "copperstone", "purebrass", "ironstone", "pureiron", "sandstonehill", "siderit", "grayquarz", "coallump", "graphit",
    "chalkopyrit", "chalkosin", "chalcedonycrust", "sulfurstone", "pureelmerium", "whitefeldsparhill", "watergysir"
  ];

  readonly ALL_DEPOSITS = [
    "copper", "iron", "sandstone", "aluminum"
  ];

  readonly ALL_SPACESTATION_MODULES = [
    "shipyard", "miningbureau", "laboratory", "marketplace"
  ];

  // Supabase Client
  private supabaseClient: SupabaseClient | null = null;

  // Default Fallback Database Credentials
  readonly DEFAULT_SUPABASE_URL = 'https://gkdobhkefyhhgwokncib.supabase.co';
  readonly DEFAULT_SUPABASE_KEY = 'sb_publishable_gVzF3Pt1I0CLSnrqB99Ebg_INqarOC-';

  // Active credentials signals
  activeUrl = signal<string>('');
  activeKey = signal<string>('');

  // Database status
  isDbConnected = signal<boolean>(false);
  isAdmin = signal<boolean>(false);
  connectionStatusText = signal<string>('connection_status.no_db');
  connectionStatusClass = signal<string>('badge badge-yellow');

  private translate = inject(TranslateService);

  // Core Datasets
  sectors = signal<Sector[]>([]);
  systems = signal<StarSystem[]>([]);
  planets = signal<Planet[]>([]);
  stations = signal<SpaceStation[]>([]);
  connections = signal<Connection[]>([]);
  bounds = signal<{ minX: number; minY: number; maxX: number; maxY: number }>({
    minX: 0, minY: 0, maxX: 2000, maxY: 2000
  });

  // UI Selection State
  selectedSystemId = signal<string | null>(null);
  selectedPlanetId = signal<string | null>(null);
  selectedStationId = signal<string | null>(null);

  // Search and Filters
  searchQuery = signal<string>('');
  resourceFilter = signal<string>('');

  // Sector display
  hiddenSectorIds = signal<Set<string>>(new Set());

  // Routing Planner
  routeStartSystemId = signal<string | null>(null);
  routeEndSystemId = signal<string | null>(null);
  calculatedRoute = signal<CalculatedRoute | null>(null);

  // Toast Notifications
  toasts = signal<{ id: number; message: string; type: string }[]>([]);
  private toastIdCounter = 0;

  constructor() {
    this.initDb();

    // Automatically recalculate map boundaries when systems change
    effect(() => {
      this.calculateBounds();
    }, { allowSignalWrites: true });
  }

  // --- TOAST NOTIFICATIONS ---
  showToast(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
    const id = ++this.toastIdCounter;
    this.toasts.update(t => [...t, { id, message, type }]);

    setTimeout(() => {
      this.removeToast(id);
    }, 4000);
  }

  removeToast(id: number) {
    this.toasts.update(t => t.filter(toast => toast.id !== id));
  }

  // --- DATABASE SETUP ---
  private initDb() {
    const cachedUrl = this.safeGetItem('spacecraft_supabase_url');
    const cachedKey = this.safeGetItem('spacecraft_supabase_key');

    if (cachedUrl && cachedKey) {
      this.connectToSupabase(cachedUrl, cachedKey);
    } else if (cachedUrl === null && cachedKey === null) {
      // Fallback to defaults if never configured
      this.connectToSupabase(this.DEFAULT_SUPABASE_URL, this.DEFAULT_SUPABASE_KEY);
    } else {
      // Explicitly disconnected or empty config
      this.isDbConnected.set(false);
      this.supabaseClient = null;
      this.activeUrl.set('');
      this.activeKey.set('');
      this.connectionStatusText.set('connection_status.offline');
      this.connectionStatusClass.set('badge badge-blue');
    }
  }

  connectToSupabase(url: string, key: string) {
    if (url && key) {
      try {
        this.supabaseClient = createClient(url, key);
        this.isDbConnected.set(true);
        this.connectionStatusText.set('connection_status.connected');
        this.connectionStatusClass.set('badge badge-emerald');
        this.activeUrl.set(url);
        this.activeKey.set(key);

        this.safeSetItem('spacecraft_supabase_url', url);
        this.safeSetItem('spacecraft_supabase_key', key);
        this.showToast(this.translate.instant('toasts.db_connected'), 'success');
        this.loadData();
      } catch (e) {
        console.error('Supabase config failed', e);
        this.isDbConnected.set(false);
        this.supabaseClient = null;
        this.activeUrl.set('');
        this.activeKey.set('');
        this.connectionStatusText.set('connection_status.error');
        this.connectionStatusClass.set('badge badge-red');
        this.showToast(this.translate.instant('toasts.db_failed'), 'error');
      }
    } else {
      this.disconnectDb();
    }
  }

  disconnectDb() {
    this.safeSetItem('spacecraft_supabase_url', '');
    this.safeSetItem('spacecraft_supabase_key', '');
    this.activeUrl.set('');
    this.activeKey.set('');
    this.isDbConnected.set(false);
    this.supabaseClient = null;
    this.isAdmin.set(false);
    this.connectionStatusText.set('connection_status.offline');
    this.connectionStatusClass.set('badge badge-blue');
    this.showToast(this.translate.instant('toasts.db_disconnected'));
    this.loadData();
  }

  async login(email: string, password: string): Promise<boolean> {
    if (this.isDbConnected() && this.supabaseClient) {
      const { error } = await this.supabaseClient.auth.signInWithPassword({
        email: email,
        password: password
      });
      if (error) {
        throw error;
      }
      this.isAdmin.set(true);
      return true;
    } else {
      if (email === 'admin' && password === 'admin') {
        this.isAdmin.set(true);
        return true;
      } else {
        throw new Error('Invalid username or password.');
      }
    }
  }

  async logout() {
    if (this.isDbConnected() && this.supabaseClient) {
      try {
        await this.supabaseClient.auth.signOut();
      } catch (err) {
        console.error('Supabase Auth error during signOut', err);
      }
    }
    this.isAdmin.set(false);
    this.showToast(this.translate.instant('toasts.logged_out'));
  }

  // --- CRUD DATA LOADING ---
  async loadData() {
    if (this.isDbConnected() && this.supabaseClient) {
      try {
        // 1. Load Sectors
        const { data: sectorData, error: sErr } = await this.supabaseClient.from('sectors').select('*');
        if (sErr) throw sErr;
        const loadedSectors = (sectorData || []).map((s: any) => ({
          id: s.id,
          name: s.name,
          index: s.index,
          level: s.level,
          color: s.color,
          polygon: typeof s.polygon === 'string' ? JSON.parse(s.polygon) : s.polygon,
          centroid: typeof s.centroid === 'string' ? JSON.parse(s.centroid) : s.centroid
        }));
        this.sectors.set(loadedSectors);

        // 2. Load Systems
        const { data: systemData, error: sysErr } = await this.supabaseClient.from('systems').select('*');
        if (sysErr) throw sysErr;
        const loadedSystems = (systemData || []).map((sys: any) => ({
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
        this.systems.set(loadedSystems);

        // 3. Load Planets
        const { data: planetData, error: pErr } = await this.supabaseClient.from('planets').select('*');
        if (pErr) throw pErr;
        const loadedPlanets = this.migratePlanets(planetData || []);
        this.planets.set(loadedPlanets);

        // 4. Load Stations
        const { data: stationData, error: stErr } = await this.supabaseClient.from('stations').select('*');
        if (stErr) throw stErr;
        const loadedStations = (stationData || []).map((st: any) => ({
          id: st.id,
          name: st.name,
          systemId: st.system_id,
          owner: st.owner || 'Independent',
          facilities: typeof st.facilities === 'string' ? JSON.parse(st.facilities) : (st.facilities || [])
        }));
        this.stations.set(loadedStations);

        // 5. Load Connections
        const { data: connData, error: cErr } = await this.supabaseClient.from('connections').select('*');
        if (cErr) throw cErr;
        const loadedConnections = (connData || []).map((c: any) => ({
          from_system_id: c.from_system_id,
          to_system_id: c.to_system_id,
          cost: c.cost
        }));
        this.connections.set(loadedConnections);

      } catch (e) {
        console.error('Error fetching from Supabase', e);
        this.showToast(this.translate.instant('toasts.db_fallback'), 'warning');
        this.loadDataFromLocalStorage();
      }
    } else {
      this.loadDataFromLocalStorage();
    }
  }

  private loadDataFromLocalStorage() {
    const localSectors = this.safeGetItem('spacecraft_sectors');
    const localSystems = this.safeGetItem('spacecraft_systems');
    const localConns = this.safeGetItem('spacecraft_connections');
    const localPlanets = this.safeGetItem('spacecraft_planets');
    const localStations = this.safeGetItem('spacecraft_stations');

    if (localSectors && localSystems && localConns) {
      this.sectors.set(JSON.parse(localSectors));
      this.systems.set(JSON.parse(localSystems));
      this.connections.set(JSON.parse(localConns));
      this.planets.set(this.migratePlanets(localPlanets ? JSON.parse(localPlanets) : []));
      this.stations.set(localStations ? JSON.parse(localStations) : []);
    } else {
      this.sectors.set([]);
      this.systems.set([]);
      this.connections.set([]);
      this.planets.set([]);
      this.stations.set([]);
    }
  }

  saveLocalBackup() {
    if (!this.isDbConnected()) {
      this.safeSetItem('spacecraft_sectors', JSON.stringify(this.sectors()));
      this.safeSetItem('spacecraft_systems', JSON.stringify(this.systems()));
      this.safeSetItem('spacecraft_connections', JSON.stringify(this.connections()));
      this.safeSetItem('spacecraft_planets', JSON.stringify(this.planets()));
      this.safeSetItem('spacecraft_stations', JSON.stringify(this.stations()));
    }
  }

  private calculateBounds() {
    const sysList = this.systems();
    if (sysList.length === 0) {
      this.bounds.set({ minX: 0, minY: 0, maxX: 2000, maxY: 2000 });
      return;
    }

    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    sysList.forEach(s => {
      if (s.x < minX) minX = s.x;
      if (s.x > maxX) maxX = s.x;
      if (s.y < minY) minY = s.y;
      if (s.y > maxY) maxY = s.y;
    });

    this.bounds.set({
      minX: minX - 400,
      minY: minY - 400,
      maxX: maxX + 400,
      maxY: maxY + 400
    });
  }

  updateSystemCoords(sysId: string, x: number, y: number) {
    this.systems.update(current => {
      return current.map(s => {
        if (s.id === sysId) {
          return { ...s, x, y };
        }
        return s;
      });
    });
  }

  updateSectorVertex(sectorId: string, vertexIndex: number, x: number, y: number) {
    this.sectors.update(current => {
      return current.map(s => {
        if (s.id === sectorId) {
          const newPolygon = [...s.polygon];
          newPolygon[vertexIndex] = [x, y];

          let sumX = 0, sumY = 0;
          newPolygon.forEach(p => {
            sumX += p[0];
            sumY += p[1];
          });
          const centroid = {
            x: sumX / newPolygon.length,
            y: sumY / newPolygon.length
          };
          return { ...s, polygon: newPolygon, centroid };
        }
        return s;
      });
    });
  }

  insertSectorVertex(sectorId: string, insertIndex: number, x: number, y: number) {
    this.sectors.update(current => {
      return current.map(s => {
        if (s.id === sectorId) {
          const newPolygon = [...s.polygon];
          newPolygon.splice(insertIndex, 0, [x, y]);

          let sumX = 0, sumY = 0;
          newPolygon.forEach(p => {
            sumX += p[0];
            sumY += p[1];
          });
          const centroid = {
            x: sumX / newPolygon.length,
            y: sumY / newPolygon.length
          };
          return { ...s, polygon: newPolygon, centroid };
        }
        return s;
      });
    });
  }

  removeSectorVertex(sectorId: string, vertexIndex: number) {
    this.sectors.update(current => {
      return current.map(s => {
        if (s.id === sectorId) {
          if (s.polygon.length <= 3) {
            this.showToast(this.translate.instant('toasts.min_polygon_points'), 'warning');
            return s;
          }
          const newPolygon = [...s.polygon];
          newPolygon.splice(vertexIndex, 1);

          let sumX = 0, sumY = 0;
          newPolygon.forEach(p => {
            sumX += p[0];
            sumY += p[1];
          });
          const centroid = {
            x: sumX / newPolygon.length,
            y: sumY / newPolygon.length
          };
          return { ...s, polygon: newPolygon, centroid };
        }
        return s;
      });
    });
  }

  // --- CRUD WRITES ---
  async dbSaveSector(sector: Sector) {
    this.sectors.update(current => {
      const idx = current.findIndex(s => s.id === sector.id);
      if (idx !== -1) {
        const copy = [...current];
        copy[idx] = sector;
        return copy;
      }
      return [...current, sector];
    });

    this.saveLocalBackup();

    if (this.isDbConnected() && this.supabaseClient) {
      const { error } = await this.supabaseClient.from('sectors').upsert({
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
        this.showToast(this.translate.instant('toasts.db_failed'), 'error');
      } else {
        this.showToast(this.translate.instant('toasts.sector_synced', { name: sector.name }), 'success');
      }
    } else {
      this.showToast(this.translate.instant('toasts.sector_local', { name: sector.name }), 'success');
    }
  }

  async dbSaveSystem(sys: StarSystem) {
    this.systems.update(current => {
      const idx = current.findIndex(s => s.id === sys.id);
      if (idx !== -1) {
        const copy = [...current];
        copy[idx] = sys;
        return copy;
      }
      return [...current, sys];
    });

    this.saveLocalBackup();

    if (this.isDbConnected() && this.supabaseClient) {
      const { error } = await this.supabaseClient.from('systems').upsert({
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
        this.showToast(this.translate.instant('toasts.db_failed'), 'error');
      } else {
        this.showToast(this.translate.instant('toasts.system_synced', { name: sys.name }), 'success');
      }
    } else {
      this.showToast(this.translate.instant('toasts.system_local', { name: sys.name }), 'success');
    }
  }

  async dbSavePlanet(planet: Planet) {
    this.planets.update(current => {
      const idx = current.findIndex(p => p.id === planet.id);
      if (idx !== -1) {
        const copy = [...current];
        copy[idx] = planet;
        return copy;
      }
      return [...current, planet];
    });

    this.saveLocalBackup();

    if (this.isDbConnected() && this.supabaseClient) {
      const { error } = await this.supabaseClient.from('planets').upsert({
        id: planet.id,
        name: planet.name,
        system_id: planet.systemId,
        designation: planet.designation,
        resources: planet.resources,
        deposits: planet.deposits,
        bases: JSON.stringify(planet.bases || [])
      });
      if (error) {
        console.error(error);
        this.showToast(this.translate.instant('toasts.db_failed'), 'error');
      } else {
        this.showToast(this.translate.instant('toasts.planet_synced', { name: planet.name }), 'success');
      }
    } else {
      this.showToast(this.translate.instant('toasts.planet_local', { name: planet.name }), 'success');
    }
  }

  async dbSaveStation(station: SpaceStation) {
    this.stations.update(current => {
      const idx = current.findIndex(s => s.id === station.id);
      if (idx !== -1) {
        const copy = [...current];
        copy[idx] = station;
        return copy;
      }
      return [...current, station];
    });

    this.saveLocalBackup();

    if (this.isDbConnected() && this.supabaseClient) {
      const { error } = await this.supabaseClient.from('stations').upsert({
        id: station.id,
        name: station.name,
        system_id: station.systemId,
        owner: station.owner,
        facilities: JSON.stringify(station.facilities)
      });
      if (error) {
        console.error(error);
        this.showToast(this.translate.instant('toasts.db_failed'), 'error');
      } else {
        this.showToast(this.translate.instant('toasts.station_synced', { name: station.name }), 'success');
      }
    } else {
      this.showToast(this.translate.instant('toasts.station_local', { name: station.name }), 'success');
    }
  }

  async dbSaveConnection(conn: Connection) {
    // Check duplicates
    const exists = this.connections().some(c =>
      (c.from_system_id === conn.from_system_id && c.to_system_id === conn.to_system_id) ||
      (c.from_system_id === conn.to_system_id && c.to_system_id === conn.from_system_id)
    );

    if (exists) {
      this.showToast(this.translate.instant('toasts.connection_exists'), 'warning');
      return;
    }

    this.connections.update(current => [...current, conn]);
    this.saveLocalBackup();

    if (this.isDbConnected() && this.supabaseClient) {
      const { error } = await this.supabaseClient.from('connections').insert({
        from_system_id: conn.from_system_id,
        to_system_id: conn.to_system_id,
        cost: conn.cost
      });
      if (error) {
        console.error(error);
        this.showToast(this.translate.instant('toasts.db_failed'), 'error');
      } else {
        this.showToast(this.translate.instant('toasts.connection_synced'), 'success');
      }
    } else {
      this.showToast(this.translate.instant('toasts.connection_local'), 'success');
    }
  }

  // --- CRUD DELETES ---
  async dbDeleteSystem(sysId: string) {
    this.systems.update(current => current.filter(s => s.id !== sysId));
    this.connections.update(current => current.filter(c => c.from_system_id !== sysId && c.to_system_id !== sysId));
    this.planets.update(current => current.filter(p => p.systemId !== sysId));
    this.stations.update(current => current.filter(s => s.systemId !== sysId));

    this.saveLocalBackup();

    if (this.isDbConnected() && this.supabaseClient) {
      const { error } = await this.supabaseClient.from('systems').delete().eq('id', sysId);
      if (error) {
        console.error(error);
        this.showToast(this.translate.instant('toasts.db_failed'), 'error');
      } else {
        this.showToast(this.translate.instant('toasts.system_deleted_db'), 'success');
      }
    } else {
      this.showToast(this.translate.instant('toasts.system_deleted_local'), 'success');
    }

    if (this.selectedSystemId() === sysId) {
      this.selectedSystemId.set(null);
      this.selectedPlanetId.set(null);
      this.selectedStationId.set(null);
    }
  }

  async dbDeletePlanet(planetId: string) {
    this.planets.update(current => current.filter(p => p.id !== planetId));
    this.saveLocalBackup();

    if (this.isDbConnected() && this.supabaseClient) {
      const { error } = await this.supabaseClient.from('planets').delete().eq('id', planetId);
      if (error) {
        console.error(error);
        this.showToast(this.translate.instant('toasts.db_failed'), 'error');
      } else {
        this.showToast(this.translate.instant('toasts.planet_deleted_db'), 'success');
      }
    } else {
      this.showToast(this.translate.instant('toasts.planet_deleted_local'), 'success');
    }

    if (this.selectedPlanetId() === planetId) {
      this.selectedPlanetId.set(null);
    }
  }

  async dbDeleteStation(stationId: string) {
    this.stations.update(current => current.filter(s => s.id !== stationId));
    this.saveLocalBackup();

    if (this.isDbConnected() && this.supabaseClient) {
      const { error } = await this.supabaseClient.from('stations').delete().eq('id', stationId);
      if (error) {
        console.error(error);
        this.showToast(this.translate.instant('toasts.db_failed'), 'error');
      } else {
        this.showToast(this.translate.instant('toasts.station_deleted_db'), 'success');
      }
    } else {
      this.showToast(this.translate.instant('toasts.station_deleted_local'), 'success');
    }

    if (this.selectedStationId() === stationId) {
      this.selectedStationId.set(null);
    }
  }

  async dbWipe() {
    this.sectors.set([]);
    this.systems.set([]);
    this.planets.set([]);
    this.stations.set([]);
    this.connections.set([]);

    this.selectedSystemId.set(null);
    this.selectedPlanetId.set(null);
    this.selectedStationId.set(null);
    this.routeStartSystemId.set(null);
    this.routeEndSystemId.set(null);
    this.calculatedRoute.set(null);

    this.saveLocalBackup();

    if (this.isDbConnected() && this.supabaseClient) {
      try {
        await this.supabaseClient.from('connections').delete().neq('id', 0);
        await this.supabaseClient.from('planets').delete().neq('id', '');
        await this.supabaseClient.from('stations').delete().neq('id', '');
        await this.supabaseClient.from('systems').delete().neq('id', '');
        await this.supabaseClient.from('sectors').delete().neq('id', '');
        this.showToast(this.translate.instant('toasts.db_cleaned'), 'success');
      } catch (e) {
        console.error(e);
        this.showToast(this.translate.instant('toasts.db_failed'), 'error');
      }
    } else {
      this.showToast(this.translate.instant('toasts.db_wiped_local'), 'success');
    }
  }

  // --- COMPUTED / SELECTIVE DATA ---

  // Computed systems filtered by search query and resource filter
  filteredSystems = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    const resFilter = this.resourceFilter();
    const allSystems = this.systems();
    const allPlanets = this.planets();

    return allSystems.filter(sys => {
      const nameMatch = sys.name.toLowerCase().includes(query) ||
        (sys.designation && sys.designation.toLowerCase().includes(query));

      const sysPlanets = allPlanets.filter(p => p.systemId === sys.id);
      const resourceMatch = !resFilter || sysPlanets.some(p => p.resources && p.resources.includes(resFilter));

      return nameMatch && resourceMatch;
    });
  });

  // Get active selected system entity
  selectedSystem = computed(() => {
    const activeId = this.selectedSystemId();
    if (!activeId) return null;
    return this.systems().find(s => s.id === activeId) || null;
  });

  // Get planets belonging to selected system
  selectedSystemPlanets = computed(() => {
    const activeId = this.selectedSystemId();
    if (!activeId) return [];
    return this.planets().filter(p => p.systemId === activeId);
  });

  // Get stations belonging to selected system
  selectedSystemStations = computed(() => {
    const activeId = this.selectedSystemId();
    if (!activeId) return [];
    return this.stations().filter(s => s.systemId === activeId);
  });

  // Get active selected planet entity
  selectedPlanet = computed(() => {
    const activePlanetId = this.selectedPlanetId();
    if (!activePlanetId) return null;
    return this.planets().find(p => p.id === activePlanetId) || null;
  });

  // Get active selected station entity
  selectedStation = computed(() => {
    const activeStationId = this.selectedStationId();
    if (!activeStationId) return null;
    return this.stations().find(s => s.id === activeStationId) || null;
  });

  allUniqueResources = computed(() => {
    const list = this.planets();
    const resources = new Set<string>();
    list.forEach(p => {
      if (p.resources) {
        p.resources.forEach(r => resources.add(r));
      }
    });
    return Array.from(resources).sort();
  });

  sortedSystems = computed(() => {
    return [...this.systems()].sort((a, b) => a.name.localeCompare(b.name));
  });

  selectSystem(sysId: string) {
    this.selectedSystemId.set(sysId);

    // Clear sub-selections
    const sysPlanets = this.selectedSystemPlanets();
    if (sysPlanets.length > 0) {
      this.selectedPlanetId.set(sysPlanets[0].id);
    } else {
      this.selectedPlanetId.set(null);
    }

    const sysStations = this.selectedSystemStations();
    if (sysStations.length > 0) {
      this.selectedStationId.set(sysStations[0].id);
    } else {
      this.selectedStationId.set(null);
    }
  }

  async removePlanetResource(planetId: string, res: string) {
    const planet = this.planets().find(p => p.id === planetId);
    if (planet) {
      planet.resources = planet.resources.filter(r => r !== res);
      await this.dbSavePlanet(planet);
    }
  }

  async removePlanetDeposit(planetId: string, dep: string) {
    const planet = this.planets().find(p => p.id === planetId);
    if (planet) {
      planet.deposits = planet.deposits.filter(d => d !== dep);
      await this.dbSavePlanet(planet);
    }
  }

  async removeStationFacility(stationId: string, facilityType: string) {
    const station = this.stations().find(s => s.id === stationId);
    if (station) {
      station.facilities = station.facilities.filter(f => f.type !== facilityType);
      await this.dbSaveStation(station);
    }
  }

  async addPlanetBase(planetId: string, name: string, owner: string) {
    const planet = this.planets().find(p => p.id === planetId);
    if (planet && name.trim() && owner.trim()) {
      if (!planet.bases) {
        planet.bases = [];
      }
      const newBase: PlanetBase = {
        name: name.trim(),
        owner: owner.trim(),
        productions: []
      };
      planet.bases.push(newBase);
      await this.dbSavePlanet(planet);
    }
  }

  async removePlanetBase(planetId: string, baseIndex: number) {
    const planet = this.planets().find(p => p.id === planetId);
    if (planet && planet.bases) {
      planet.bases.splice(baseIndex, 1);
      await this.dbSavePlanet(planet);
    }
  }

  async addBaseProduction(planetId: string, baseIndex: number, item: string, amount: number) {
    if (!item.trim() || !amount) return;
    const planet = this.planets().find(p => p.id === planetId);
    if (planet && planet.bases && planet.bases[baseIndex]) {
      const base = planet.bases[baseIndex];
      if (!base.productions) {
        base.productions = [];
      }
      base.productions.push({
        item: item.trim(),
        amountPerMinute: amount
      });
      await this.dbSavePlanet(planet);
    }
  }

  async removeBaseProduction(planetId: string, baseIndex: number, prodIndex: number) {
    const planet = this.planets().find(p => p.id === planetId);
    if (planet && planet.bases && planet.bases[baseIndex] && planet.bases[baseIndex].productions) {
      planet.bases[baseIndex].productions.splice(prodIndex, 1);
      await this.dbSavePlanet(planet);
    }
  }

  async addPlanetResource(planetId: string, resourceVal: string) {
    const planet = this.planets().find(p => p.id === planetId);
    if (planet && resourceVal) {
      if (!planet.resources.includes(resourceVal)) {
        planet.resources.push(resourceVal);
        await this.dbSavePlanet(planet);
      }
    }
  }

  async addPlanetDeposit(planetId: string, depositVal: string) {
    const planet = this.planets().find(p => p.id === planetId);
    if (planet && depositVal) {
      if (!planet.deposits.includes(depositVal)) {
        planet.deposits.push(depositVal);
        await this.dbSavePlanet(planet);
      }
    }
  }

  async addStationFacility(stationId: string, facilityVal: string) {
    const station = this.stations().find(s => s.id === stationId);
    if (station && facilityVal) {
      if (!station.facilities) station.facilities = [];
      if (!station.facilities.some(f => f.type === facilityVal)) {
        station.facilities.push({ type: facilityVal });
        await this.dbSaveStation(station);
      } else {
        this.showToast(this.translate.instant('toasts.facility_exists'), "warning");
      }
    }
  }

  getSectorName(sectorId?: string): string {
    if (!sectorId) return 'Unknown Sector';
    const sector = this.sectors().find(s => s.id === sectorId);
    return sector ? sector.name : 'Unknown Sector';
  }

  getSectorSystemCount(sectorId: string): number {
    return this.systems().filter(s => s.sectorId === sectorId).length;
  }

  isSectorVisible(sectorId: string): boolean {
    return !this.hiddenSectorIds().has(sectorId);
  }

  toggleSectorVisibility(sectorId: string, visible: boolean) {
    this.hiddenSectorIds.update(hidden => {
      const copy = new Set(hidden);
      if (visible) {
        copy.delete(sectorId);
      } else {
        copy.add(sectorId);
      }
      return copy;
    });
  }

  toggleAllSectors() {
    const sectors = this.sectors();
    if (sectors.length === 0) return;

    const hidden = this.hiddenSectorIds();
    const allVisible = sectors.every(sec => !hidden.has(sec.id));

    if (allVisible) {
      this.hiddenSectorIds.set(new Set(sectors.map(sec => sec.id)));
      this.showToast(this.translate.instant('toasts.hidden_sectors'));
    } else {
      this.hiddenSectorIds.set(new Set());
      this.showToast(this.translate.instant('toasts.showing_sectors'));
    }
  }

  // --- DIJKSTRA SHORTPATH ROUTING ---
  calculateRoutePath() {
    const startId = this.routeStartSystemId();
    const endId = this.routeEndSystemId();

    if (!startId || !endId) {
      this.calculatedRoute.set(null);
      return;
    }

    if (startId === endId) {
      this.showToast(this.translate.instant('toasts.same_systems'), 'warning');
      this.calculatedRoute.set(null);
      return;
    }

    const allSystems = this.systems();
    const allConns = this.connections();

    // 1. Build adjacency list graph (bidirectional)
    const graph: Record<string, { id: string; cost: number }[]> = {};
    allSystems.forEach(s => graph[s.id] = []);

    allConns.forEach(conn => {
      if (graph[conn.from_system_id] && graph[conn.to_system_id]) {
        graph[conn.from_system_id].push({ id: conn.to_system_id, cost: conn.cost });
        graph[conn.to_system_id].push({ id: conn.from_system_id, cost: conn.cost });
      }
    });

    // 2. Run Dijkstra Algorithm
    const distances: Record<string, number> = {};
    const previous: Record<string, string | null> = {};
    const queue = new Set<string>();

    allSystems.forEach(s => {
      distances[s.id] = Infinity;
      previous[s.id] = null;
      queue.add(s.id);
    });

    distances[startId] = 0;

    while (queue.size > 0) {
      // Find node with minimum distance in the queue
      let minDistance = Infinity;
      let minNode: string | null = null;

      queue.forEach(nodeId => {
        if (distances[nodeId] < minDistance) {
          minDistance = distances[nodeId];
          minNode = nodeId;
        }
      });

      if (minNode === null || distances[minNode] === Infinity) {
        break; // Destination unreachable
      }

      if (minNode === endId) {
        break; // Found shortest path
      }

      queue.delete(minNode);

      // Visit neighbors
      const neighbors = graph[minNode] || [];
      neighbors.forEach(neighbor => {
        if (!queue.has(neighbor.id)) return;

        const alt = distances[minNode!] + neighbor.cost;
        if (alt < distances[neighbor.id]) {
          distances[neighbor.id] = alt;
          previous[neighbor.id] = minNode;
        }
      });
    }

    // 3. Reconstruct shortest path
    const path: string[] = [];
    let current: string | null = endId;
    while (current !== null) {
      path.push(current);
      current = previous[current];
    }
    path.reverse();

    if (path.length <= 1 || path[0] !== startId) {
      this.showToast(this.translate.instant('toasts.no_route'), 'error');
      this.calculatedRoute.set(null);
      return;
    }

    // 4. Build return structure
    const totalCost = distances[endId];
    const steps: CalculatedRouteStep[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      const fromSys = allSystems.find(s => s.id === from);
      const toSys = allSystems.find(s => s.id === to);
      if (fromSys && toSys) {
        steps.push({
          fromId: from,
          toId: to,
          fromName: fromSys.name,
          toName: toSys.name
        });
      }
    }

    this.calculatedRoute.set({
      jumps: path.length - 1,
      cost: totalCost,
      steps: steps
    });

    this.showToast(this.translate.instant('toasts.route_calculated'), 'success');
  }

  // --- LOCAL STORAGE HELPERS ---
  private safeGetItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  private safeSetItem(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {}
  }

  private safeRemoveItem(key: string) {
    try {
      localStorage.removeItem(key);
    } catch (e) {}
  }

  private migratePlanets(planetList: any[]): Planet[] {
    return (planetList || []).map((p: any) => {
      let bases = typeof p.bases === 'string' ? JSON.parse(p.bases) : (p.bases || []);
      bases = bases.map((base: any) => {
        if (base.produced && !base.productions) {
          base.productions = [{
            item: base.produced,
            amountPerMinute: base.amountPerMinute || 0
          }];
          delete base.produced;
          delete base.amountPerMinute;
        }
        if (!base.productions) {
          base.productions = [];
        }
        return base;
      });
      return {
        id: p.id,
        name: p.name,
        systemId: p.system_id || p.systemId,
        designation: p.designation,
        resources: p.resources || [],
        deposits: p.deposits || [],
        bases: bases
      };
    });
  }
}
