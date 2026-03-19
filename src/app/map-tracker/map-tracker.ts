import { Component, signal, computed, inject, OnDestroy, ElementRef, viewChild, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UpperCasePipe } from '@angular/common';
import { getFirestore, doc, onSnapshot, setDoc, Unsubscribe } from 'firebase/firestore';
import { MapStats } from '../map.model';
import { AuthService } from '../auth.service';

const LEGACY_STORAGE_KEY = 'valorant-map-stats';

const ICON_SIZE = 34;

type StrokeItem = { points: Array<{ x: number; y: number }>; mode: 'pen' | 'eraser' };
type CharacterToken = { char: string; x: number; y: number };

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
  selectedTokenIndex = signal<number | null>(null);
  canvasCursor = signal<string>('default');
  readonly characters = CHARACTERS;
  mapCanvas = viewChild<ElementRef<HTMLCanvasElement>>('mapCanvas');
  isDrawing = false;
  private isDraggingToken = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private lastX = 0;
  private lastY = 0;
  private currentMode: 'pen' | 'eraser' = 'pen';
  private strokes: StrokeItem[] = [];
  private tokens: CharacterToken[] = [];
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

  @HostListener('document:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent): void {
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedTokenIndex() !== null) {
      this.deleteSelectedToken();
    }
  }

  openNotes(index: number): void {
    this.pendingNotes.set(this.maps()[index].notes);
    this.notesOpenIndex.set(index);
    this.modalTab.set('notes');
    this.activeTool.set(null);
    this.selectedCharacter.set(null);
    this.selectedTokenIndex.set(null);
    this.strokes = [];
    this.tokens = [];
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
    this.selectedTokenIndex.set(null);
    this.strokes = [];
    this.tokens = [];
    this.currentStroke = [];
  }

  setTool(tool: 'pen' | 'eraser'): void {
    this.selectedTokenIndex.set(null);
    this.activeTool.update(t => t === tool ? null : tool);
  }

  selectCharacter(char: string): void {
    this.selectedCharacter.set(char || null);
    this.activeTool.set(char ? 'character' : null);
    this.selectedTokenIndex.set(null);
  }

  clearCanvas(): void {
    this.strokes = [];
    this.tokens = [];
    this.currentStroke = [];
    this.selectedTokenIndex.set(null);
    const el = this.mapCanvas()?.nativeElement;
    if (!el) return;
    el.getContext('2d')?.clearRect(0, 0, el.width, el.height);
  }

  deleteSelectedToken(): void {
    const idx = this.selectedTokenIndex();
    if (idx === null) return;
    this.tokens.splice(idx, 1);
    this.selectedTokenIndex.set(null);
    this.redrawAll();
  }

  onCanvasMouseDown(e: MouseEvent): void {
    const tool = this.activeTool();
    const el = e.target as HTMLCanvasElement;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (tool === 'character') return;

    if (tool === null) {
      const idx = this.tokenAt(x, y, el.width, el.height);
      if (idx >= 0) {
        this.selectedTokenIndex.set(idx);
        this.isDraggingToken = true;
        this.dragOffsetX = x - this.tokens[idx].x * el.width;
        this.dragOffsetY = y - this.tokens[idx].y * el.height;
        this.canvasCursor.set('grabbing');
      } else {
        this.selectedTokenIndex.set(null);
      }
      return;
    }

    this.syncCanvas(el);
    this.isDrawing = true;
    this.currentMode = tool as 'pen' | 'eraser';
    this.lastX = x;
    this.lastY = y;
    this.currentStroke = [{ x: x / el.width, y: y / el.height }];
    this.resizeObserver?.disconnect();
    this.resizeObserver?.observe(el);
  }

  onCanvasMouseMove(e: MouseEvent): void {
    const el = e.target as HTMLCanvasElement;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (this.isDraggingToken) {
      const idx = this.selectedTokenIndex();
      if (idx === null) return;
      this.tokens[idx] = { ...this.tokens[idx], x: (x - this.dragOffsetX) / el.width, y: (y - this.dragOffsetY) / el.height };
      this.redrawAll();
      return;
    }

    if (this.activeTool() === null) {
      const hit = this.tokenAt(x, y, el.width, el.height);
      this.canvasCursor.set(hit >= 0 ? 'grab' : 'default');
      return;
    }

    if (!this.isDrawing) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(this.lastX, this.lastY);
    ctx.lineTo(x, y);
    if (this.currentMode === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = 20;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#00F0A1';
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
    if (this.isDraggingToken) {
      this.isDraggingToken = false;
      this.canvasCursor.set('grab');
      return;
    }
    if (this.currentStroke.length > 1) {
      this.strokes.push({ points: [...this.currentStroke], mode: this.currentMode });
      if (this.currentMode === 'eraser') this.redrawAll();
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
    this.tokens.push({ char, x, y });
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const img = this.getImage(char);
    if (img.complete) {
      ctx.drawImage(img, x * el.width - ICON_SIZE / 2, y * el.height - ICON_SIZE / 2, ICON_SIZE, ICON_SIZE);
    } else {
      img.onload = () => this.redrawAll();
    }
  }

  private tokenAt(x: number, y: number, w: number, h: number): number {
    const half = ICON_SIZE / 2;
    for (let i = this.tokens.length - 1; i >= 0; i--) {
      const tx = this.tokens[i].x * w;
      const ty = this.tokens[i].y * h;
      if (x >= tx - half && x <= tx + half && y >= ty - half && y <= ty + half) return i;
    }
    return -1;
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
    if (el.width !== el.offsetWidth || el.height !== el.offsetHeight) {
      el.width = el.offsetWidth;
      el.height = el.offsetHeight;
    } else {
      el.getContext('2d')?.clearRect(0, 0, el.width, el.height);
    }
    const ctx = el.getContext('2d');
    if (!ctx) return;

    // 1. Replay strokes (eraser only affects strokes)
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
        ctx.strokeStyle = '#00F0A1';
        ctx.lineWidth = 3;
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    // 2. Draw tokens always on top
    for (let i = 0; i < this.tokens.length; i++) {
      const t = this.tokens[i];
      const px = t.x * el.width;
      const py = t.y * el.height;
      const img = this.getImage(t.char);
      ctx.drawImage(img, px - ICON_SIZE / 2, py - ICON_SIZE / 2, ICON_SIZE, ICON_SIZE);
      if (i === this.selectedTokenIndex()) {
        ctx.strokeStyle = '#ff4655';
        ctx.lineWidth = 2;
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeRect(px - ICON_SIZE / 2 - 2, py - ICON_SIZE / 2 - 2, ICON_SIZE + 4, ICON_SIZE + 4);
      }
    }
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
