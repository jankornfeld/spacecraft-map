import { Component, inject, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { GalaxyService } from '../../services/galaxy.service';
import { Sector } from '../../models/galaxy.model';

@Component({
  selector: 'app-sectors-tab',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './sectors-tab.component.html',
  styles: []
})
export class SectorsTabComponent {
  public galaxyService = inject(GalaxyService);

  flyToSector = output<Sector>();

  flyToCentroid(sector: Sector) {
    this.flyToSector.emit(sector);
  }

  toggleSectorVisibility(sectorId: string, event: Event) {
    const checkbox = event.target as HTMLInputElement;
    this.galaxyService.toggleSectorVisibility(sectorId, checkbox.checked);
  }

  toggleAllSectors() {
    this.galaxyService.toggleAllSectors();
  }
}
