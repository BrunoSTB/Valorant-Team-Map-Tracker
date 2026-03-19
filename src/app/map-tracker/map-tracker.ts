import { Component, signal, computed, inject, OnDestroy, ElementRef, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UpperCasePipe } from '@angular/common';
import { getFirestore, doc, onSnapshot, setDoc, Unsubscribe } from 'firebase/firestore';
import { MapStats } from '../map.model';
import { AuthService } from '../auth.service';

const LEGACY_STORAGE_KEY = 'valorant-map-stats';

const ICON_SIZE = 48;

type CanvasItem =
  | { type: 'stroke'; points: Array<{ x: number; y: number }>; mode: 'pen' | 'eraser' }
  | { type: 'character'; char: string; x: number; y: number };

const CHARACTERS: { id: string; name: string }[] = [
  { id: 'astra', name: 'Astra' }, { id: 'breach', name: 'Breach' },
  { id: 'brimstone', name: 'Brimstone' }, { id: 'chamber', name: 'Chamber' },
  { id: 'clove', name: 'Clove' }, { id: 'cypher', name: 'Cypher' },
  { id: 'deadlock', name: 'Deadlock' }, { id: 'Fade', name: 'Fade' },
  { id: 'gekko', name: 'Gekko' }, { id: 'harbor', name: 'Harbor' },
  { id: 'iso', name: 'Iso' }, { id: 'jett', name: 'Jett' },
  { id: 'kayo', name: 'Kayo' }, { id: 'killjoy', name: 'Killjoy' },
  { id: 'Miks', name: 'Miks' }, { id: 'Neon', name: 'Neon' },
  { id: 'omen', name: 'Omen' }, { id: 'phoenix', name: 'Phoenix' },
  { id: 'raze', name: 'Raze' }, { id: 'reyna', name: 'Reyna' },
  { id: 'sage', name: 'Sage' }, { id: 'skye', name: 'Skye' },
  { id: 'sova', name: 'Sova' }, { id: 'tejo', name: 'Tejo' },
  { id: 'veto', name: 'Veto' }, { id: 'viper', name: 'Viper' },
  { id: 'vyse', name: 'Vyse' }, { id: 'waylay', name: 'Waylay' },
  { id: 'yoru', name: 'Yoru' },
].sort((a, b) => a.name.localeCompare(b.name));

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
  activeTool = signal<'pen' | 'eraser' | 'character' | null>(null);
  selectedCharacter = signal<string | null>(null);
  readonly characters = CHARACTERS;
  mapCanvas = viewChild<ElementRef<HTMLCanvasElement>>('mapCanvas');
  isDrawing = false;
  private lastX = 0;
  private lastY = 0;
  private currentMode: 'pen' | 'eraser' = 'pen';
  private canvasItems: CanvasItem[] = [];
  private currentStroke: Array<{ x: number; y: number }> = [];
  private resizeObserver?: ResizeObserver;
  private imageCache = new Map<string, HTMLImageElement>();

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

    this.resizeObserver = new ResizeObserver(() => this.redrawAll());
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
    this.selectedCharacter.set(null);
    this.canvasItems = [];
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
    this.selectedCharacter.set(null);
    this.canvasItems = [];
    this.currentStroke = [];
  }

  setTool(tool: 'pen' | 'eraser'): void {
    this.activeTool.update(t => t === tool ? null : tool);
  }

  selectCharacter(char: string): void {
    this.selectedCharacter.set(char || null);
    this.activeTool.set(char ? 'character' : null);
  }

  clearCanvas(): void {
    this.canvasItems = [];
    this.currentStroke = [];
    const el = this.mapCanvas()?.nativeElement;
    if (!el) return;
    el.getContext('2d')?.clearRect(0, 0, el.width, el.height);
  }

  onCanvasMouseDown(e: MouseEvent): void {
    if (this.activeTool() === 'character') return;
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
      this.canvasItems.push({ type: 'stroke', points: [...this.currentStroke], mode: this.currentMode });
    }
    this.currentStroke = [];
    this.isDrawing = false;
  }

  onCanvasClick(e: MouseEvent): void {
    if (this.activeTool() !== 'character' || !this.selectedCharacter()) return;
    const el = e.target as HTMLCanvasElement;
    if (el.width === 0 || el.height === 0) { el.width = el.offsetWidth; el.height = el.offsetHeight; }
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / el.width;
    const y = (e.clientY - rect.top) / el.height;
    const char = this.selectedCharacter()!;
    this.canvasItems.push({ type: 'character', char, x, y });
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const img = this.getImage(char);
    if (img.complete) {
      ctx.drawImage(img, x * el.width - ICON_SIZE / 2, y * el.height - ICON_SIZE / 2, ICON_SIZE, ICON_SIZE);
    } else {
      img.onload = () => this.redrawAll();
    }
  }

  private getImage(char: string): HTMLImageElement {
    if (!this.imageCache.has(char)) {
      const img = new Image();
      img.src = `characters/${char}.png`;
      this.imageCache.set(char, img);
    }
    return this.imageCache.get(char)!;
  }

  private syncCanvas(el: HTMLCanvasElement): void {
    el.width = el.offsetWidth;
    el.height = el.offsetHeight;
  }

  private redrawAll(): void {
    const el = this.mapCanvas()?.nativeElement;
    if (!el) return;
    this.syncCanvas(el);
    const ctx = el.getContext('2d');
    if (!ctx) return;
    for (const item of this.canvasItems) {
      if (item.type === 'stroke') {
        if (item.points.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(item.points[0].x * el.width, item.points[0].y * el.height);
        for (let i = 1; i < item.points.length; i++) {
          ctx.lineTo(item.points[i].x * el.width, item.points[i].y * el.height);
        }
        if (item.mode === 'eraser') {
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
      } else {
        ctx.globalCompositeOperation = 'source-over';
        const img = this.getImage(item.char);
        ctx.drawImage(img, item.x * el.width - ICON_SIZE / 2, item.y * el.height - ICON_SIZE / 2, ICON_SIZE, ICON_SIZE);
      }
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
