import { Component, signal, computed, inject, OnDestroy, ElementRef, viewChild } from '@angular/core';
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
  activeTool = signal<'pen' | 'eraser' | null>(null);
  mapCanvas = viewChild<ElementRef<HTMLCanvasElement>>('mapCanvas');
  isDrawing = false;
  private lastX = 0;
  private lastY = 0;
  private currentMode: 'pen' | 'eraser' = 'pen';
  private strokes: Array<{ points: Array<{ x: number; y: number }>; mode: 'pen' | 'eraser' }> = [];
  private currentStroke: Array<{ x: number; y: number }> = [];
  private resizeObserver?: ResizeObserver;

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

    this.resizeObserver = new ResizeObserver(() => this.redrawStrokes());
  }

  ngOnDestroy(): void {
    this.unsub();
    this.resizeObserver?.disconnect();
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
    this.activeTool.set(null);
    this.strokes = [];
    this.currentStroke = [];
  }

  saveNotes(): void {
    const index = this.notesOpenIndex();
    if (index === null) return;
    this.updateNotes(this.maps()[index].name, this.pendingNotes());
    this.notesOpenIndex.set(null);
  }

  closeNotes(): void {
    this.notesOpenIndex.set(null);
    this.activeTool.set(null);
    this.strokes = [];
    this.currentStroke = [];
  }

  setTool(tool: 'pen' | 'eraser'): void {
    this.activeTool.update(t => t === tool ? null : tool);
  }

  clearCanvas(): void {
    this.strokes = [];
    this.currentStroke = [];
    const el = this.mapCanvas()?.nativeElement;
    if (!el) return;
    el.getContext('2d')?.clearRect(0, 0, el.width, el.height);
  }

  onCanvasMouseDown(e: MouseEvent): void {
    const el = e.target as HTMLCanvasElement;
    this.syncCanvas(el);
    this.isDrawing = true;
    this.currentMode = this.activeTool() as 'pen' | 'eraser';
    const rect = el.getBoundingClientRect();
    this.lastX = e.clientX - rect.left;
    this.lastY = e.clientY - rect.top;
    this.currentStroke = [{ x: this.lastX / el.width, y: this.lastY / el.height }];
    this.resizeObserver?.disconnect();
    this.resizeObserver?.observe(el);
  }

  onCanvasMouseMove(e: MouseEvent): void {
    if (!this.isDrawing) return;
    const el = e.target as HTMLCanvasElement;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    ctx.beginPath();
    ctx.moveTo(this.lastX, this.lastY);
    ctx.lineTo(x, y);
    if (this.currentMode === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = 20;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#111111';
      ctx.lineWidth = 3;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    this.currentStroke.push({ x: x / el.width, y: y / el.height });
    this.lastX = x;
    this.lastY = y;
  }

  onCanvasMouseUp(): void {
    if (this.currentStroke.length > 1) {
      this.strokes.push({ points: [...this.currentStroke], mode: this.currentMode });
    }
    this.currentStroke = [];
    this.isDrawing = false;
  }

  private syncCanvas(el: HTMLCanvasElement): void {
    el.width = el.offsetWidth;
    el.height = el.offsetHeight;
  }

  private redrawStrokes(): void {
    const el = this.mapCanvas()?.nativeElement;
    if (!el) return;
    this.syncCanvas(el);
    const ctx = el.getContext('2d');
    if (!ctx) return;
    for (const stroke of this.strokes) {
      if (stroke.points.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x * el.width, stroke.points[0].y * el.height);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x * el.width, stroke.points[i].y * el.height);
      }
      if (stroke.mode === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = 20;
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = '#111111';
        ctx.lineWidth = 3;
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
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
