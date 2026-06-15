import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { GalaxyService } from '../../services/galaxy.service';
import { getStarColorClass, getStarBadgeBg, getStarBadgeColor, getStarBadgeBorder } from '../../utils/star.utils';

@Component({
  selector: 'app-search-tab',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './search-tab.component.html',
  styles: []
})
export class SearchTabComponent {
  public galaxyService = inject(GalaxyService);

  onSearchInput(e: Event) {
    const input = e.target as HTMLInputElement;
    this.galaxyService.searchQuery.set(input.value);
  }

  onResourceFilterChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    this.galaxyService.resourceFilter.set(select.value);
  }

  selectSystem(sysId: string) {
    this.galaxyService.selectSystem(sysId);
  }

  // Visual helper delegates
  getStarColorClass(color: string): string {
    return getStarColorClass(color);
  }

  getStarBadgeBg(color: string): string {
    return getStarBadgeBg(color);
  }

  getStarBadgeColor(color: string): string {
    return getStarBadgeColor(color);
  }

  getStarBadgeBorder(color: string): string {
    return getStarBadgeBorder(color);
  }
}
