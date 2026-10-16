# Queuer

A small desktop Spotify player I made to learn Angular, Tauri and Rust. It plays your music and tries to make four "Daily Mixes" for the home screen every day.

It is not made by or connected to Spotify.

## About this version

I wrote the first version of this app myself. This commit is the big update that finally made the app usable (the Daily Mixes, the rate limit protection, the settings and the translations). For this update I used AI to help me.

## What it does

- Log in with Spotify and see your liked songs and playlists.
- Play music with volume, shuffle, repeat and choosing a device.
- Four Daily Mixes with about 50 songs each: 15 you love, 15 you rarely play and 20 you have never heard.
- A "Discovery" list (new songs from this year) and a "Releases" list (new music from artists you like).
- Search with `Ctrl+K`. When you pick a result it plays it and then adds similar songs from your own history.
- Go back and forward with mouse 4 and mouse 5. The song that is playing is highlighted.
- A demo mode, so you can try it without logging in.
- English by default, with Portuguese too (change it in the settings).
- A settings window: language, accent colour, start with Windows, and buttons to delete your imported history, clear the caches and remove your Anthropic key.

## Privacy

- Your Spotify history ZIP is read on your computer and stays there.
- Only a short summary of your taste is sent to Claude, and only if you put your own Anthropic key in the app.
- Keys are saved in the Windows credential store. They are not in the code.

## The hard part

Spotify apps in Development Mode get a very small quota. While testing, my app got blocked for about 13 hours because of a `429` error with a long `Retry-After`. So now the app:

- saves every search result for a few days,
- has a limit of searches for each refresh,
- stops sending requests as soon as Spotify says "too many",
- builds most of each mix from your listening history (exact Spotify track ids, so no search is needed),
- only asks Claude to pick numbers from a list, never to make up song names.

## Things that are not great yet

- Songs that come only from the history have no cover and no duration.
- Mix names and descriptions written by Claude are always in English, and error messages from the Rust side are in Portuguese.
- The code still has a lot of Portuguese text, because the Portuguese sentence is the key for the English translation.
- A Development Mode app only works for a few allowed users, so this is a personal project and not something to release.
- Some days a mix has 45 to 49 songs instead of 50, when not enough new music was found.
- Running all the tests at once can crash on a computer with little memory. Each group of tests passes by itself.
- I did not test the media keys on real hardware.
- Some files are big and could be split into smaller ones (for example `mix-engine.service.ts`).

## How to run it

You need Node.js `22.22.3`, npm, Rust and Cargo.

```powershell
cd frontend
nvm use 22.22.3
npm ci
npm run desktop:dev
```

## Spotify setup

Make an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and add this redirect URI:

```text
http://127.0.0.1:43821/callback
```

Paste the Client ID into Queuer. You do not need the Client Secret. You need Spotify Premium to play music.

If your Spotify app is in Development Mode, add the accounts that will use Queuer to its allowlist.

## Tests and checks

```powershell
cd frontend
npm run format:check
npm run test:run
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

## Shortcuts

- `Ctrl+K` opens search
- `/` goes to the search box
- `Space` plays or pauses
- `Escape` closes the popup
- Mouse 4 / mouse 5 or `Alt+←` / `Alt+→` go back and forward
- `Ctrl+J` jumps to the song that is playing

## Folders

```text
frontend/src/        Angular app
frontend/src-tauri/  Tauri and Rust code
frontend/public/     Static files
```

## License

MIT. See [LICENSE](LICENSE).
