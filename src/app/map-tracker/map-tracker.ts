import { Component, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MapStats } from '../map.model';

const STORAGE_KEY = 'valorant-map-stats';

const DEFAULT_MAPS: MapStats[] = [
  { name: 'Ascent', image: 'ascent', wins: 0, losses: 0, notes: '' },
  { name: 'Bind', image: 'bind', wins: 0, losses: 0, notes: '' },
  { name: 'Breeze', image: 'breeze', wins: 0, losses: 0, notes: '' },
  { name: 'Fracture', image: 'fracture', wins: 0, losses: 0, notes: '' },
  { name: 'Haven', image: 'haven', wins: 0, losses: 0, notes: '' },
  { name: 'Icebox', image: 'icebox', wins: 0, losses: 0, notes: '' },
  { name: 'Lotus', image: 'lotus', wins: 0, losses: 0, notes: '' },
  { name: 'Pearl', image: 'pearl', wins: 0, losses: 0, notes: '' },
  { name: 'Split', image: 'split', wins: 0, losses: 0, notes: '' },
  { name: 'Sunset', image: 'sunset', wins: 0, losses: 0, notes: '' },
  { name: 'Abyss', image: 'abyss', wins: 0, losses: 0, notes: '' },
];

@Component({
  selector: 'app-map-tracker',
  imports: [FormsModule],
  templateUrl: './map-tracker.html',
  styleUrl: './map-tracker.scss',
})
export class MapTracker {
  maps = signal<MapStats[]>(this.loadMaps());

  totalWins = computed(() => this.maps().reduce((sum, m) => sum + m.wins, 0));
  totalLosses = computed(() => this.maps().reduce((sum, m) => sum + m.losses, 0));
  totalGames = computed(() => this.totalWins() + this.totalLosses());
  overallWinRate = computed(() => {
    const total = this.totalGames();
    return total === 0 ? 0 : Math.round((this.totalWins() / total) * 100);
  });

  winRate(map: MapStats): number {
    const total = map.wins + map.losses;
    return total === 0 ? 0 : Math.round((map.wins / total) * 100);
  }

  addWin(index: number): void {
    this.updateMap(index, map => ({ ...map, wins: map.wins + 1 }));
  }

  addLoss(index: number): void {
    this.updateMap(index, map => ({ ...map, losses: map.losses + 1 }));
  }

  removeWin(index: number): void {
    this.updateMap(index, map => ({ ...map, wins: Math.max(0, map.wins - 1) }));
  }

  removeLoss(index: number): void {
    this.updateMap(index, map => ({ ...map, losses: Math.max(0, map.losses - 1) }));
  }

  updateNotes(index: number, notes: string): void {
    this.updateMap(index, map => ({ ...map, notes }));
  }

  resetMap(index: number): void {
    this.updateMap(index, map => ({ ...map, wins: 0, losses: 0, notes: '' }));
  }

  private updateMap(index: number, updater: (map: MapStats) => MapStats): void {
    this.maps.update(maps => {
      const updated = [...maps];
      updated[index] = updater(updated[index]);
      return updated;
    });
    this.saveMaps();
  }

  private saveMaps(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.maps()));
  }

  private loadMaps(): MapStats[] {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_MAPS.map(m => ({ ...m }));
    try {
      const parsed: MapStats[] = JSON.parse(stored);
      // Merge to handle new maps added later
      return DEFAULT_MAPS.map(def => {
        const found = parsed.find(p => p.name === def.name);
        return found ? { ...def, ...found } : { ...def };
      });
    } catch {
      return DEFAULT_MAPS.map(m => ({ ...m }));
    }
  }
}
