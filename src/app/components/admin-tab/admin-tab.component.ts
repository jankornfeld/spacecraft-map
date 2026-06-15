import { Component, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { GalaxyService } from '../../services/galaxy.service';
import { Sector, StarSystem, Planet, SpaceStation, Connection } from '../../models/galaxy.model';

@Component({
  selector: 'app-admin-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './admin-tab.component.html',
  styles: []
})
export class AdminTabComponent {
  public galaxyService = inject(GalaxyService);
  private translate = inject(TranslateService);

  // Layout mode states (bind map actions)
  isPlaceMode = input<boolean>(false);
  isSectorPinMode = input<boolean>(false);
  tempSectorPointsLength = input<number>(0);

  // Coordinate mode toggle outputs
  togglePlaceMode = output<void>();
  toggleSectorPinMode = output<void>();
  undoSectorPoint = output<void>();
  clearSectorPoints = output<void>();
  recenterMap = output<void>();

  // --- Creator Form Fields ---
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

  // --- API / External setters called by parent ---
  setCoordinates(x: number, y: number) {
    this.systemFormX = x;
    this.systemFormY = y;
  }

  setSectorPolygon(polygonStr: string) {
    this.sectorPolygonInput = polygonStr;
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
      this.clearSectorPoints.emit();
    } catch (err: any) {
      this.galaxyService.showToast(this.translate.instant('toasts.sector_failed', { message: err.message }), "error");
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
      deposits: [],
      bases: []
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
      this.galaxyService.showToast(this.translate.instant('toasts.self_connection'), "warning");
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
    this.galaxyService.showToast(this.translate.instant('toasts.exported'), "success");
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

        this.recenterMap.emit();
        this.galaxyService.showToast(this.translate.instant('toasts.imported'), "success");
      } catch (err: any) {
        console.error(err);
        this.galaxyService.showToast(this.translate.instant('toasts.import_failed', { message: err.message }), "error");
      }
    };
    reader.readAsText(file);
  }

  wipeDb() {
    if (confirm(this.translate.instant('confirmations.wipe_db'))) {
      this.galaxyService.dbWipe();
    }
  }
}
