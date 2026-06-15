import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { GalaxyService } from '../../services/galaxy.service';

@Component({
  selector: 'app-route-tab',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './route-tab.component.html',
  styles: []
})
export class RouteTabComponent {
  public galaxyService = inject(GalaxyService);
  private translate = inject(TranslateService);

  onRouteStartChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    this.galaxyService.routeStartSystemId.set(select.value || null);
  }

  onRouteEndChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    this.galaxyService.routeEndSystemId.set(select.value || null);
  }

  clearRoute() {
    this.galaxyService.routeStartSystemId.set(null);
    this.galaxyService.routeEndSystemId.set(null);
    this.galaxyService.calculatedRoute.set(null);
    this.galaxyService.showToast(this.translate.instant('toasts.route_cleared'));
  }
}
