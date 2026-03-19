import { Component, signal, computed, inject, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UpperCasePipe } from '@angular/common';
import { getFirestore, doc, onSnapshot, setDoc, Unsubscribe } from 'firebase/firestore';
import { MapStats } from '../map.model';
import { AuthService } from '../auth.service';

const LEGACY_STORAGE_KEY = 'valorant-map-stats';

const DEFAULT_MAPS: MapStats[] = [
  { name: 'Abyss',    image: 'abyss',    inSplit: false, wins: 0, losses: 0, notes: '' },
  { name: 'Ascent',   image: 'ascent',   inSplit: false, wins: 0, losses: 0, notes: '' },
  { name: 'Bind',     image: 'bind',     inSplit: true,  wins: 0, losses: 0, notes: '' },
  { name: 'Breeze',   image: 'breeze',   inSplit: true,  wins: 0, losses: 0, notes: '' },
  { name: 'Corrode',  image: 'corrode',  inSplit: false, wins: 0, losses: 0, notes: '' },
  { name: 'Fracture', image: 'fracture', inSplit: true,  wins: 0, losses: 0, notes: '' },
  { name: 'Haven',    image: 'haven',    inSplit: true,  wins: 0, losses: 0, notes: '' },
  { name: 'Icebox',   image: 'icebox',   inSplit: false, wins: 0, losses: 0, notes: '' },
  { name: 'Lotus',    image: 'lotus',    inSplit: true,  wins: 0, losses: 0, notes: '' },
  { name: 'Pearl',    image: 'pearl',    inSplit: true,  wins: 0, losses: 0, notes: '' },
  { name: 'Split',    image: 'split',    inSplit: true,  wins: 0, losses: 0, notes: '' },
  { name: 'Sunset',   image: 'sunset',   inSplit: false, wins: 0, losses: 0, notes: '' },
];

@Component({
  selector: 'app-map-tracker',
  imports: [FormsModule, UpperCasePipe],
  templateUrl: './map-tracker.html',
  styleUrl: './map-tracker.scss',
})
export class MapTracker implements OnDestroy {
  private db = getFirestore();
  private docRef = doc(this.db, 'stats', 'maps');
  private unsub: Unsubscribe;

  auth = inject(AuthService);

  maps = signal<MapStats[]>(DEFAULT_MAPS.map(m => ({ ...m })));
  loading = signal(true);
  showOthers = signal(false);
  notesOpenIndex = signal<number | null>(null);
  pendingNotes = signal('');
  modalTab = signal<'notes' | 'map'>('notes');

  splitMaps = computed(() => this.maps().filter(m => m.inSplit));
  otherMaps = computed(() => this.maps().filter(m => !m.inSplit));
  totalWins = computed(() => this.maps().reduce((sum, m) => sum + m.wins, 0));
  totalLosses = computed(() => this.maps().reduce((sum, m) => sum + m.losses, 0));
  totalGames = computed(() => this.totalWins() + this.totalLosses());
  overallWinRate = computed(() => {
    const total = this.totalGames();
    return total === 0 ? 0 : Math.round((this.totalWins() / total) * 100);
  });

  constructor() {
    this.unsub = onSnapshot(this.docRef, snapshot => {
      if (snapshot.exists()) {
        this.maps.set(this.merge(snapshot.data()['maps'] ?? []));
      } else {
        const seeded = this.seedFromLegacy();
        this.maps.set(seeded);
        setDoc(this.docRef, { maps: seeded });
      }
      this.loading.set(false);
    });
  }

  ngOnDestroy(): void {
    this.unsub();
  }

  winRate(map: MapStats): number {
    const total = map.wins + map.losses;
    return total === 0 ? 0 : Math.round((map.wins / total) * 100);
  }

  totalGamesFor(map: MapStats): number {
    return map.wins + map.losses;
  }

  addWin(name: string): void {
    this.updateMap(name, m => ({ ...m, wins: m.wins + 1 }));
  }

  addLoss(name: string): void {
    this.updateMap(name, m => ({ ...m, losses: m.losses + 1 }));
  }

  removeWin(name: string): void {
    this.updateMap(name, m => ({ ...m, wins: Math.max(0, m.wins - 1) }));
  }

  removeLoss(name: string): void {
    this.updateMap(name, m => ({ ...m, losses: Math.max(0, m.losses - 1) }));
  }

  updateNotes(name: string, notes: string): void {
    this.updateMap(name, m => ({ ...m, notes }));
  }

  openNotes(index: number): void {
    this.pendingNotes.set(this.maps()[index].notes);
    this.notesOpenIndex.set(index);
    this.modalTab.set('notes');
  }

  saveNotes(): void {
    const index = this.notesOpenIndex();
    if (index === null) return;
    this.updateNotes(this.maps()[index].name, this.pendingNotes());
    this.notesOpenIndex.set(null);
  }

  closeNotes(): void {
    this.notesOpenIndex.set(null);
  }

  globalIndex(map: MapStats): number {
    return this.maps().findIndex(m => m.name === map.name);
  }

  private updateMap(name: string, updater: (m: MapStats) => MapStats): void {
    this.maps.update(maps => maps.map(m => m.name === name ? updater(m) : m));
    setDoc(this.docRef, { maps: this.maps() });
  }

  private merge(firestoreMaps: MapStats[]): MapStats[] {
    return DEFAULT_MAPS.map(def => {
      const found = firestoreMaps.find(m => m.name === def.name);
      return found ? { ...def, wins: found.wins, losses: found.losses, notes: found.notes } : { ...def };
    });
  }

  private seedFromLegacy(): MapStats[] {
    try {
      const stored = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (stored) return this.merge(JSON.parse(stored));
    } catch {}
    return DEFAULT_MAPS.map(m => ({ ...m }));
  }
}
