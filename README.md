# EB Sports

Your NBA and NFL apps on a Fire TV, run from the remote. College football and MLB slot in later.

## How it fits together

| Piece | What it does |
|---|---|
| `index.html` | The TV home screen: the day's games (scores hidden until you choose), RedZone, multiview and Settings. |
| `player.html` | Full screen player for a game, using the stream sources you set up. |
| `multi.html` | Multiview: up to four games at once. |
| `preview.html` | Game preview for games that haven't started. |
| `highlights.html` | ESPN highlight clips for live and finished games. |
| `tv/tv-nav.js` | The remote layer. Arrow keys move a highlight to the nearest item, Select clicks it, Back closes the top panel. The Fire TV app adds it to every page, so the NBA and NFL apps work from the remote with no changes to them. |
| `tv/common.js` | Settings, stream sources and filling in addresses, shared by the home screen and player. |
| `sources.json` | Stream sources every TV picks up. Starts empty. |
| `android/` | The Fire TV app: a full screen web view of this site, set up for the remote. |
| `.github/workflows/apk.yml` | Builds the APK whenever `android/` changes and puts it on a Release. |

The app loads these pages from GitHub Pages, so changes to the pages (and the NBA and NFL apps' data updates) reach the TV without reinstalling. The APK only needs rebuilding when something in `android/` changes.

## Phones

The same APK runs on Android phones. On a phone the app turns freely (the player and multiview turn sideways), the NBA and NFL apps run as their normal phone versions without the TV remote layer, pages use phone layouts, and a ⋯ button in the player and multiview opens the controls. In multiview, tap a game's label to give it the sound. Install it by opening the download link on the phone and allowing the browser to install apps.

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

Streams start on their own: once the player finds the video it presses play and turns the sound on, and if a player still won't start (some want their own play button clicked) the app taps the middle of it once. In the player, "Tap player" taps the middle of the screen for players that need a click to start, and "Open full page" loads a player site directly if it doesn't allow being shown inside another page.

### Remote control of embedded players (Fire TV app)
The app adds a small script (`android/app/src/main/assets/frame-control.js`) inside every embedded player. It finds the player's `<video>` (Shaka Player and most web players use one) and takes commands from the player page: play/pause, skip 10 seconds, go live, mute, fill screen and quality. Quality works when the embed uses Shaka Player or hls.js: the script finds the player behind the video and lists its qualities (Auto, 1080p, 720p…). With the controls bar closed, Select plays or pauses and left/right skip. Commands carry a key the app makes at each launch, so other pages can't drive it.

### Popups and redirects
Stream frames are not sandboxed (stream sites refuse to play in a sandboxed frame). Popups and redirects are stopped by the app instead: the frame's `window.open` does nothing, and the app drops popups, outside redirects and app links while the player or multiview is showing. In a desktop browser there's no app, so a site's ads can open popups there.

## Box score

While a game plays, press Down (or the stats button in the controls) and a box score slides in on the right, like Prime Video's: the score by quarter, team stats, and player stats with a button for each team. Up and Down scroll it, Left and Right switch teams, it updates every 15 seconds, and Back closes it. On RedZone it lists every NFL game of the day with live down and distance. In multiview, the stats button shows the selected game's box score. Data comes from ESPN's game summary (`tv/boxscore.js`).

## Previews, highlights, replays and channels

What a game's menu offers depends on where the game is:
- **Not started:** Watch game, and **Game preview** (records, time, venue and TV, the line and ESPN's win probability, season leaders, last five games, injuries, season series).
- **Live:** Watch game, **Highlights so far**, **Box score**.
- **Finished:** **Full game highlights** and, when the league posts one, **Full game replay** from YouTube (only the NBA's, the NFL's or the teams' own channels, found by the Val Town relay `elishaben/nba-youtube`), **ESPN highlight clips** (Play all runs them in game order; Up/Down change clip), **Condensed game** and **Full game replay** when a source has those addresses, **Box score**.

A game source can have `"replay"` (full game) and `"condensed"` addresses with the same codes as `"url"`, for example `"replay": "https://example.com/replay/{sport}/{homeNick}"`.

**Channels** are 24/7 streams, kept apart from game sources in `sources.json` under `"channels"`: `{ "id": "nfl-network", "name": "NFL Network", "sport": "nfl", "url": "/embed/nfl-network" }`. An address starting with `/` uses the same site as that sport's first game source; give a full address if it lives on another site. Channels show at the top of their sport every day and can go in multiview.

## Multiview and RedZone

Open a game on the home screen and choose "Add to multiview" (up to four games), then "Open multiview" or the Multiview button by the sport filters. With the options bar closed, the arrows move to a game and its sound comes with it, and Menu (☰) opens the options: add a game, switch the selected game for another, ● LIVE (jump the selected game to live) and All live, full screen (the selected game fills the screen at its best quality with the sound while the others pause; Left/Right switch games, Back returns to the grid; on a phone, double tap a game's label), layout (even grid, or one big plus the rest small), make the selected game big, fill tiles, switch source, tap video, full screen, remove. Each tile shows how far behind live it is. With 3 or more games, the games without the sound drop to about 480p and the game with the sound gets its best quality up to 1080p (a Fire TV Stick decodes about two HD streams at once); the quality follows the sound, and a quality you pick yourself for a game is kept. Sound switching, live, and fill need the Fire TV app.

On days with NFL games a RedZone card leads the NFL list. It plays from the same sources with the team codes set to `redzone`, so a `/{sport}/{homeNick}` address becomes `/nfl/redzone`. RedZone can go in multiview too.

## When a stream fails
The player and each multiview tile watch their stream. With no video after 25 seconds (after the tap the app tries), a playback error, or a picture frozen for 25 seconds while playing, it reloads the source once, or switches to the next source set up for that sport, with a short note on screen. Picking a source by hand starts the count over. Add a second source in Settings or `sources.json` for it to switch to.

## Search
🔍 Search on the home screen (or a remote's Search key) takes a team, a city or a channel, typed or spoken: "Knicks", "New York", "Chiefs game tomorrow", "RedZone", "NFL Network". It looks through yesterday, today and the next 6 days. Starting with "watch" ("watch the Jets") goes straight to a live game. Speak uses the device's speech service (phones, and Fire TVs that have one); without one, the keyboard's mic (on Fire TV, hold the remote's 🎤 while the keyboard is up) types into the box.

## Game alerts
Switched off for now (`ENABLED` in `tv/alerts.js`; the Settings section is hidden too). How they work when on:

While a game or multiview is playing, the NBA and NFL scoreboards are checked every 30 seconds (`tv/alerts.js`). A popup comes up when another live game is within 5 (NBA) or 8 (NFL) points with 5 minutes or less left in the 4th, goes to overtime, or, if turned on, an NFL team reaches the red zone. Up adds it to multiview (with 4 games up it swaps out the selected game, or the first one without the sound) and the sound moves to it; Back dismisses. Each can be turned on or off in Settings. With scores hidden, popups don't show the score.

## Adding a sport

In `index.html`, fill in the sport's `app` address (and its `link` for opening a game) in `SPORTS`. Its games then show on the home screen.

## Trying it on a computer

Open `index.html?tv=1` (or any NBA or NFL page with `tv/tv-nav.js` loaded and `?tv=1`). Arrow keys and Enter work like the remote, and Backspace stands in for Back.
