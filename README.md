# Valorant Team Map Tracker

A real-time, shared web application for tracking your Valorant team's win/loss record across all maps. Built with Angular 21 and Firebase.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Application Design](#application-design)
- [Authentication](#authentication)
- [Data Storage](#data-storage)
- [Deploy](#deploy)

---

## Getting Started

### Prerequisites

- Node.js 20+
- npm 11+
- A Firebase project with Firestore and Google Authentication enabled (see [Authentication](#authentication))

### Local Development

**1. Clone the repository and install dependencies:**

```bash
git clone https://github.com/<your-username>/Valorant-Team-Map-Tracker.git
cd Valorant-Team-Map-Tracker
npm install
```

**2. Create your local environment file:**

Copy the template and fill in your Firebase project credentials:

```bash
cp src/environments/environment.template.ts src/environments/environment.ts
```

Edit `src/environments/environment.ts` with your Firebase config:

```typescript
export const environment = {
  firebase: {
    apiKey: 'YOUR_API_KEY',
    authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
    storageBucket: 'YOUR_PROJECT_ID.firebasestorage.app',
    messagingSenderId: 'YOUR_MESSAGING_SENDER_ID',
    appId: 'YOUR_APP_ID',
  },
};
```

Your Firebase credentials can be found in the Firebase Console under **Project Settings → Your apps → SDK setup and configuration**.

**3. Start the dev server:**

```bash
ng serve
```

Open `http://localhost:4200` in your browser. The app reloads automatically on file changes.

### Building for Production

```bash
ng build
```

Output is placed in `dist/valorant-tracker/browser/`.

---

## Application Design

### Folder Structure

```
src/
├── app/
│   ├── app.ts                # Root component — auth routing logic
│   ├── app.html              # Root template — shows login or tracker
│   ├── app.config.ts         # Angular app config & Firebase initialization
│   ├── auth.service.ts       # Google authentication service
│   ├── map.model.ts          # MapStats interface definition
│   ├── login/
│   │   ├── login.ts          # Login screen component
│   │   ├── login.html        # Google sign-in button UI
│   │   └── login.scss        # Login styles
│   └── map-tracker/
│       ├── map-tracker.ts    # Core tracker component (state + Firestore)
│       ├── map-tracker.html  # Tracker UI (map cards, modal)
│       └── map-tracker.scss  # Tracker styles
├── environments/
│   ├── environment.ts        # Firebase config — generated at build, gitignored
│   └── environment.template.ts  # Placeholder for local setup
├── main.ts                   # Angular bootstrap entry point
├── index.html                # HTML shell
└── styles.scss               # Global styles (fonts, resets)

public/                       # Static assets served as-is
└── *.jpg                     # One background image per map

scripts/
└── generate-env.js           # CI script — writes environment.ts from secrets

.github/workflows/
└── static.yml                # GitHub Actions pipeline for GitHub Pages
```

### Component Responsibilities

**`App` (root)**
Guards the entire app based on auth state. Instead of using Angular Router, the root template uses Angular's `@if` control flow to decide what to render:

- Auth not ready yet → loading indicator
- Not logged in → `<app-login>`
- Logged in → `<app-map-tracker>`

This keeps auth logic in one place without needing route guards.

**`Login`**
Minimal component. Renders the branding and a single "Sign in with Google" button that delegates to `AuthService.signIn()`.

**`MapTracker`**
The entire feature lives here. It owns:

- All map state as Angular signals (`maps`, `loading`, `showOthers`, `notesOpenIndex`, `pendingNotes`)
- Computed values (win rates, totals, split/non-split filtered lists)
- Firestore listener (`onSnapshot`) opened in the constructor and torn down in `ngOnDestroy`
- All mutation methods (`addWin`, `addLoss`, `removeWin`, `removeLoss`, `updateNotes`)
- Notes modal open/save/close logic

Every mutation updates the local signal immediately (keeping the UI snappy) and then writes the full maps array to Firestore via `setDoc`.

**`AuthService`**
Injectable singleton that wraps Firebase Auth. Exposes two signals:

- `currentUser` — the logged-in `User` object, or `null`
- `authReady` — `true` once Firebase has resolved the initial auth state (prevents a flash of the login screen on page load)

### Data Model

```typescript
interface MapStats {
  name: string;       // Display name, e.g. "Abyss"
  image: string;      // Filename stem for the background image, e.g. "abyss"
  inSplit: boolean;   // Whether the map is in the current competitive rotation
  wins: number;
  losses: number;
  notes: string;      // Free-text strategy notes
}
```

Maps are divided into two groups in the UI:
- **Current split** — maps with `inSplit: true`, always shown
- **Other maps** — maps with `inSplit: false`, collapsed under an expandable section

The `inSplit` flag is hardcoded in `DEFAULT_MAPS` and updated each Valorant episode by editing the source.

---

## Authentication

Authentication is handled by **Firebase Authentication** using **Google Sign-In**.

### Setup (Firebase Console)

1. Go to your project in the [Firebase Console](https://console.firebase.google.com)
2. Navigate to **Authentication → Sign-in method**
3. Enable the **Google** provider
4. Under **Authentication → Settings → Authorized domains**, add:
   - `localhost` (for local development)
   - `<your-github-username>.github.io` (for the deployed app)

### How It Works

When the user clicks "Sign in with Google", `signInWithPopup` opens a Google OAuth popup. On success, Firebase stores the session and `onAuthStateChanged` fires with the authenticated user, which updates the `currentUser` signal and causes the root component to swap the login screen for the tracker.

Sessions persist across browser refreshes automatically via Firebase's local persistence.

### Access Control

There is no user-specific data — all authenticated users share the same tracker state. Access is controlled at the Firestore rules level: only signed-in users can read or write data.

**Firestore security rules:**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

These rules are set in the Firebase Console under **Firestore Database → Rules**.

---

## Data Storage

All data is stored in **Firebase Firestore** as a single shared document, giving all users a real-time view of the same state.

### Document Structure

```
Firestore
└── stats/              (collection)
    └── maps            (document)
        └── maps: [     (array field)
              { name, image, inSplit, wins, losses, notes },
              ...
            ]
```

### Real-time Sync

The `MapTracker` component opens an `onSnapshot` listener in its constructor. This listener fires:

- Once immediately on load with the current data from Firestore
- Again whenever any user modifies the document

This means any friend's win/loss update is visible to everyone else in real time without refreshing the page.

### Writes

Every mutation calls `setDoc(docRef, { maps: this.maps() })`, which overwrites the entire document with the current signal state. The local signal is updated first so the UI responds instantly.

### First-run Migration

If the Firestore document does not exist yet (first time the app is used), the tracker checks `localStorage` for data saved by a previous version of the app and migrates it to Firestore automatically. If no local data is found, it seeds from the default map list with all stats at zero.

### Free Tier

The app runs entirely on Firebase's free **Spark plan**:

| Quota | Free limit |
|---|---|
| Storage | 1 GiB |
| Reads | 50,000 / day |
| Writes | 20,000 / day |

A small group tracking map stats will use a negligible fraction of these limits.

---

## Deploy

The app is deployed to **GitHub Pages** via a GitHub Actions workflow that runs on every push to `main`.

### Pipeline Overview

`.github/workflows/static.yml`:

| Step | What it does |
|---|---|
| Checkout | Clones the repository |
| Setup Node.js 20 | Installs Node with npm cache |
| Install dependencies | Runs `npm ci` |
| Generate environment file | Writes `src/environments/environment.ts` from repository secrets |
| Build | Runs `ng build --base-href=/Valorant-Team-Map-Tracker/` |
| Upload artifact | Packages `dist/valorant-tracker/browser/` |
| Deploy to GitHub Pages | Publishes via GitHub's native Pages deployment |

### Firebase Credentials in CI

`src/environments/environment.ts` is gitignored and never committed. At build time, the CI pipeline runs `scripts/generate-env.js`, which reads the Firebase config from **GitHub repository secrets** and writes the file.

**Required secrets** (set in **Settings → Secrets and variables → Actions**):

| Secret | Value |
|---|---|
| `FIREBASE_API_KEY` | From Firebase project settings |
| `FIREBASE_AUTH_DOMAIN` | e.g. `your-project.firebaseapp.com` |
| `FIREBASE_PROJECT_ID` | e.g. `your-project` |
| `FIREBASE_STORAGE_BUCKET` | e.g. `your-project.firebasestorage.app` |
| `FIREBASE_MESSAGING_SENDER_ID` | From Firebase project settings |
| `FIREBASE_APP_ID` | From Firebase project settings |

### Enabling GitHub Pages

In your repository: **Settings → Pages → Source → GitHub Actions**.

The deployed app is available at:
```
https://<your-username>.github.io/Valorant-Team-Map-Tracker/
```

---

## Tech Stack

| Technology | Purpose |
|---|---|
| Angular 21 | UI framework (standalone components, signals) |
| Firebase Auth | Google Sign-In |
| Firebase Firestore | Real-time shared data storage |
| SCSS | Styling |
| GitHub Actions | CI/CD pipeline |
| GitHub Pages | Hosting |
