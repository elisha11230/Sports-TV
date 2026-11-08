/* Shared by the hub (index.html) and the player (player.html): settings, stream sources
   and filling in a source's address for a game. */
window.STV = (function () {
  'use strict';
  var here = (document.currentScript && document.currentScript.src) || location.href;
  var REPO_SOURCES = new URL('../sources.json', here).href;

  /* ---------- TV or phone ----------
     The app says which it is; in a browser, a touch screen counts as a phone. Pages style themselves
     with html.dev-tv / html.dev-phone. */
  var DEVICE = window.__STV_DEVICE || (/SportsTV\/\S+ Phone/.test(navigator.userAgent) ? 'phone'
    : /SportsTV\//.test(navigator.userAgent) ? 'tv'
    : (window.matchMedia && matchMedia('(pointer: coarse)').matches ? 'phone' : 'tv'));
  document.documentElement.classList.add('dev-' + DEVICE);

  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  var DEFAULTS = { spoilers: true, textZoom: 100, filter: 'all', alerts: { close: true, ot: true, rz: false } };
  function settings() { var s = store.get('stv.settings', {}); var o = {}; for (var k in DEFAULTS) o[k] = DEFAULTS[k]; for (var j in s) o[j] = s[j]; return o; }
  function saveSettings(s) { store.set('stv.settings', s); applyZoom(s.textZoom); }

  /* ---------- the Fire TV app ----------
     The app gives the sports site (and only it) a window.SportsTV channel. Each call returns a
     promise; in a normal browser there is no app and every call resolves to null. */
  var bridge = (function () {
    var ch = window.SportsTV && typeof window.SportsTV.postMessage === 'function' ? window.SportsTV : null;
    var legacy = window.SportsTVLegacy || null;
    if (!ch && !legacy) return null;
    var pending = {}, seq = 0;
    if (ch) {
      var onMsg = function (e) {
        var d; try { d = JSON.parse(e.data); } catch (x) { return; }
        var done = pending[d.id]; if (done) { delete pending[d.id]; done(d.r); }
      };
      if (ch.addEventListener) ch.addEventListener('message', onMsg); else ch.onmessage = onMsg;
    }
    function call(m) {
      var a = Array.prototype.slice.call(arguments, 1);
      if (ch) return new Promise(function (ok) {
        var id = ++seq; pending[id] = ok;
        ch.postMessage(JSON.stringify({ id: id, m: m, a: a }));
        setTimeout(function () { if (pending[id]) { delete pending[id]; ok(null); } }, 5000);
      });
      try { return Promise.resolve(JSON.parse(legacy.call(JSON.stringify({ id: 0, m: m, a: a }))).r); }
      catch (e) { return Promise.resolve(null); }
    }
    return { call: call };
  })();
  function applyZoom(z) { if (bridge) bridge.call('setTextZoom', z | 0); }

  /* ---------- stream sources ----------
     A source is { id, name, sport: 'all'|'nba'|'nfl'..., type: 'embed'|'video'|'app', url, pkg, codes }
     Sources come from two places: sources.json in the repo (edit it on GitHub, every TV picks
     it up) and the ones added on the TV in Settings (kept on that TV only). */
  function localSources() { return store.get('stv.sources', []); }
  function saveLocalSources(list) { store.set('stv.sources', list); }
  var repoCache = null, repoChannels = [];
  function repoSources() {
    if (repoCache) return Promise.resolve(repoCache);
    return fetch(REPO_SOURCES, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : { sources: [] }; })
      .then(function (j) {
        repoCache = (j && j.sources || []).map(function (s, i) { var o = {}; for (var k in s) o[k] = s[k]; o.id = 'repo' + i; o.repo = true; return o; });
        repoChannels = (j && j.channels || []).slice();
        return repoCache;
      })
      .catch(function () { repoCache = []; return repoCache; });
  }

  /* ---------- 24/7 channels (NFL Network…), separate from game sources ----------
     { id, name, sport, url } in sources.json "channels". An address starting with / is on the
     same site as the first game source for that sport. */
  function channels(sport) {
    return repoSources().then(function (srcs) {
      return repoChannels.filter(function (c) { return c && c.name && c.url && (!sport || c.sport === sport); }).map(function (c) {
        var url = c.url;
        if (url.charAt(0) === '/') {
          var base = srcs.concat(localSources()).filter(function (s) { return usable(s) && s.type !== 'app' && (!s.sport || s.sport === 'all' || s.sport === c.sport); })[0];
          if (!base) return null;
          try { url = new URL(url, base.url.replace(/\{\w+\}/g, 'x')).href; } catch (e) { return null; }
        }
        if (/YOUR-SITE/i.test(url)) return null;
        return { id: 'ch-' + (c.id || slug(c.name)), name: c.name, sport: c.sport, type: 'embed', url: url, sandbox: c.sandbox };
      }).filter(Boolean);
    });
  }
  // an address still holding the YOUR-SITE placeholder isn't set up yet, so it stays hidden
  function usable(s) { return s && s.name && (s.type === 'app' ? !!s.pkg : !!s.url && !/YOUR-SITE/i.test(s.url)); }
  // sources for a game; a channel (game.channel) plays its own address instead
  function streamsFor(g) {
    if (g && g.channel) return channels(g.sport).then(function (l) { return l.filter(function (c) { return c.id === g.channel; }); });
    return sourcesFor(g && g.sport).then(function (l) {
      l = l.filter(function (s) { return s.type !== 'app'; });
      // replays: "replay" for the full game, "condensed" for the condensed game
      var field = g && g.replay ? (g.replay === 'condensed' ? 'condensed' : 'replay') : null;
      if (field) l = l.filter(function (s) { return s[field]; }).map(function (s) { var o = {}; for (var k in s) o[k] = s[k]; o.url = s[field]; return o; });
      return l;
    });
  }
  function sourcesFor(sport) {
    return repoSources().then(function (repo) {
      return repo.concat(localSources()).filter(function (s) {
        return usable(s) && (!sport || !s.sport || s.sport === 'all' || s.sport === sport);
      });
    });
  }

  /* ---------- a source's address for one game ----------
     {date} 2026-11-08 (New York date)   {yyyymmdd} 20261108   {gameId} ESPN game id   {sport} nba
     {away} {home} team codes, lower case (nyk, bos)   {AWAY} {HOME} upper case
     {awayNick} {homeNick} knicks, trail-blazers       {awayName} {homeName} new-york-knicks
     A source can map codes with "codes": { "NY": "nyk" } when a site spells a team differently. */
  function fill(tpl, g, codes) {
    return String(tpl || '').replace(/\{(\w+)\}/g, function (m, k) {
      if ((k === 'away' || k === 'home') && codes) {
        var up = g[k.toUpperCase()];
        if (up && codes[up]) return codes[up];
      }
      var v = g[k];
      return v == null ? m : encodeURIComponent(String(v)).replace(/%2F/g, '/');
    });
  }

  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  var etDay = function (d) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
    catch (e) { return d.toISOString().slice(0, 10); }
  };

  /* ---------- small line icons for the player bars ---------- */
  var ICONS = {
    play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
    back10: '<path d="M11 4 7 7.5l4 3.5"/><path d="M7.5 7.5H13a6.5 6.5 0 1 1-6.5 6.5"/><text x="13" y="17.3" font-size="6.5" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">10</text>',
    fwd10: '<path d="M13 4l4 3.5-4 3.5"/><path d="M16.5 7.5H11a6.5 6.5 0 1 0 6.5 6.5"/><text x="11" y="17.3" font-size="6.5" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">10</text>',
    start: '<path d="M6 5.5v13" stroke-width="2.2"/><path d="M18.5 5.5v13L8.5 12z" fill="currentColor" stroke="none"/>',
    back60: '<path d="M11.5 4.5 5 9l6.5 4.5zM19 4.5 12.5 9l6.5 4.5z" fill="currentColor" stroke="none"/><text x="12" y="21.5" font-size="7.5" font-weight="800" text-anchor="middle" fill="currentColor" stroke="none">1m</text>',
    fwd60: '<path d="M12.5 4.5 19 9l-6.5 4.5zM5 4.5 11.5 9 5 13.5z" fill="currentColor" stroke="none"/><text x="12" y="21.5" font-size="7.5" font-weight="800" text-anchor="middle" fill="currentColor" stroke="none">1m</text>',
    sound: '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z" fill="currentColor" stroke="none"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    muted: '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z" fill="currentColor" stroke="none"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5"/>',
    fill: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    tap: '<circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="7.5"/>',
    open: '<path d="M14 4h6v6M20 4l-8.5 8.5"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
    back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.2"/><rect x="13" y="4" width="7" height="7" rx="1.2"/><rect x="4" y="13" width="7" height="7" rx="1.2"/><rect x="13" y="13" width="7" height="7" rx="1.2"/>',
    focus: '<rect x="3.5" y="5" width="11" height="14" rx="1.2"/><rect x="16.5" y="5" width="4" height="6" rx="1"/><rect x="16.5" y="13" width="4" height="6" rx="1"/>',
    big: '<rect x="3.5" y="5" width="11" height="14" rx="1.2" fill="currentColor" fill-opacity=".35"/><rect x="16.5" y="5" width="4" height="6" rx="1"/><rect x="16.5" y="13" width="4" height="6" rx="1"/>',
    tv: '<rect x="3.5" y="5" width="17" height="11.5" rx="1.5"/><path d="M9 20h6"/>',
    remove: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    stats: '<path d="M5 20V11M10 20V5M15 20v-7M20 20V8"/>',
    add: '<path d="M12 5v14M5 12h14"/>',
    swap: '<path d="M7 7h12l-3.5-3.5M17 17H5l3.5 3.5"/>'
  };
  /* the game info the player and multiview use, from an ESPN scoreboard event */
  function vars(ev, sport) {
    var c = ev.competitions[0], cs = c.competitors.slice().sort(function (x, y) { return (x.homeAway === 'home') - (y.homeAway === 'home'); });
    var a = cs[0].team || {}, h = cs[1].team || {}, etd = etDay(new Date(ev.date));
    return { sport: sport, gameId: ev.id, date: etd, yyyymmdd: etd.replace(/-/g, ''),
      away: (a.abbreviation || '').toLowerCase(), home: (h.abbreviation || '').toLowerCase(), AWAY: a.abbreviation, HOME: h.abbreviation,
      awayNick: slug(a.name || a.shortDisplayName), homeNick: slug(h.name || h.shortDisplayName),
      awayName: slug(a.displayName), homeName: slug(h.displayName),
      title: a.abbreviation + ' at ' + h.abbreviation, key: sport + ':' + ev.id };
  }

  function icon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }

  applyZoom(settings().textZoom);

  return {
    store: store, settings: settings, saveSettings: saveSettings,
    localSources: localSources, saveLocalSources: saveLocalSources, repoSources: repoSources,
    device: DEVICE, phone: DEVICE === 'phone', sourcesFor: sourcesFor, streamsFor: streamsFor, channels: channels, fill: fill, slug: slug, etDay: etDay, bridge: bridge, icon: icon, vars: vars
  };
})();
