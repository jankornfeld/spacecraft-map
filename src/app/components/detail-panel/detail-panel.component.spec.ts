import { describe, beforeEach, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { DetailPanelComponent } from './detail-panel.component';
import { GalaxyService } from '../../services/galaxy.service';
import { Planet } from '../../models/galaxy.model';

describe('DetailPanelComponent', () => {
  let component: DetailPanelComponent;
  let service: GalaxyService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DetailPanelComponent],
      providers: [
        provideTranslateService(),
        GalaxyService
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(DetailPanelComponent);
    component = fixture.componentInstance;
    service = TestBed.inject(GalaxyService);
  });

  it('should initialize with default empty values', () => {
    expect(component.newBaseName).toBe('');
    expect(component.newBaseOwner).toBe('');
    expect(component.newBaseImageUrl).toBe('');
    expect(component.enlargedImageUrl()).toBeNull();
  });

  it('should open and close lightbox', () => {
    component.openLightbox('https://example.com/image.png');
    expect(component.enlargedImageUrl()).toBe('https://example.com/image.png');

    component.closeLightbox();
    expect(component.enlargedImageUrl()).toBeNull();
  });

  it('should add planet base with imageUrl and reset values', async () => {
    const planet: Planet = {
      id: 'planet-1',
      name: 'Planet 1',
      systemId: 'system-1',
      resources: [],
      deposits: [],
      bases: []
    };
    service.planets.set([planet]);

    component.newBaseName = 'Alpha Outpost';
    component.newBaseOwner = 'Player1';
    component.newBaseImageUrl = 'https://example.com/outpost.png';

    const mockEvent = { preventDefault: () => {} } as any;
    await component.addPlanetBase('planet-1', mockEvent);

    const updatedPlanet = service.planets().find(p => p.id === 'planet-1');
    expect(updatedPlanet?.bases?.length).toBe(1);
    expect(updatedPlanet?.bases?.[0].name).toBe('Alpha Outpost');
    expect(updatedPlanet?.bases?.[0].owner).toBe('Player1');
    expect(updatedPlanet?.bases?.[0].imageUrl).toBe('https://example.com/outpost.png');

    expect(component.newBaseName).toBe('');
    expect(component.newBaseOwner).toBe('');
    expect(component.newBaseImageUrl).toBe('');
  });

  it('should update base imageUrl', async () => {
    const planet: Planet = {
      id: 'planet-1',
      name: 'Planet 1',
      systemId: 'system-1',
      resources: [],
      deposits: [],
      bases: [{ name: 'Base 1', owner: 'Player1', productions: [] }]
    };
    service.planets.set([planet]);

    await component.updateBaseImageUrl('planet-1', 0, 'https://example.com/updated.png');

    const updatedPlanet = service.planets().find(p => p.id === 'planet-1');
    expect(updatedPlanet?.bases?.[0].imageUrl).toBe('https://example.com/updated.png');
  });
});
