# Wardrobe App

A local wardrobe, outfit, and AI stylist workspace for cataloging clothing, saving outfit logic, and generating styling feedback from the pieces you actually own.

The app is a React/Vite frontend backed by an Express server, SQLite database, local uploads folder, and optional Anthropic/OpenAI model calls.

## Features

- Wardrobe inventory with garment photos, worn photos, tags, notes, favorites, and status.
- Outfit lookbook with linked wardrobe pieces and outfit-level feedback.
- Stylist chat that can evaluate outfits, style a selected piece, compare outfits, and generate visual outfit boards.
- Visual Lab for calibration references, saved boards, and renderer feedback.
- Learning memory for stylist feedback, including signature looks, rejected directions, proportion issues, and calibration notes.
- Local-first storage through `wardrobe.db` and `uploads/`.

## Tech Stack

- React 18
- Vite
- Express
- SQLite via `better-sqlite3`
- `multer` and `sharp` for image upload/processing
- Anthropic and OpenAI SDKs for stylist and image workflows

## Getting Started

Install dependencies:

```bash
npm install
```

Create local environment variables:

```bash
cp .env.example .env
```

Start the app:

```bash
npm run dev
```

Then open:

```text
http://localhost:5173
```

The Vite dev server runs on port `5173` and proxies API/upload requests to the Express server on port `3001`.

## Environment

Default provider:

```env
AI_PROVIDER=anthropic
```

For Anthropic:

```env
ANTHROPIC_API_KEY=your_anthropic_api_key_here
ANTHROPIC_STYLIST_MODEL=claude-sonnet-4-6
```

For OpenAI:

```env
AI_PROVIDER=openai
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_STYLIST_MODEL=gpt-4o-mini
```

Optional image settings are read by the server when present, including:

```env
OPENAI_IMAGE_MODEL=
OPENAI_IMAGE_SIZE=
OPENAI_EDITORIAL_IMAGE_SIZE=
OPENAI_IDENTITY_IMAGE_SIZE=
PHOTO_PRESERVING_VISUALS=false
STYLIST_CRITIC_DISABLED=false
```

## Local Data

Runtime data is intentionally local and ignored by git:

- `wardrobe.db`
- `wardrobe.db-shm`
- `wardrobe.db-wal`
- `uploads/`
- `.env`

The server creates and migrates the SQLite schema on startup. Keep backups of `wardrobe.db` and `uploads/` together if you want to move or preserve the local wardrobe.

## Scripts

```bash
npm run dev
```

Runs the Express server and Vite dev server together.

```bash
npm run build
```

Builds the frontend with Vite.

```bash
npm start
```

Runs the Express server only. In production mode, the server serves the built `dist/` files.

## Main Workflows

Use **Wardrobe** to add and maintain pieces, including hanger and worn photos.

Use **Outfits** to save looks, link them to wardrobe pieces, and send them to the stylist.

Use **Stylist** to:

- ask general wardrobe questions
- evaluate an uploaded outfit photo
- style a selected garment with existing wardrobe pieces
- request ideal additions for a selected garment
- generate visual boards for selected outfit directions
- save feedback as learning memory

Use **Visual Lab** to review calibration references, saved boards, and upload new renderer calibration images.

## Notes

- Image generation can incur provider cost; the UI labels optional render actions before running them.
- Photos from previous chat turns are not visible to the model unless they are reattached or represented in saved app data.
- Calibration and feedback are scoped into local database tables so the stylist can learn from saved preferences without committing personal data to git.
