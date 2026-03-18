# Valorant Team Map Tracker

An Angular application to track your Valorant team's win/loss record across all maps.

## Features

- **Win/Loss counters** for each map with `+` and `−` buttons
- **Win rate** displayed per map and as an overall summary in the header
- **Progress bar** showing the win/loss split visually
- **Notes** section per map for strategy, agent compositions, tips, etc.
- **Reset** button to clear a single map's stats
- **Persistent storage** — data is saved in `localStorage` and survives page refresh

## Maps Tracked

Ascent, Bind, Breeze, Fracture, Haven, Icebox, Lotus, Pearl, Split, Sunset, Abyss

## Development

Install dependencies:

```bash
npm install
```

Start the local dev server:

```bash
ng serve
```

Open `http://localhost:4200/` in your browser. The app reloads automatically on file changes.

## Build

```bash
ng build
```

Output is placed in the `dist/` directory.

## Tech Stack

- Angular 21 (standalone components, signals)
- SCSS
- localStorage for persistence
