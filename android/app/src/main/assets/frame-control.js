/* EB Sports: remote control for embedded players.
   The Fire TV app adds this to every frame shown inside another page. It waits for commands
   from the page above it (play/pause, skip, go live, mute, fill screen) and applies them to the
   largest <video> in the frame, which is where Shaka Player and most web players draw.
   Commands must carry the key the app made at launch, so other pages can't drive it.
   A frame without a video passes commands down to the frames inside it, and passes the
   video's status back up. */
(function () {
  if (window.top === window || window.__stvFrame) return;
  window.__stvFrame = 1;
  var KEY = '__KEY__';

  // embedded players don't get to open popups
  try {
    var noPopup = function () { return null; };
    Object.defineProperty(window, 'open', { value: noPopup, writable: false, configurable: false });
  } catch (e) { try { window.open = function () { return null; }; } catch (e2) {} }

  /* ---------- quality: find the Shaka or hls.js player behind a video ----------
     Shaka's UI hangs itself on the video (video.ui). Otherwise the players are caught as they're
     made: their prototypes are wrapped as soon as the libraries load. */
  var engines = [];
  function remember(kind, obj, how, args) {
    for (var i = 0; i < engines.length; i++) if (engines[i].obj === obj) return engines[i];
    var g = { kind: kind, obj: obj };
    engines.push(g);
    return g;
  }
  function wrap(proto, names, kind) {
    names.forEach(function (n) {
      var orig = proto && proto[n];
      if (typeof orig !== 'function' || orig.__stv) return;
      // the player is set up for a longer rewind before it loads anything
      var w = function () { var g = remember(kind, this); tune(g, n, arguments); return orig.apply(this, arguments); };
      w.__stv = 1;
      try { proto[n] = w; } catch (e) {}
    });
  }
  function hookLibs() {
    try { if (window.shaka && window.shaka.Player) wrap(window.shaka.Player.prototype, ['load', 'attach', 'getVariantTracks'], 'shaka'); } catch (e) {}
    try { if (window.Hls && window.Hls.prototype) wrap(window.Hls.prototype, ['attachMedia', 'loadSource'], 'hls'); } catch (e) {}
  }
  var hookTries = 0, hookT = setInterval(function () { hookLibs(); if (++hookTries > 150) clearInterval(hookT); }, 100);
  document.addEventListener('DOMContentLoaded', hookLibs);
  // catch the libraries the moment they load, before the page makes its player
  ['Hls', 'shaka'].forEach(function (name) {
    try {
      if (window[name]) return;
      var val;
      Object.defineProperty(window, name, {
        configurable: true, enumerable: true,
        get: function () { return val; },
        set: function (x) { val = x; Promise.resolve().then(hookLibs); }
      });
    } catch (e) {}
  });

  function engineFor(v) {
    try {
      var ui = v.ui || v['ui'];
      if (ui && ui.getControls) { var pl = ui.getControls().getPlayer(); if (pl) remember('shaka', pl); }
    } catch (e) {}
    for (var i = 0; i < engines.length; i++) {
      var g = engines[i];
      try {
        if (g.kind === 'shaka' && g.obj.getMediaElement && g.obj.getMediaElement() === v) return g;
        if (g.kind === 'hls' && g.obj.media === v) return g;
      } catch (e) {}
    }
    return null;
  }
  /* ---------- a longer rewind and pause on live streams ----------
     Many live streams list only the last minute of video, even though their servers keep the older
     pieces for a while. When the pieces are numbered in order, each list is lengthened with the
     older pieces the server still has (up to 15 minutes, found once by asking for a byte of each).
     The player also keeps what it has downloaded (up to 15 minutes back), keeps downloading while
     paused (up to 5 minutes ahead), and doesn't jump forward to live after a pause. */
  var DVR = 900;
  var rawFetch = window.fetch && window.fetch.bind(window);
  var found = {};   // playlist address -> how many older pieces the server still has (or a promise of it)

  function has(u) {
    if (!rawFetch) return Promise.resolve(false);
    var c = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { try { c && c.abort(); } catch (e) {} }, 5000);
    return rawFetch(u, { headers: { Range: 'bytes=0-0' }, signal: c ? c.signal : undefined, cache: 'no-store' })
      .then(function (r) { clearTimeout(t); try { c && c.abort(); } catch (e) {} return r.ok; })
      .catch(function () { clearTimeout(t); return false; });
  }

  // works out how the piece names count up: one number in the name that rises by the same step each piece
  function pattern(uris) {
    var parts = uris.map(function (u) { return u.split(/(\d+)/); });
    var n = parts[0].length, at = -1, step = 0;
    for (var i = 0; i < parts.length; i++) if (parts[i].length !== n) return null;
    for (var j = 1; j < n; j += 2) {
      var same = true;
      for (var k = 1; k < parts.length; k++) if (parts[k][j] !== parts[0][j]) same = false;
      if (same) continue;
      if (at >= 0) return null;   // more than one number changes: can't guess
      at = j;
    }
    for (var j2 = 0; j2 < n; j2 += 2) for (var k2 = 1; k2 < parts.length; k2++) if (parts[k2][j2] !== parts[0][j2]) return null;
    if (at < 0) return null;
    step = +parts[1][at] - +parts[0][at];
    if (!(step > 0)) return null;
    for (var k3 = 1; k3 < parts.length; k3++) if (+parts[k3][at] - +parts[k3 - 1][at] !== step) return null;
    var tok = parts[0][at], pad = tok.length > 1 && tok[0] === '0' ? tok.length : 0, first = +tok;
    return {
      first: first, step: step,
      older: function (back) {
        var v = first - back * step;
        if (v < 0) return null;
        var t = String(v);
        while (t.length < pad) t = '0' + t;
        var p = parts[0].slice(); p[at] = t;
        return p.join('');
      }
    };
  }

  function lengthen(text, url) {
    try {
      if (typeof text !== 'string' || text.indexOf('#EXTINF') < 0 || /#EXT-X-ENDLIST/.test(text)) return Promise.resolve(text);
      if (/#EXT-X-DISCONTINUITY\s*$/m.test(text) || /#EXT-X-BYTERANGE/.test(text) || (text.match(/#EXT-X-KEY/g) || []).length > 1) return Promise.resolve(text);
      var m = text.match(/#EXT-X-MEDIA-SEQUENCE:\s*(\d+)/);
      if (!m) return Promise.resolve(text);
      var seq = +m[1], lines = text.split(/\r?\n/), segs = [];
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].indexOf('#EXTINF:') !== 0) continue;
        for (var j = i + 1; j < lines.length; j++) {
          var l = lines[j].trim();
          if (l && l[0] !== '#') { segs.push({ at: i, dur: parseFloat(lines[i].slice(8)) || 0, uri: l }); break; }
        }
      }
      if (segs.length < 3) return Promise.resolve(text);
      var pat = pattern(segs.map(function (x) { return x.uri; }));
      if (!pat) return Promise.resolve(text);
      var avg = segs.reduce(function (a, x) { return a + x.dur; }, 0) / segs.length;
      if (!(avg > 0)) return Promise.resolve(text);
      var most = Math.min(Math.floor(DVR / avg), Math.floor(pat.first / pat.step), seq);
      if (most < 1) return Promise.resolve(text);
      var key = String(url).split('?')[0];
      var abs = function (back) { try { return new URL(pat.older(back), url).href; } catch (e) { return null; } };
      if (found[key] == null) {
        // the furthest piece back the server still has, by halving: about 8 quick requests, once
        found[key] = has(abs(most)).then(function (ok) {
          if (ok) return most;
          return has(abs(1)).then(function (ok1) {
            if (!ok1) return 0;
            var lo = 1, hi = most;
            var step = function () {
              if (hi - lo <= 1) return lo;
              var mid = (lo + hi) >> 1;
              return has(abs(mid)).then(function (ok2) { if (ok2) lo = mid; else hi = mid; return step(); });
            };
            return step();
          });
        }).then(function (n) { found[key] = n; return n; }, function () { found[key] = 0; return 0; });
      }
      return Promise.resolve(found[key]).then(function (n) {
        n = Math.min(n, most);
        if (!n) return text;
        var add = [];
        for (var b = n; b >= 1; b--) { var u = pat.older(b); if (u) add.push('#EXTINF:' + avg.toFixed(3) + ',', u); }
        var at = segs[0].at;
        while (at > 0 && /^#EXT-X-PROGRAM-DATE-TIME/.test(lines[at - 1])) at--;
        var out = lines.slice(0, at).concat(add, lines.slice(at)).join('\n');
        return out.replace(/#EXT-X-MEDIA-SEQUENCE:\s*\d+/, '#EXT-X-MEDIA-SEQUENCE:' + (seq - add.length / 2));
      });
    } catch (e) { return Promise.resolve(text); }
  }

  function isDash(u, type) { return /\.mpd(\?|$)/i.test(String(u || '')) || /dash/i.test(String(type || '')); }

  function tune(g, how, args) {
    if (!g) return;
    try {
      if (g.kind === 'shaka') {
        var pl = g.obj;
        var conf = { streaming: { bufferBehind: DVR, bufferingGoal: 300 } };
        // DASH lists can be told to reach further back; HLS lists are lengthened below instead
        if (how === 'load' && args && isDash(args[0], args[2])) conf.manifest = { availabilityWindowOverride: DVR };
        if (!g.tuned || conf.manifest) pl.configure(conf);
        var ne = pl.getNetworkingEngine && pl.getNetworkingEngine();
        if (ne && ne !== g.ne) {
          g.ne = ne;
          ne.registerResponseFilter(function (type, resp) {
            if (type !== 0 || !resp || !resp.data) return;   // 0: playlists
            var txt;
            try { txt = new TextDecoder().decode(resp.data); } catch (e) { return; }
            if (txt.indexOf('#EXTINF') < 0) return;
            return lengthen(txt, resp.uri).then(function (t) { if (t !== txt) resp.data = new TextEncoder().encode(t).buffer; });
          });
        }
      } else if (g.kind === 'hls') {
        var c = g.obj.config;
        if (!g.tuned) {
          c.backBufferLength = DVR;
          c.maxBufferLength = 300;
          c.maxMaxBufferLength = 600;
          // don't snap forward to live after a pause
          c.liveMaxLatencyDurationCount = Infinity;
          c.liveMaxLatencyDuration = Infinity;
          var Base = c.pLoader || c.loader;
          if (Base && !Base.__stv) {
            var L = function (cfg) { this.inner = new Base(cfg); };
            L.__stv = 1;
            Object.defineProperty(L.prototype, 'stats', { get: function () { return this.inner.stats; } });
            Object.defineProperty(L.prototype, 'context', { get: function () { return this.inner.context; } });
            L.prototype.load = function (ctx, conf2, cbs) {
              var self = this, ok = cbs.onSuccess, mine = {};
              for (var k in cbs) mine[k] = cbs[k];
              self.gone = false;
              mine.onSuccess = function (resp, stats, ctx2, net) {
                if (!resp || typeof resp.data !== 'string') return ok(resp, stats, ctx2, net);
                lengthen(resp.data, resp.url || ctx.url).then(function (t) { if (self.gone) return; resp.data = t; ok(resp, stats, ctx2, net); });
              };
              this.inner.load(ctx, conf2, mine);
            };
            L.prototype.abort = function () { this.gone = true; this.inner.abort(); };
            L.prototype.destroy = function () { this.gone = true; this.inner.destroy(); };
            L.prototype.getCacheAge = function () { return this.inner.getCacheAge ? this.inner.getCacheAge() : null; };
            L.prototype.getResponseHeader = function (n) { return this.inner.getResponseHeader ? this.inner.getResponseHeader(n) : null; };
            c.pLoader = L;
          }
        }
      }
      g.tuned = true;
    } catch (e) {}
  }

  function qualities(v) {
    var g = engineFor(v);
    if (!g) return null;
    if (!g.tuned) tune(g);
    try {
      if (g.kind === 'shaka') {
        var tracks = g.obj.getVariantTracks(), seen = {}, list = [], active = null;
        tracks.forEach(function (t) { if (t.active) active = t; });
        tracks.forEach(function (t) {
          if (!t.height || seen[t.height]) return;
          if (active && active.language && t.language !== active.language) return;
          seen[t.height] = 1; list.push({ id: String(t.height), label: t.height + 'p' });
        });
        list.sort(function (a, b) { return b.id - a.id; });
        var auto = !!(g.obj.getConfiguration().abr || {}).enabled;
        return { list: list, cur: auto ? 'auto' : (active && active.height ? String(active.height) : 'auto'), now: active && active.height ? active.height + 'p' : '' };
      }
      if (g.kind === 'hls') {
        var lv = g.obj.levels || [], out = [], seen2 = {};
        lv.forEach(function (l, i) { if (l.height && !seen2[l.height]) { seen2[l.height] = 1; out.push({ id: String(i), label: l.height + 'p', h: l.height }); } });
        out.sort(function (a, b) { return b.h - a.h; });
        var curL = lv[g.obj.currentLevel];
        return { list: out, cur: g.obj.autoLevelEnabled ? 'auto' : String(g.obj.currentLevel), now: curL && curL.height ? curL.height + 'p' : '' };
      }
    } catch (e) {}
    return null;
  }
  function setQuality(v, id) {
    var g = engineFor(v);
    if (!g) return;
    try {
      if (g.kind === 'shaka') {
        if (id === 'auto') { g.obj.configure({ abr: { enabled: true } }); return; }
        var tracks = g.obj.getVariantTracks(), active = null, pick = null;
        tracks.forEach(function (t) { if (t.active) active = t; });
        tracks.forEach(function (t) {
          if (String(t.height) !== String(id)) return;
          if (active && t.language !== active.language) return;
          if (!pick || (active && t.audioId === active.audioId) || t.bandwidth > pick.bandwidth) pick = t;
        });
        if (pick) { g.obj.configure({ abr: { enabled: false } }); g.obj.selectVariantTrack(pick, true); }
      } else if (g.kind === 'hls') {
        g.obj.currentLevel = id === 'auto' ? -1 : +id;
      }
    } catch (e) {}
  }

  function videos(root, out, depth) {
    var list = root.querySelectorAll('video');
    for (var i = 0; i < list.length; i++) out.push(list[i]);
    if (!out.length && depth < 3) {
      // some players draw inside a shadow root
      var all = root.querySelectorAll('*');
      for (var j = 0; j < all.length; j++) if (all[j].shadowRoot) videos(all[j].shadowRoot, out, depth + 1);
    }
    return out;
  }
  function best() {
    var list = videos(document, [], 0), b = null, ba = -1;
    for (var i = 0; i < list.length; i++) {
      var v = list[i], r = v.getBoundingClientRect(), a = r.width * r.height;
      if (!v.paused) a *= 4;
      if (v.readyState > 0) a *= 2;
      if (a > ba) { ba = a; b = v; }
    }
    return b;
  }
  function edges(v) {
    // hls.js keeps the start of a live stream at 0 even after old pieces drop off, so use its list
    try {
      var g = engineFor(v);
      if (g && g.kind === 'hls') {
        var lv = g.obj.levels && g.obj.levels[g.obj.currentLevel >= 0 ? g.obj.currentLevel : 0], d = lv && lv.details;
        if (d && d.live && d.fragments && d.fragments.length) return [d.fragments[0].start, d.edge || d.fragments[d.fragments.length - 1].end];
      }
    } catch (e) {}
    var s = v.seekable;
    if (s && s.length) return [s.start(0), s.end(s.length - 1)];
    return [0, isFinite(v.duration) ? v.duration : v.currentTime];
  }

  var filled = null, savedStyle = '';
  function fill(v, on) {
    if (on) {
      if (filled === v) return;
      if (filled) fill(filled, false);
      filled = v; savedStyle = v.getAttribute('style') || '';
      v.style.cssText += ';position:fixed!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;' +
        'max-width:none!important;max-height:none!important;z-index:2147483647!important;background:#000!important;' +
        'object-fit:contain!important;transform:none!important;margin:0!important';
    } else if (filled) {
      filled.setAttribute('style', savedStyle);
      filled = null;
    }
  }

  // hls.js can give a live stream a normal length, so ask the player itself
  function engineLive(v) {
    var g = engineFor(v);
    if (!g) return false;
    try {
      if (g.kind === 'shaka') return !!g.obj.isLive();
      if (g.kind === 'hls') {
        var lv = g.obj.levels && g.obj.levels[g.obj.currentLevel >= 0 ? g.obj.currentLevel : 0];
        return !!(lv && lv.details && lv.details.live);
      }
    } catch (e) {}
    return false;
  }

  function status(v) {
    if (!v) return { has: false };
    var e = edges(v), live = !isFinite(v.duration) || v.duration > 86400 || engineLive(v);
    return { has: true, paused: v.paused, muted: v.muted, t: v.currentTime, d: live ? null : v.duration,
             live: live, behind: live ? Math.max(0, e[1] - v.currentTime) : 0, filled: filled === v, q: qualities(v) };
  }

  function run(c, v) {
    switch (c.a) {
      case 'playpause': if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } else v.pause(); break;
      case 'play': { var p2 = v.play(); if (p2 && p2.catch) p2.catch(function () {}); break; }
      case 'pause': v.pause(); break;
      case 'seek': {
        var e = edges(v), t = v.currentTime + (+c.v || 0);
        v.currentTime = Math.max(e[0], Math.min(e[1] - 1, t));
        break;
      }
      case 'live': { var e2 = edges(v); v.currentTime = Math.max(e2[0], e2[1] - 3); var p3 = v.play(); if (p3 && p3.catch) p3.catch(function () {}); break; }
      // with a value these set the state; without one they flip it
      case 'mute': v.muted = typeof c.v === 'boolean' ? c.v : !v.muted; break;
      case 'fill': fill(v, typeof c.v === 'boolean' ? c.v : filled !== v); break;
      case 'quality': setQuality(v, String(c.v)); break;
      case 'status': break;
    }
  }

  function reply(s) { try { window.parent.postMessage({ stv: 'status', key: KEY, s: s }, '*'); } catch (e) {} }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object' || d.key !== KEY) return;
    if (d.stv === 'cmd' && e.source === window.parent) {
      var v = best();
      if (v) {
        try { run(d, v); } catch (x) {}
        setTimeout(function () { reply(status(v)); }, d.a === 'quality' ? 600 : 150);
      } else {
        var fr = document.querySelectorAll('iframe,frame');
        if (!fr.length) reply({ has: false });
        for (var i = 0; i < fr.length; i++) { try { fr[i].contentWindow.postMessage(d, '*'); } catch (x) {} }
      }
    } else if (d.stv === 'status' && e.source !== window.parent) {
      // a video further down answered; send it up toward the player page
      if (d.s && d.s.has) {
        // when that video fills its frame, stretch the frame holding it over this page too
        var fr2 = document.querySelectorAll('iframe,frame');
        for (var j = 0; j < fr2.length; j++) if (fr2[j].contentWindow === e.source) { fill(fr2[j], !!d.s.filled); break; }
        reply(d.s);
      }
    }
  });
})();
