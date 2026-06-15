import { Component, inject, model, output, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { GalaxyService } from '../../services/galaxy.service';
import { Sector, StarSystem, Planet } from '../../models/galaxy.model';

@Component({
  selector: 'app-settings-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './settings-tab.component.html',
  styles: []
})
export class SettingsTabComponent {
  public galaxyService = inject(GalaxyService);
  private translate = inject(TranslateService);

  // Map Controls State (Grid & Boundaries visibility)
  showGrid = model<boolean>(true);
  showSectors = model<boolean>(true);
  showLabels = model<boolean>(true);
  planetColorMode = model<string>('sector');
  starSize = model<number>(10);

  // DB Config Fields
  dbUrlInput = '';
  dbKeyInput = '';

  // SST Game Save Scanner Worker State
  isWorkerScanning = model<boolean>(false);
  workerProgress = model<number>(0);
  workerStatusText = model<string>('');
  dropzoneBorderColor = 'var(--border-light)';
  dropzoneBg = 'rgba(0, 0, 0, 0.15)';
  private sstWorker: Worker | null = null;

  recenterMap = output<void>();

  constructor() {
    // Automatically keep inputs up to date with active service credentials
    effect(() => {
      this.dbUrlInput = this.galaxyService.activeUrl();
      this.dbKeyInput = this.galaxyService.activeKey();
    });
  }

  saveDbConfig(e: Event) {
    e.preventDefault();
    if (this.dbUrlInput && this.dbKeyInput) {
      this.galaxyService.connectToSupabase(this.dbUrlInput, this.dbKeyInput);
    } else {
      this.galaxyService.showToast(this.translate.instant('toasts.provide_db_details'), "warning");
    }
  }

  onStarSizeChange(e: Event) {
    const slider = e.target as HTMLInputElement;
    this.starSize.set(parseInt(slider.value));
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
        this.sstWorker = new Worker(new URL('../../workers/sst.worker', import.meta.url), { type: 'module' });

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
          deposits: [],
          bases: []
        };
        await this.galaxyService.dbSavePlanet(newPlanet);
      }

      this.recenterMap.emit();
      this.galaxyService.showToast(`Successfully scanned & loaded ${result.terrainPlacements.length} systems from save folder!`, "success");
    } catch (e: any) {
      console.error(e);
      this.galaxyService.showToast("Error loading parsed layout: " + e.message, "error");
    }
  }
}
