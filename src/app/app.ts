import { Component } from '@angular/core';
import { MapTracker } from './map-tracker/map-tracker';

@Component({
  selector: 'app-root',
  imports: [MapTracker],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}
