# Queuer

A small desktop Spotify client built with Angular, Tauri and Rust.

This project is not affiliated with Spotify.

## What it does

- Sign in with Spotify
- See saved songs and playlists
- Sort and expand the playlist list
- Search for songs
- Control playback, volume, shuffle and repeat
- Choose a Spotify Connect device
- Save and remove songs
- Try the app with demo tracks without signing in

## Run it

You need Node.js `22.22.3`, npm, Rust and Cargo.

```powershell
cd frontend
nvm use 22.22.3
npm ci
npm run desktop:dev
```

## Spotify setup

Create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and add this redirect URI:

```text
http://127.0.0.1:43821/callback
```

Copy the Client ID into Queuer. You do not need a Client Secret.

If the Spotify app is in Development Mode, add the accounts that will use Queuer to its allowlist. Spotify may also block tracks from playlists that the account does not own or collaborate on.

A Spotify Premium account is needed for playback.

## Checks

```powershell
cd frontend
npm run format:check
npm run test:run
npm run build
```

## Shortcuts

- `Ctrl+K` or `Cmd+K` opens search
- `/` focuses track search
- `Space` plays or pauses
- `Escape` closes the current popup

## Folders

```text
frontend/src/        Angular app
frontend/src-tauri/  Tauri and Rust code
frontend/public/     Static files
```
