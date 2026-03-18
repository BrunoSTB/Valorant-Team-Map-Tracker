import { Injectable, signal } from '@angular/core';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = getAuth();

  currentUser = signal<User | null>(null);
  authReady = signal(false);

  constructor() {
    onAuthStateChanged(this.auth, user => {
      this.currentUser.set(user);
      this.authReady.set(true);
    });
  }

  async signIn(): Promise<void> {
    await signInWithPopup(this.auth, new GoogleAuthProvider());
  }

  async signOut(): Promise<void> {
    await signOut(this.auth);
  }
}
