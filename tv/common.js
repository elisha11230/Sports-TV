/* Shared by the hub (index.html) and the player (player.html): settings, stream sources
   and filling in a source's address for a game. */
window.STV = (function () {
  'use strict';
  var here = (document.currentScript && document.currentScript.src) || location.href;
  var REPO_SOURCES = new URL('../sources.json', here).href;

  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  var DEFAULTS = { spoilers: true, textZoom: 100, filter: 'all' };
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
  var repoCache = null;
  function repoSources() {
    if (repoCache) return Promise.resolve(repoCache);
    return fetch(REPO_SOURCES, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : { sources: [] }; })
      .then(function (j) {
        repoCache = (j && j.sources || []).map(function (s, i) { var o = {}; for (var k in s) o[k] = s[k]; o.id = 'repo' + i; o.repo = true; return o; });
        return repoCache;
      })
      .catch(function () { repoCache = []; return repoCache; });
  }
  function usable(s) { return s && s.name && (s.type === 'app' ? !!s.pkg : !!s.url); }
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

  var slug = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); };
  var etDay = function (d) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
    catch (e) { return d.toISOString().slice(0, 10); }
  };

  applyZoom(settings().textZoom);

  return {
    store: store, settings: settings, saveSettings: saveSettings,
    localSources: localSources, saveLocalSources: saveLocalSources, repoSources: repoSources,
    sourcesFor: sourcesFor, fill: fill, slug: slug, etDay: etDay, bridge: bridge
  };
})();
