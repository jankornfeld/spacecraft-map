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
});
