import { Component, inject, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { GalaxyService } from '../../services/galaxy.service';
import { Sector } from '../../models/galaxy.model';

@Component({
  selector: 'app-detail-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './detail-panel.component.html',
  styles: []
})
export class DetailPanelComponent {
  public galaxyService = inject(GalaxyService);
  private translate = inject(TranslateService);

  // Sub-panel inputs
  newPlanetResourceVal = '';
  newPlanetDepositVal = '';
  newStationFacilityVal = 'Dock';
  newBaseName = '';
  newBaseOwner = '';
  newBaseImageUrl = '';

  // Lightbox modal state for enlarged image
  enlargedImageUrl = signal<string | null>(null);

  // Transient state for inline base production inputs to prevent loss during realtime updates
  baseProdItemInputs: Record<string, string> = {};
  baseProdAmountInputs: Record<string, number> = {};

  getBaseProdKey(planetId: string, baseIndex: number): string {
    return `${planetId}-${baseIndex}`;
  }

  // Outputs
  closePanel = output<void>();
  setRouteStart = output<string>();
  setRouteEnd = output<string>();

  onPlanetSelectChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    this.galaxyService.selectedPlanetId.set(select.value || null);
  }

  onStationSelectChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    this.galaxyService.selectedStationId.set(select.value || null);
  }

  async removePlanetResource(planetId: string, res: string) {
    await this.galaxyService.removePlanetResource(planetId, res);
  }

  async removePlanetDeposit(planetId: string, dep: string) {
    await this.galaxyService.removePlanetDeposit(planetId, dep);
  }

  async removeStationFacility(stationId: string, facilityType: string) {
    await this.galaxyService.removeStationFacility(stationId, facilityType);
  }

  async addPlanetBase(planetId: string, e: Event) {
    e.preventDefault();
    if (this.newBaseName.trim() && this.newBaseOwner.trim()) {
      await this.galaxyService.addPlanetBase(planetId, this.newBaseName, this.newBaseOwner, this.newBaseImageUrl);
      this.newBaseName = '';
      this.newBaseOwner = '';
      this.newBaseImageUrl = '';
    }
  }

  async updateBaseImageUrl(planetId: string, baseIndex: number, imageUrl: string) {
    await this.galaxyService.updateBaseImageUrl(planetId, baseIndex, imageUrl);
  }

  openLightbox(url: string) {
    this.enlargedImageUrl.set(url);
  }

  closeLightbox() {
    this.enlargedImageUrl.set(null);
  }

  async removePlanetBase(planetId: string, baseIndex: number) {
    await this.galaxyService.removePlanetBase(planetId, baseIndex);
  }

  async addBaseProduction(planetId: string, baseIndex: number, item: string, amount: number) {
    if (!item?.trim() || !amount) return;
    await this.galaxyService.addBaseProduction(planetId, baseIndex, item, amount);
    const key = this.getBaseProdKey(planetId, baseIndex);
    this.baseProdItemInputs[key] = '';
    this.baseProdAmountInputs[key] = null as any;
  }

  async removeBaseProduction(planetId: string, baseIndex: number, prodIndex: number) {
    await this.galaxyService.removeBaseProduction(planetId, baseIndex, prodIndex);
  }

  async addPlanetResource(planetId: string, e: Event) {
    e.preventDefault();
    if (this.newPlanetResourceVal) {
      await this.galaxyService.addPlanetResource(planetId, this.newPlanetResourceVal);
      this.newPlanetResourceVal = '';
    }
  }

  async addPlanetDeposit(planetId: string, e: Event) {
    e.preventDefault();
    if (this.newPlanetDepositVal) {
      await this.galaxyService.addPlanetDeposit(planetId, this.newPlanetDepositVal);
      this.newPlanetDepositVal = '';
    }
  }

  async addStationFacility(stationId: string, e: Event) {
    e.preventDefault();
    if (this.newStationFacilityVal) {
      await this.galaxyService.addStationFacility(stationId, this.newStationFacilityVal);
    }
  }

  async deletePlanet(planetId: string) {
    if (confirm(this.translate.instant('confirmations.delete_planet', { name: planetId }))) {
      await this.galaxyService.dbDeletePlanet(planetId);
    }
  }

  async deleteStation(stationId: string) {
    if (confirm(this.translate.instant('confirmations.delete_station', { name: stationId }))) {
      await this.galaxyService.dbDeleteStation(stationId);
    }
  }

  async deleteStarSystem(sysId: string) {
    if (confirm(this.translate.instant('confirmations.delete_system', { name: sysId }))) {
      await this.galaxyService.dbDeleteSystem(sysId);
    }
  }

  async updateSectorName(sector: Sector, event: Event) {
    const input = event.target as HTMLInputElement;
    const newName = input.value.trim();
    if (newName && newName !== sector.name) {
      const updated = { ...sector, name: newName };
      await this.galaxyService.dbSaveSector(updated);
    }
  }

  async updateSectorDesignation(sector: Sector, event: Event) {
    const input = event.target as HTMLInputElement;
    const newDesignation = input.value.trim();
    if (newDesignation !== sector.level) {
      const updated = { ...sector, level: newDesignation || undefined };
      await this.galaxyService.dbSaveSector(updated);
    }
  }

  async updateSectorColor(sector: Sector, event: Event) {
    const input = event.target as HTMLInputElement;
    const newColor = input.value;
    if (newColor && newColor !== sector.color) {
      const updated = { ...sector, color: newColor };
      await this.galaxyService.dbSaveSector(updated);
    }
  }

  async deleteSector(sectorId: string) {
    if (confirm(this.translate.instant('confirmations.delete_sector', { name: sectorId }))) {
      await this.galaxyService.dbDeleteSector(sectorId);
    }
  }
}
