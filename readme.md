# MyVault — Your Personal File Space

A personal cloud file manager. Open it from any browser, enter your password, and upload/download/organize your files.

**Made with ❤️ by [sanchitbuilds.com](https://sanchitbuilds.com)**

## Why

When you're on a shared/college computer and need a file from your phone, you shouldn't have to connect your phone to the PC. Open MyVault, enter your password, grab your files, log out.

## Technologies

- HTML5 + CSS3 + Vanilla JavaScript (frontend)
- Node.js + Express (backend)
- Local filesystem storage for uploaded files (with metadata in JSON)
- `multer` for uploads, `archiver` for folder ZIP downloads, `cookie-parser` for sessions

No React, no Tailwind, no build step. Just four source files.

## Project structure

```
MyVault/
├── index.html      # Login screen + dashboard markup
├── style.css       # All styling (dark/light themes, responsive)
├── script.js       # All frontend logic
├── server.js       # All backend logic + APIs
├── package.json
├── .env            # local config (not committed)
├── .env.example    # template
└── README.md
```

Uploaded files and metadata are stored in a `vault-data/` directory created at runtime.

## Installation

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## Password

The default password is `12345`. Change it by editing `VITE_VAULT_PASSWORD` in `.env`.

The password is checked by the backend — it is never shipped to the frontend.

## Sessions

Sessions last 24 hours. The session token is stored in an HTTP-only cookie. After expiry you must log in again.

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | Server port | `3000` |
| `VITE_VAULT_PASSWORD` | Vault password | `12345` |
| `SESSION_SECRET` | Cookie signing secret | required |
| `STORAGE_LIMIT` | Total storage in bytes | `10737418240` (10GB) |
| `MAX_FILE_SIZE` | Max upload size in bytes | `524288000` (500MB) |

## Local development

```bash
npm install
npm start
```

The server serves `index.html`, `style.css`, and `script.js` statically, and exposes the API under `/api/*`.

## Deployment (Render)

1. Push this repo to GitHub.
2. Create a new Web Service on Render, pointing at the repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Add the environment variables from `.env.example` in the Render dashboard.

Note: Render's local filesystem is ephemeral, so uploaded files may not persist across deploys. For permanent storage, mount a persistent disk or wire up an external object store.

## File storage architecture

- Uploaded files are written to `vault-data/files/` with a random safe ID.
- Metadata (name, size, type, folder, dates, favorite, trash state, share links) is kept in `vault-data/meta.json`.
- Activity is logged in `vault-data/activity.json`.
- Original filenames are preserved as metadata only — internal IDs are used on disk.

## Security

- Backend password check (never exposed to the frontend bundle)
- HTTP-only, signed session cookies with 24h expiry
- Path traversal protection on all file/folder operations
- Random unguessable internal IDs for files and share tokens
- File extension + size validation on upload
- No internal storage paths ever returned to the client
- Rate limiting on the login endpoint

## 24-hour session behavior

On login, a 24h session is created. The dashboard shows a live countdown. When it expires, the next API call returns 401 and the app returns to the login screen.
