import { Component, signal, computed, HostListener, inject, input, output, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { GalaxyService } from '../../services/galaxy.service';
import { Sector, StarSystem, Connection } from '../../models/galaxy.model';
import { getSystemNodeColor, getStarColorClass, getStarBadgeBg, getStarBadgeColor, getStarBadgeBorder } from '../../utils/star.utils';

@Component({
  selector: 'app-map',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
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
  isEditMode = input<boolean>(false);
  sectorColorInput = input<string>('#a855f7');
  tempSectorPoints = model<[number, number][]>([]);

  // Dragging states
  activeDraggedSystemId: string | null = null;
  activeDraggedSectorId: string | null = null;
  activeDraggedSectorVertexIndex: number = -1;
  dragOffset = { x: 0, y: 0 };

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

  // Hovered connection states
  hoveredConnection = signal<Connection | null>(null);
  hoveredConnectionMousePos = signal<{ x: number; y: number }>({ x: 0, y: 0 });

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

  onSystemMouseDown(e: MouseEvent, sys: StarSystem) {
    if (!this.isEditMode() || !this.galaxyService.isAdmin()) return;

    e.stopPropagation();
    e.preventDefault();

    this.activeDraggedSystemId = sys.id;
    this.galaxyService.activelyDraggedSystemId.set(sys.id);

    const svg = document.getElementById("map-viewport");
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left - this.translateX) / this.scale;
    const mouseY = (e.clientY - rect.top - this.translateY) / this.scale;

    this.dragOffset = {
      x: sys.x - mouseX,
      y: sys.y - mouseY
    };
  }

  onSectorHandleMouseDown(e: MouseEvent, sec: Sector, vertexIndex: number) {
    if (!this.isEditMode() || !this.galaxyService.isAdmin()) return;

    e.stopPropagation();
    e.preventDefault();

    this.activeDraggedSectorId = sec.id;
    this.galaxyService.activelyDraggedSectorId.set(sec.id);
    this.activeDraggedSectorVertexIndex = vertexIndex;
  }

  onMidpointHandleMouseDown(e: MouseEvent, sec: Sector, insertIndex: number, midpoint: [number, number]) {
    if (!this.isEditMode() || !this.galaxyService.isAdmin()) return;

    e.stopPropagation();
    e.preventDefault();

    // Insert the midpoint vertex into the polygon
    this.galaxyService.insertSectorVertex(sec.id, insertIndex, midpoint[0], midpoint[1]);

    // Set dragging state for the newly created vertex
    this.activeDraggedSectorId = sec.id;
    this.galaxyService.activelyDraggedSectorId.set(sec.id);
    this.activeDraggedSectorVertexIndex = insertIndex;
  }

  onSectorHandleRightClick(e: MouseEvent, sec: Sector, vertexIndex: number) {
    if (!this.isEditMode() || !this.galaxyService.isAdmin()) return;

    e.stopPropagation();
    e.preventDefault();

    this.galaxyService.removeSectorVertex(sec.id, vertexIndex);

    // Save updated sector
    const updatedSec = this.galaxyService.sectors().find(s => s.id === sec.id);
    if (updatedSec) {
      this.galaxyService.dbSaveSector(updatedSec);
    }
  }

  getSectorMidpoints(sec: Sector): { index: number; pt: [number, number] }[] {
    const midpoints: { index: number; pt: [number, number] }[] = [];
    const polygon = sec.polygon;
    if (!polygon || polygon.length < 3) return midpoints;

    for (let i = 0; i < polygon.length; i++) {
      const p1 = polygon[i];
      const p2 = polygon[(i + 1) % polygon.length];
      const midpoint: [number, number] = [
        parseFloat(((p1[0] + p2[0]) / 2).toFixed(1)),
        parseFloat(((p1[1] + p2[1]) / 2).toFixed(1))
      ];
      midpoints.push({
        index: i + 1,
        pt: midpoint
      });
    }
    return midpoints;
  }

  @HostListener('window:mousemove', ['$event'])
  onWindowMouseMove(e: MouseEvent) {
    if (this.isPanning) {
      this.translateX = e.clientX - this.startX;
      this.translateY = e.clientY - this.startY;
    } else if (this.activeDraggedSystemId && this.isEditMode() && this.galaxyService.isAdmin()) {
      const svg = document.getElementById("map-viewport");
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left - this.translateX) / this.scale;
      const mouseY = (e.clientY - rect.top - this.translateY) / this.scale;

      const newX = parseFloat((mouseX + this.dragOffset.x).toFixed(1));
      const newY = parseFloat((mouseY + this.dragOffset.y).toFixed(1));

      this.galaxyService.updateSystemCoords(this.activeDraggedSystemId, newX, newY);
    } else if (this.activeDraggedSectorId && this.activeDraggedSectorVertexIndex !== -1 && this.isEditMode() && this.galaxyService.isAdmin()) {
      const svg = document.getElementById("map-viewport");
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left - this.translateX) / this.scale;
      const mouseY = (e.clientY - rect.top - this.translateY) / this.scale;

      const newX = parseFloat(mouseX.toFixed(1));
      const newY = parseFloat(mouseY.toFixed(1));

      this.galaxyService.updateSectorVertex(this.activeDraggedSectorId, this.activeDraggedSectorVertexIndex, newX, newY);
    }
  }

  @HostListener('window:mouseup')
  async onWindowMouseUp() {
    if (this.isPanning) {
      this.isPanning = false;
      this.mapCursor.set('grab');
    } else if (this.activeDraggedSystemId) {
      const sysId = this.activeDraggedSystemId;
      this.activeDraggedSystemId = null;
      this.galaxyService.activelyDraggedSystemId.set(null);
      const sys = this.galaxyService.systems().find(s => s.id === sysId);
      if (sys) {
        await this.galaxyService.dbSaveSystem(sys);
      }
    } else if (this.activeDraggedSectorId) {
      const sectorId = this.activeDraggedSectorId;
      this.activeDraggedSectorId = null;
      this.galaxyService.activelyDraggedSectorId.set(null);
      this.activeDraggedSectorVertexIndex = -1;
      const sec = this.galaxyService.sectors().find(s => s.id === sectorId);
      if (sec) {
        await this.galaxyService.dbSaveSector(sec);
      }
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

  getRoundedPolygonPath(points: [number, number][], radius: number = 20): string {
    if (!points || points.length < 3) return '';

    let path = '';
    const n = points.length;

    for (let i = 0; i < n; i++) {
      const B = points[i];
      const A = points[(i - 1 + n) % n];
      const C = points[(i + 1) % n];

      // Vector from B to A
      const dx1 = A[0] - B[0];
      const dy1 = A[1] - B[1];
      const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);

      // Vector from B to C
      const dx2 = C[0] - B[0];
      const dy2 = C[1] - B[1];
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

      if (len1 === 0 || len2 === 0) continue;

      const u1 = [dx1 / len1, dy1 / len1];
      const u2 = [dx2 / len2, dy2 / len2];

      // Restrict corner radius to at most half of the adjacent segment lengths
      const d = Math.min(radius, len1 / 2, len2 / 2);

      const pStart = [B[0] + d * u1[0], B[1] + d * u1[1]];
      const pEnd = [B[0] + d * u2[0], B[1] + d * u2[1]];

      if (i === 0) {
        path += `M ${pStart[0].toFixed(1)} ${pStart[1].toFixed(1)}`;
      } else {
        path += ` L ${pStart[0].toFixed(1)} ${pStart[1].toFixed(1)}`;
      }

      path += ` Q ${B[0].toFixed(1)} ${B[1].toFixed(1)} ${pEnd[0].toFixed(1)} ${pEnd[1].toFixed(1)}`;
    }

    path += ' Z';
    return path;
  }


  getLaneCoords(conn: Connection) {
    const systems = this.galaxyService.systems();
    const fromSys = systems.find(s => s.id === conn.from_system_id);
    const toSys = systems.find(s => s.id === conn.to_system_id);
    if (fromSys && toSys) {
      const route = this.galaxyService.calculatedRoute();
      if (route && route.steps) {
        const isReverse = route.steps.some(s => s.fromId === conn.to_system_id && s.toId === conn.from_system_id);
        if (isReverse) {
          return { x1: toSys.x, y1: toSys.y, x2: fromSys.x, y2: fromSys.y };
        }
      }
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

  isBetweenSectors(conn: Connection): boolean {
    const systems = this.galaxyService.systems();
    const fromSys = systems.find(s => s.id === conn.from_system_id);
    const toSys = systems.find(s => s.id === conn.to_system_id);
    if (!fromSys || !toSys) return false;

    const sectors = this.galaxyService.sectors();
    const fromInSector = sectors.some(s => s.id === fromSys.sectorId);
    const toInSector = sectors.some(s => s.id === toSys.sectorId);
    return fromInSector && toInSector && fromSys.sectorId !== toSys.sectorId;
  }

  isOutsideSectors(conn: Connection): boolean {
    const systems = this.galaxyService.systems();
    const fromSys = systems.find(s => s.id === conn.from_system_id);
    const toSys = systems.find(s => s.id === conn.to_system_id);
    if (!fromSys || !toSys) return true;

    const sectors = this.galaxyService.sectors();
    const fromInSector = sectors.some(s => s.id === fromSys.sectorId);
    const toInSector = sectors.some(s => s.id === toSys.sectorId);
    return !fromInSector || !toInSector;
  }

  isSectorVisible(sectorId: string): boolean {
    return !this.galaxyService.hiddenSectorIds().has(sectorId);
  }

  getSystemNodeColor(sys: StarSystem): string {
    return getSystemNodeColor(this.planetColorMode(), sys, this.galaxyService.sectors());
  }

  hasBase(sysId: string): boolean {
    return this.galaxyService.planets().some(p => p.systemId === sysId && p.bases && p.bases.length > 0);
  }

  hasStation(sysId: string): boolean {
    return this.galaxyService.stations().some(s => s.systemId === sysId);
  }

  getSystemLabelY(sys: StarSystem): number {
    const baseOffset = (this.starSize() / 2) + 6;
    if (this.hasBase(sys.id) || this.hasStation(sys.id)) {
      return sys.y - baseOffset - 12;
    }
    return sys.y - baseOffset;
  }

  getConnectionLabel(conn: Connection): string {
    const systems = this.galaxyService.systems();
    const from = systems.find(s => s.id === conn.from_system_id)?.name || 'Unknown';
    const to = systems.find(s => s.id === conn.to_system_id)?.name || 'Unknown';
    return `${from} ⟷ ${to}`;
  }

  onConnectionMouseEnter(event: MouseEvent, conn: Connection) {
    this.hoveredConnection.set(conn);
    this.updateTooltipPosition(event);
  }

  onConnectionMouseMove(event: MouseEvent) {
    this.updateTooltipPosition(event);
  }

  onConnectionMouseLeave() {
    this.hoveredConnection.set(null);
  }

  updateTooltipPosition(event: MouseEvent) {
    const container = document.getElementById('map-viewport-container');
    if (container) {
      const rect = container.getBoundingClientRect();
      this.hoveredConnectionMousePos.set({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      });
    }
  }
}
