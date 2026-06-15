import { Component, signal, effect, HostListener, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { GalaxyService } from './services/galaxy.service';
import { Sector } from './models/galaxy.model';

import { MapComponent } from './components/map/map.component';
import { SearchTabComponent } from './components/search-tab/search-tab.component';
import { SectorsTabComponent } from './components/sectors-tab/sectors-tab.component';
import { RouteTabComponent } from './components/route-tab/route-tab.component';
import { AdminTabComponent } from './components/admin-tab/admin-tab.component';
import { SettingsTabComponent } from './components/settings-tab/settings-tab.component';
import { DetailPanelComponent } from './components/detail-panel/detail-panel.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    FormsModule,
    CommonModule,
    TranslatePipe,
    MapComponent,
    SearchTabComponent,
    SectorsTabComponent,
    RouteTabComponent,
    AdminTabComponent,
    SettingsTabComponent,
    DetailPanelComponent
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  // Navigation / Tabs
  activeTab = signal<string>('search-tab');

  // Admin login credentials
  isLoginModalOpen = signal<boolean>(false);
  loginUser = '';
  loginPass = '';
  loginErrorMsg = signal<string>('');

  // Map Navigation & Interaction State (shared with subcomponents)
  isPlaceMode = signal<boolean>(false);
  isSectorPinMode = signal<boolean>(false);
  isEditMode = signal<boolean>(false);
  tempSectorPoints = signal<[number, number][]>([]);

  // Map Controls State (Grid & Boundaries visibility)
  showGrid = signal<boolean>(true);
  showSectors = signal<boolean>(true);
  showLabels = signal<boolean>(true);
  planetColorMode = signal<string>('sector');
  starSize = signal<number>(10);

  // References to subcomponents
  @ViewChild(MapComponent) mapComponent!: MapComponent;
  @ViewChild(AdminTabComponent) adminTab?: AdminTabComponent;

  constructor(public galaxyService: GalaxyService, public translate: TranslateService) {
    this.translate.setFallbackLang('de');
    const savedLang = localStorage.getItem('spacecraft_lang') || 'de';
    this.translate.use(savedLang);

    // Sync temp sector points to admin tab coordinates input
    effect(() => {
      const pts = this.tempSectorPoints();
      if (this.adminTab) {
        this.adminTab.setSectorPolygon(pts.length > 0 ? JSON.stringify(pts) : '');
      }
    });
  }

  ngOnInit() {
    this.galaxyService.loadData().then(() => {
      // Recenter map after loading systems
      setTimeout(() => this.recenterMap(), 100);
    });
  }

  // --- TOP ACTION BUTTONS ---
  async logout() {
    await this.galaxyService.logout();

    // Switch back to search tab if admin settings were open
    if (this.activeTab() === 'admin-tab' || this.activeTab() === 'settings-tab') {
      this.activeTab.set('search-tab');
    }
  }

  setLang(lang: string) {
    this.translate.use(lang);
    localStorage.setItem('spacecraft_lang', lang);
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

    try {
      if (this.galaxyService.isDbConnected()) {
        this.galaxyService.showToast(this.translate.instant('toasts.connecting'), 'info');
      }

      const loginSuccess = await this.galaxyService.login(this.loginUser, this.loginPass);

      if (loginSuccess) {
        this.isLoginModalOpen.set(false);
        this.loginUser = '';
        this.loginPass = '';
        this.galaxyService.showToast(this.translate.instant('toasts.admin_unlocked'), 'success');

        // Switch to Creator/Admin tab automatically
        this.activeTab.set('admin-tab');
      }
    } catch (err: any) {
      console.error(err);
      this.loginErrorMsg.set(err.message || this.translate.instant('toasts.invalid_login'));
    }
  }

  // --- COORDINATE PIN MODES BANNER ACTIONS ---
  cancelModes() {
    this.isPlaceMode.set(false);
    this.isSectorPinMode.set(false);
    this.isEditMode.set(false);
    this.tempSectorPoints.set([]);
  }

  togglePlaceMode() {
    if (!this.galaxyService.isAdmin()) return;
    this.isPlaceMode.set(true);
    this.isSectorPinMode.set(false);
    this.isEditMode.set(false);
  }

  toggleSectorPinMode() {
    if (!this.galaxyService.isAdmin()) return;
    if (this.isSectorPinMode()) {
      this.isSectorPinMode.set(false);
      this.tempSectorPoints.set([]);
    } else {
      this.isSectorPinMode.set(true);
      this.isPlaceMode.set(false);
      this.isEditMode.set(false);
    }
  }

  toggleEditMode() {
    if (!this.galaxyService.isAdmin()) return;
    if (this.isEditMode()) {
      this.isEditMode.set(false);
    } else {
      this.isEditMode.set(true);
      this.isPlaceMode.set(false);
      this.isSectorPinMode.set(false);
    }
  }

  undoSectorPoint() {
    const pts = this.tempSectorPoints();
    if (pts.length > 0) {
      this.tempSectorPoints.set(pts.slice(0, -1));
    }
  }

  clearSectorPoints() {
    this.tempSectorPoints.set([]);
  }

  // --- MAP CALLBACK EVENTS ---
  onCoordinatesSelected(coords: { x: number; y: number }) {
    if (this.adminTab) {
      this.adminTab.setCoordinates(coords.x, coords.y);
    }
    this.isPlaceMode.set(false);
    this.galaxyService.showToast("Coordinates set! Complete the form to save.", "info");
  }

  onSystemSelected(sysId: string) {
    this.galaxyService.selectSystem(sysId);
  }

  onFlyToSector(sector: Sector) {
    if (this.mapComponent) {
      this.mapComponent.flyToCentroid(sector);
    }
  }

  recenterMap() {
    if (this.mapComponent) {
      this.mapComponent.recenterMap();
    }
  }

  setRouteStart(sysId: string) {
    this.galaxyService.routeStartSystemId.set(sysId);
    this.galaxyService.showToast(this.translate.instant('toasts.origin_set', { id: sysId }));
  }

  setRouteEnd(sysId: string) {
    this.galaxyService.routeEndSystemId.set(sysId);
    this.galaxyService.showToast(this.translate.instant('toasts.dest_set', { id: sysId }));
  }

  closeDetails() {
    this.galaxyService.selectedSystemId.set(null);
    this.galaxyService.selectedPlanetId.set(null);
    this.galaxyService.selectedStationId.set(null);
  }
}
