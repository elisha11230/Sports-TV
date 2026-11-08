# EB Sports

Your NBA and NFL apps on a Fire TV, run from the remote. College football and MLB slot in later.

## How it fits together

| Piece | What it does |
|---|---|
| `index.html` | The TV home screen: a tile for each sport, the day's games (scores hidden until you choose), and Settings. |
| `player.html` | Full screen player for a game, using the stream sources you set up. |
| `multi.html` | Multiview: up to four games at once. |
| `tv/tv-nav.js` | The remote layer. Arrow keys move a highlight to the nearest item, Select clicks it, Back closes the top panel. The Fire TV app adds it to every page, so the NBA and NFL apps work from the remote with no changes to them. |
| `tv/common.js` | Settings, stream sources and filling in addresses, shared by the home screen and player. |
| `sources.json` | Stream sources every TV picks up. Starts empty. |
| `android/` | The Fire TV app: a full screen web view of this site, set up for the remote. |
| `.github/workflows/apk.yml` | Builds the APK whenever `android/` changes and puts it on a Release. |

The app loads these pages from GitHub Pages, so changes to the pages (and the NBA and NFL apps' data updates) reach the TV without reinstalling. The APK only needs rebuilding when something in `android/` changes.

## One time setup

1. **GitHub Pages:** repo Settings, Pages, deploy from the `main` branch, `/ (root)`. The site lives at `https://elisha11230.github.io/Sports-TV/`.
2. **Signing key secrets** (Settings, Secrets and variables, Actions): `STV_KEYSTORE_B64` (the key file as base64) and `STV_KEYSTORE_PASSWORD`. Every build is signed with this key so new versions install over the old one. Keep a copy of the key file somewhere safe; without it, updating means uninstalling first.
3. **Build:** push anything in `android/`, or run "Build the Fire TV app" from the Actions tab.

## Installing on the Fire TV

1. Settings, My Fire TV, About: press Select on the device name 7 times to turn on Developer Options.
2. Settings, My Fire TV, Developer Options: turn on installing unknown apps for **Downloader**.
3. Install **Downloader** from the Amazon app store and enter:
   `https://github.com/elisha11230/Sports-TV/releases/latest/download/EBSports.apk`
4. Install, then open **EB SPORTS** from Your Apps. Updates install the same way.

Note: Fire TV devices that run Vega OS (such as the Fire TV Stick 4K Select) don't run Android apps. Any Fire TV on Fire OS does.

## Updates

Changes to the pages (home screen, player, multiview, remote layer) reach the TV on their own. Changes to the Android app are offered by the app itself: a little after launch, and every 6 hours while it's open, it checks for a newer release and asks to update. Choose Update, then Install. The first time, Fire TV asks you to allow EB Sports to install apps (Settings → My Fire TV → Developer Options → Install unknown apps → EB Sports). Settings on the home screen also has "Check for updates".

## The remote

| Button | What it does |
|---|---|
| Arrows | Move the highlight |
| Select | Click |
| Back | Close the top panel or player card, then go back a page. Twice on the home screen exits. |
| Menu (☰) | Show or hide the player's controls |
| Play/Pause, Rewind, Fast forward | Control a playing video |

## Stream sources

Add them on the TV (Settings, Stream sources) or in `sources.json`:

```json
{
  "sources": [
    { "name": "My player", "sport": "nba", "type": "embed", "url": "https://example.com/watch/{date}/{away}-{home}" },
    { "name": "My stream", "sport": "all", "type": "video", "url": "https://example.com/live/{gameId}.m3u8" },
    { "name": "League app", "sport": "nba", "type": "app", "pkg": "com.example.app" }
  ]
}
```

- `type`: `embed` shows a web page player full screen, `video` plays an HLS (`.m3u8`) or MP4 address directly, `app` opens an installed app.
- `sport`: `nba`, `nfl` or `all`.
- Codes filled in per game: `{date}` (2026-11-08, New York date), `{yyyymmdd}`, `{gameId}` (ESPN), `{away}` `{home}` (lower case team codes), `{AWAY}` `{HOME}`, `{awayNick}` `{homeNick}` (knicks, trail-blazers), `{awayName}` `{homeName}` (new-york-knicks).
- `codes` (optional) renames teams for one source: `"codes": { "NY": "nyk", "GS": "gsw" }`.

In the player, "Tap player" taps the middle of the screen for players that need a click to start, and "Open full page" loads a player site directly if it doesn't allow being shown inside another page.

### Remote control of embedded players (Fire TV app)
The app adds a small script (`android/app/src/main/assets/frame-control.js`) inside every embedded player. It finds the player's `<video>` (Shaka Player and most web players use one) and takes commands from the player page: play/pause, skip 10 seconds, go live, mute, fill screen and quality. Quality works when the embed uses Shaka Player or hls.js: the script finds the player behind the video and lists its qualities (Auto, 1080p, 720p…). With the controls bar closed, Select plays or pauses and left/right skip. Commands carry a key the app makes at each launch, so other pages can't drive it.

### Popups and redirects
Embedded players can't open popups or send the app to another site: the frame runs sandboxed, its `window.open` does nothing, and the app itself drops popups and outside redirects while the player page is showing. If a player refuses to load sandboxed, set `"sandbox": false` on that source (or choose "Allow" in the source's settings on the TV).

## Multiview and RedZone

Open a game on the home screen and choose "Add to multiview" (up to four games), then "Open multiview" or the Multiview button by the sport filters. With the options bar closed, the arrows pick a game, Select moves the sound to it, and Menu (☰) opens the options: layout (even grid, or one big plus the rest small), make the selected game big, fill tiles, switch source, tap video, full screen, remove. Sound switching and fill need the Fire TV app.

On days with NFL games a RedZone card leads the NFL list. It plays from the same sources with the team codes set to `redzone`, so a `/{sport}/{homeNick}` address becomes `/nfl/redzone`. RedZone can go in multiview too.

## Adding a sport

In `index.html`, fill in the sport's `app` address (and its `link` for opening a game) in `SPORTS`. Its tile turns on and its games show on the home screen.

## Trying it on a computer

Open `index.html?tv=1` (or any NBA or NFL page with `tv/tv-nav.js` loaded and `?tv=1`). Arrow keys and Enter work like the remote, and Backspace stands in for Back.
