import { describe, beforeEach, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { MapComponent } from './map.component';
import { GalaxyService } from '../../services/galaxy.service';
import { Connection, StarSystem } from '../../models/galaxy.model';

describe('MapComponent', () => {
  let component: MapComponent;
  let service: GalaxyService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MapComponent],
      providers: [
        provideTranslateService(),
        GalaxyService
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(MapComponent);
    component = fixture.componentInstance;
    service = TestBed.inject(GalaxyService);
  });

  it('should swap connection coordinates if the calculated route travels in the reverse direction', () => {
    const systemA: StarSystem = {
      id: 'sys-a',
      name: 'System A',
      starType: 'G',
      starColor: '#ffffff',
      index: 1,
      sectorId: 'sec-1',
      color: '#ffffff',
      x: 100,
      y: 100
    };

    const systemB: StarSystem = {
      id: 'sys-b',
      name: 'System B',
      starType: 'K',
      starColor: '#ff0000',
      index: 2,
      sectorId: 'sec-1',
      color: '#ff0000',
      x: 200,
      y: 200
    };

    service.systems.set([systemA, systemB]);

    const conn: Connection = {
      from_system_id: 'sys-a',
      to_system_id: 'sys-b',
      cost: 5
    };

    // Case 1: No calculated route
    service.calculatedRoute.set(null);
    let coords = component.getLaneCoords(conn);
    expect(coords).toEqual({ x1: 100, y1: 100, x2: 200, y2: 200 });

    // Case 2: Calculated route goes forward (A -> B)
    service.calculatedRoute.set({
      jumps: 1,
      cost: 5,
      steps: [{
        fromId: 'sys-a',
        toId: 'sys-b',
        fromName: 'System A',
        toName: 'System B'
      }]
    });
    coords = component.getLaneCoords(conn);
    expect(coords).toEqual({ x1: 100, y1: 100, x2: 200, y2: 200 });

    // Case 3: Calculated route goes reverse (B -> A)
    service.calculatedRoute.set({
      jumps: 1,
      cost: 5,
      steps: [{
        fromId: 'sys-b',
        toId: 'sys-a',
        fromName: 'System B',
        toName: 'System A'
      }]
    });
    coords = component.getLaneCoords(conn);
    expect(coords).toEqual({ x1: 200, y1: 200, x2: 100, y2: 100 });
  });

  it('should correctly detect if a system has a base or station', () => {
    const sysId = 'sys-test';
    // Initially false
    expect(component.hasBase(sysId)).toBe(false);
    expect(component.hasStation(sysId)).toBe(false);

    // Add a station
    service.stations.set([{
      id: 'station-1',
      name: 'Station 1',
      systemId: sysId,
      owner: 'Player',
      facilities: []
    }]);
    expect(component.hasStation(sysId)).toBe(true);

    // Add a planet with no bases
    service.planets.set([{
      id: 'planet-1',
      name: 'Planet 1',
      systemId: sysId,
      resources: [],
      deposits: []
    }]);
    expect(component.hasBase(sysId)).toBe(false);

    // Add a base to the planet
    service.planets.set([{
      id: 'planet-1',
      name: 'Planet 1',
      systemId: sysId,
      resources: [],
      deposits: [],
      bases: [{ name: 'Base 1', owner: 'Player', productions: [] }]
    }]);
    expect(component.hasBase(sysId)).toBe(true);
  });

  it('should compute the correct label Y coordinate to avoid overlapping', () => {
    const sys: StarSystem = {
      id: 'sys-label-test',
      name: 'Test System',
      starType: 'G',
      starColor: '#ffffff',
      index: 1,
      sectorId: 'sec-1',
      color: '#ffffff',
      x: 100,
      y: 100
    };
    
    // No base/station -> normal Y (sys.y - starSize/2 - 6 = 100 - 5 - 6 = 89)
    service.stations.set([]);
    service.planets.set([]);
    expect(component.getSystemLabelY(sys)).toBe(89);

    // Add station -> should shift up by 12px (89 - 12 = 77)
    service.stations.set([{
      id: 'station-2',
      name: 'Station 2',
      systemId: 'sys-label-test',
      owner: 'Player',
      facilities: []
    }]);
    expect(component.getSystemLabelY(sys)).toBe(77);
  });

  it('should return the correct connection label', () => {
    const systemA: StarSystem = {
      id: 'sys-a',
      name: 'Sol',
      starType: 'G',
      starColor: '#ffffff',
      index: 1,
      sectorId: 'sec-1',
      color: '#ffffff',
      x: 100,
      y: 100
    };

    const systemB: StarSystem = {
      id: 'sys-b',
      name: 'Alpha Centauri',
      starType: 'K',
      starColor: '#ff0000',
      index: 2,
      sectorId: 'sec-1',
      color: '#ff0000',
      x: 200,
      y: 200
    };

    service.systems.set([systemA, systemB]);

    const conn: Connection = {
      from_system_id: 'sys-a',
      to_system_id: 'sys-b',
      cost: 5
    };

    expect(component.getConnectionLabel(conn)).toBe('Sol ⟷ Alpha Centauri');
  });

  it('should correctly identify if a connection is between different sectors or outside sectors', () => {
    service.sectors.set([
      { id: 'sec-1', name: 'Sector 1', index: 1, color: '#ff0000', polygon: [] },
      { id: 'sec-2', name: 'Sector 2', index: 2, color: '#00ff00', polygon: [] }
    ]);

    const systemA: StarSystem = {
      id: 'sys-a',
      name: 'Sol',
      starType: 'G',
      starColor: '#ffffff',
      index: 1,
      sectorId: 'sec-1',
      color: '#ffffff',
      x: 100,
      y: 100
    };

    const systemB: StarSystem = {
      id: 'sys-b',
      name: 'Alpha Centauri',
      starType: 'K',
      starColor: '#ff0000',
      index: 2,
      sectorId: 'sec-1',
      color: '#ff0000',
      x: 200,
      y: 200
    };

    const systemC: StarSystem = {
      id: 'sys-c',
      name: 'Vega',
      starType: 'A',
      starColor: '#0000ff',
      index: 3,
      sectorId: 'sec-2',
      color: '#0000ff',
      x: 300,
      y: 300
    };

    const systemOutside: StarSystem = {
      id: 'sys-out',
      name: 'Void',
      starType: 'M',
      starColor: '#888888',
      index: 4,
      sectorId: 'sec-non-existent',
      color: '#888888',
      x: 400,
      y: 400
    };

    service.systems.set([systemA, systemB, systemC, systemOutside]);

    const connSameSector: Connection = { from_system_id: 'sys-a', to_system_id: 'sys-b', cost: 5 };
    const connBetweenSectors: Connection = { from_system_id: 'sys-a', to_system_id: 'sys-c', cost: 10 };
    const connOutsideSectors: Connection = { from_system_id: 'sys-a', to_system_id: 'sys-out', cost: 15 };

    // Test isBetweenSectors
    expect(component.isBetweenSectors(connSameSector)).toBe(false);
    expect(component.isBetweenSectors(connBetweenSectors)).toBe(true);
    expect(component.isBetweenSectors(connOutsideSectors)).toBe(false);

    // Test isOutsideSectors
    expect(component.isOutsideSectors(connSameSector)).toBe(false);
    expect(component.isOutsideSectors(connBetweenSectors)).toBe(false);
    expect(component.isOutsideSectors(connOutsideSectors)).toBe(true);
  });

  describe('getRoundedPolygonPath', () => {
    it('should return empty string for null, empty or less than 3 points', () => {
      expect(component.getRoundedPolygonPath([])).toBe('');
      expect(component.getRoundedPolygonPath([[0, 0]])).toBe('');
      expect(component.getRoundedPolygonPath([[0, 0], [10, 10]])).toBe('');
    });

    it('should generate a valid path string for a triangle', () => {
      const triangle: [number, number][] = [[0, 0], [100, 0], [50, 100]];
      const path = component.getRoundedPolygonPath(triangle, 10);
      
      expect(path).toContain('M');
      expect(path).toContain('Q');
      expect(path).toContain('Z');
      
      // The path should look like: "M 5.0 10.0 Q 0.0 0.0 10.0 0.0 L 90.0 0.0 Q 100.0 0.0 95.0 10.0 L 55.0 90.0 Q 50.0 100.0 45.0 90.0 Z"
      // Let's verify start coordinates and curves
      expect(path).toMatch(/^M \d+(\.\d+)? \d+(\.\d+)? L?/);
      expect(path).toMatch(/Z$/);
    });
  });
});
