import { Component, inject } from '@angular/core';
import { MapTracker } from './map-tracker/map-tracker';
import { Login } from './login/login';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-root',
  imports: [MapTracker, Login],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  auth = inject(AuthService);
}
