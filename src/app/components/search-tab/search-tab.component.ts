import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { GalaxyService } from '../../services/galaxy.service';
import { getStarColorClass, getStarBadgeBg, getStarBadgeColor, getStarBadgeBorder } from '../../utils/star.utils';
import { Planet, StarSystem } from '../../models/galaxy.model';

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

  getMatchingPlanets(sys: StarSystem): Planet[] {
    const query = this.galaxyService.searchQuery().toLowerCase().trim();
    const resFilter = this.galaxyService.resourceFilter();
    const allPlanets = this.galaxyService.planets();

    const sysPlanets = allPlanets.filter(p => p.systemId === sys.id);
    const resourceFiltered = resFilter
      ? sysPlanets.filter(p => p.resources && p.resources.includes(resFilter))
      : sysPlanets;

    if (!query) {
      return resFilter ? resourceFiltered : [];
    }

    const systemMatches = sys.name.toLowerCase().includes(query) ||
      (sys.designation && sys.designation.toLowerCase().includes(query));

    if (systemMatches) {
      return resourceFiltered;
    }

    return resourceFiltered.filter(p =>
      p.name.toLowerCase().includes(query) ||
      (p.designation && p.designation.toLowerCase().includes(query))
    );
  }

  selectPlanet(planetId: string, event: Event) {
    event.stopPropagation();
    const planet = this.galaxyService.planets().find(p => p.id === planetId);
    if (planet) {
      this.galaxyService.selectedSystemId.set(planet.systemId);
      this.galaxyService.selectedPlanetId.set(planetId);
    }
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
