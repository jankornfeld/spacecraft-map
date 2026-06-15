import { Component, signal, computed, HostListener, inject, input, output, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GalaxyService } from '../../services/galaxy.service';
import { Sector, StarSystem, Connection } from '../../models/galaxy.model';
import { getSystemNodeColor, getStarColorClass, getStarBadgeBg, getStarBadgeColor, getStarBadgeBorder } from '../../utils/star.utils';

@Component({
  selector: 'app-map',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './map.component.html',
  styleUrl: './map.component.css'
})
export class MapComponent {
  public galaxyService = inject(GalaxyService);

  // View Settings inputs (passed from parent or settings tab)
  showGrid = input<boolean>(true);
  showSectors = input<boolean>(true);
  showLabels = input<boolean>(true);
  planetColorMode = input<string>('sector');
  starSize = input<number>(10);

  // Coordinate capture modes
  isPlaceMode = input<boolean>(false);
  isSectorPinMode = input<boolean>(false);
  sectorColorInput = input<string>('#a855f7');
  tempSectorPoints = model<[number, number][]>([]);

  // Selection events
  systemSelected = output<string>();
  coordinatesSelected = output<{ x: number; y: number }>();

  // Internal viewport transform states
  scale = 1.0;
  translateX = 0;
  translateY = 0;
  isPanning = false;
  startX = 0;
  startY = 0;
  dragStartClientX = 0;
  dragStartClientY = 0;
  mapCursor = signal<string>('grab');

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

      this.tempSectorPoints.update(pts => [...pts, [parseFloat(mapX.toFixed(1)), parseFloat(mapY.toFixed(1))]]);
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

    this.coordinatesSelected.emit({
      x: parseFloat(mapX.toFixed(2)),
      y: parseFloat(mapY.toFixed(2))
    });
  }

  onNodeClick(sysId: string, event: MouseEvent) {
    event.stopPropagation();
    this.systemSelected.emit(sysId);
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

  isSectorVisible(sectorId: string): boolean {
    return !this.galaxyService.hiddenSectorIds().has(sectorId);
  }

  getSystemNodeColor(sys: StarSystem): string {
    return getSystemNodeColor(this.planetColorMode(), sys, this.galaxyService.sectors());
  }
}
