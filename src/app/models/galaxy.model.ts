export interface Sector {
  id: string;
  name: string;
  index: number;
  level?: string;
  color: string;
  polygon: [number, number][];
  centroid?: { x: number; y: number };
}

export interface StarSystem {
  id: string;
  name: string;
  gameId?: string;
  designation?: string;
  starType: string;
  starColor: string;
  index: number;
  sectorId: string;
  color: string;
  x: number;
  y: number;
}

export interface BaseProduction {
  item: string;
  amountPerMinute: number;
}

export interface PlanetBase {
  name: string;
  owner: string;
  productions: BaseProduction[];
}

export interface Planet {
  id: string;
  name: string;
  systemId: string;
  designation?: string;
  resources: string[];
  deposits: string[];
  bases?: PlanetBase[];
}

export interface SpaceStation {
  id: string;
  name: string;
  systemId: string;
  owner: string;
  facilities: { type: string }[];
}

export interface Connection {
  from_system_id: string;
  to_system_id: string;
  cost: number;
}

export interface CalculatedRouteStep {
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
}

export interface CalculatedRoute {
  jumps: number;
  cost: number;
  steps: CalculatedRouteStep[];
}
