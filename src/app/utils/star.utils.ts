import { StarSystem, Sector } from '../models/galaxy.model';

export function getStarColorClass(color: string): string {
  if (color === 'Yellow') return 'yellow';
  if (color === 'Blue') return 'blue';
  if (color === 'Red') return 'red';
  if (color === 'Purple') return 'purple';
  return 'blue';
}

export function getStarBadgeBg(color: string): string {
  return color && color.startsWith('#') ? color + '26' : '';
}

export function getStarBadgeColor(color: string): string {
  return color && color.startsWith('#') ? color : '';
}

export function getStarBadgeBorder(color: string): string {
  return color && color.startsWith('#') ? color + '4d' : '';
}

export function getSystemNodeColor(planetColorMode: string, sys: StarSystem, sectors: Sector[]): string {
  if (planetColorMode === 'sector') {
    const sec = sectors.find(s => s.id === sys.sectorId);
    return sec ? sec.color : '#ffffff';
  } else {
    // Star Color
    if (sys.starColor && sys.starColor.startsWith('#')) return sys.starColor;
    if (sys.starColor === 'Yellow') return '#f5d271';
    if (sys.starColor === 'Blue') return '#5aa9e6';
    if (sys.starColor === 'Red') return '#ef4444';
    if (sys.starColor === 'Purple') return '#c084fc';
    return sys.starColor || '#ffffff';
  }
}
