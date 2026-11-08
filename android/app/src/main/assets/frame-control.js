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
    try { INFO.kind = kind === 'hls' ? 'hls.js' : 'Shaka'; } catch (e) {}
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
     older pieces the server still has (up to 5 hours, so a whole game, found once by asking for a byte of a few).
     The player also keeps what it has downloaded (up to 15 minutes back), keeps downloading while
     paused (up to 5 minutes ahead), and doesn't jump forward to live after a pause. */
  var DVR = 900;          // how much already watched video is kept in memory
  var REACH = 5 * 3600;   // how far back a live list can be lengthened
  var rawFetch = window.fetch && window.fetch.bind(window);
  var found = {};   // playlist address -> how many older pieces the server still has (or a promise of it)

  // what the rewind finder saw, shown in the player bar so a stream that won't rewind can be explained
  var INFO = { lists: 0, why: 'none', back: 0, sample: '', code: '' };

  // does the server still have this piece? asks for one byte, or for the headers only if that's refused
  function has(u) {
    if (!rawFetch || !u) return Promise.resolve(false);
    var once = function (headers) {
      var c = window.AbortController ? new AbortController() : null;
      var t = setTimeout(function () { try { c && c.abort(); } catch (e) {} }, 5000);
      return rawFetch(u, { headers: headers, signal: c ? c.signal : undefined, cache: 'no-store', credentials: 'same-origin' })
        .then(function (r) { clearTimeout(t); try { c && c.abort(); } catch (e) {} INFO.code = String(r.status); return r.ok; },
              function (e) { clearTimeout(t); INFO.code = 'blocked'; throw e; });
    };
    return once({ Range: 'bytes=0-0' }).catch(function () { return once({}); }).catch(function () { return false; });
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

  var MARK = '#STV-LONGER';   // a comment line; players skip it. Stops a list being lengthened twice

  // reads a live list; returns what's needed to lengthen it, or null (with the reason in INFO)
  function prep(text, url) {
    if (typeof text !== 'string' || text.indexOf('#EXTINF') < 0) return null;
    if (text.indexOf(MARK) >= 0) return null;
    INFO.lists++;
    if (/#EXT-X-ENDLIST/.test(text)) { INFO.why = 'ended'; INFO.live = false; return null; }
    INFO.live = true;
    if (/#EXT-X-DISCONTINUITY\s*$/m.test(text) || /#EXT-X-BYTERANGE/.test(text) || (text.match(/#EXT-X-KEY/g) || []).length > 1) { INFO.why = 'format'; return null; }
    var m = text.match(/#EXT-X-MEDIA-SEQUENCE:\s*(\d+)/);
    var seq = m ? +m[1] : 0, lines = text.split(/\r?\n/), segs = [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('#EXTINF:') !== 0) continue;
      for (var j = i + 1; j < lines.length; j++) {
        var l = lines[j].trim();
        if (l && l[0] !== '#') { segs.push({ at: i, dur: parseFloat(lines[i].slice(8)) || 0, uri: l }); break; }
      }
    }
    if (segs.length < 3) { INFO.why = 'short'; return null; }
    var pat = pattern(segs.map(function (x) { return x.uri; }));
    if (!pat) {
      INFO.why = 'names';
      INFO.sample = segs.slice(-2).map(function (x) { return x.uri.split('/').pop().slice(-48); }).join('  ');
      return null;
    }
    var avg = segs.reduce(function (a2, x) { return a2 + x.dur; }, 0) / segs.length;
    if (!(avg > 0)) { INFO.why = 'format'; return null; }
    var most = Math.min(Math.floor(REACH / avg), Math.floor(pat.first / pat.step), m ? seq : Infinity);
    if (most < 1) { INFO.why = 'server'; return null; }
    return { text: text, url: url, seq: seq, hasSeq: !!m, lines: lines, segs: segs, pat: pat, avg: avg, most: most, key: String(url).split('?')[0] };
  }

  function abs(P, back) { var u = P.pat.older(back); try { return u && new URL(u, P.url).href; } catch (e) { return null; } }

  // the furthest piece back the server still has: 7 points checked at once, then the gap between the
  // last one found and the first one missing; about 4 rounds for a whole game. Done once per list.
  function probe(P) {
    if (found[P.key] != null) return Promise.resolve(found[P.key]);
    INFO.why = 'checking';
    var lo = 0, hi = P.most + 1;
    var round = function () {
      if (hi - lo <= 1) return lo;
      var pts = [], gap = (hi - lo) / 8;
      for (var q = 1; q <= 7; q++) { var x = Math.round(lo + gap * q); if (x > lo && x < hi && pts.indexOf(x) < 0) pts.push(x); }
      if (!pts.length) pts.push(lo + 1);
      return Promise.all(pts.map(function (x) { return has(abs(P, x)); })).then(function (oks) {
        for (var r = 0; r < pts.length; r++) { if (oks[r]) lo = pts[r]; else { hi = pts[r]; break; } }
        return round();
      });
    };
    found[P.key] = has(abs(P, P.most)).then(function (ok) { return ok ? P.most : round(); })
      .then(function (n) { found[P.key] = n; return n; }, function () { found[P.key] = 0; return 0; })
      .then(function (n) { INFO.why = n ? 'ok' : 'server'; INFO.back = Math.max(INFO.back, Math.round(n * P.avg)); return n; });
    return found[P.key];
  }

  function build(P, n) {
    n = Math.min(n, P.most);
    var add = [];
    for (var b = n; b >= 1; b--) { var u = P.pat.older(b); if (u) add.push('#EXTINF:' + P.avg.toFixed(3) + ',', u); }
    if (!add.length) return P.text;
    var lines = P.lines, at = P.segs[0].at;
    while (at > 0 && /^#EXT-X-PROGRAM-DATE-TIME/.test(lines[at - 1])) at--;
    var out = lines.slice(0, at).concat(add, lines.slice(at)).join('\n');
    var seq = '#EXT-X-MEDIA-SEQUENCE:' + (P.seq - add.length / 2);
    out = P.hasSeq ? out.replace(/#EXT-X-MEDIA-SEQUENCE:\s*\d+/, seq) : out.replace('#EXTM3U', '#EXTM3U\n' + seq);
    return out.replace('#EXTM3U', '#EXTM3U\n' + MARK);
  }

  // waits for the check the first time (players that let us hold the list)
  function lengthen(text, url) {
    try {
      var P = prep(text, url);
      if (!P) return Promise.resolve(text);
      return probe(P).then(function (n) { return n ? build(P, n) : text; }, function () { return text; });
    } catch (e) { return Promise.resolve(text); }
  }
  // answers right away: lengthened once the check has finished, unchanged (and the check started) before
  function lengthenNow(text, url) {
    try {
      var P = prep(text, url);
      if (!P) return text;
      var n = found[P.key];
      if (typeof n === 'number') return n ? build(P, n) : text;
      probe(P);
      return text;
    } catch (e) { return text; }
  }
  function looksLikeList(t) { return typeof t === 'string' && t.slice(0, 64).indexOf('#EXTM3U') >= 0; }

  /* the players' own downloads: any player that fetches its lists with XMLHttpRequest or fetch,
     even one built into the site's own code, gets the lengthened list */
  try {
    var XP = XMLHttpRequest.prototype, xOpen = XP.open;
    var textGet = Object.getOwnPropertyDescriptor(XP, 'responseText').get;   // the browser's own, before it's wrapped below
    XP.open = function (m2, u) { this.__stvUrl = u; return xOpen.apply(this, arguments); };
    ['responseText', 'response'].forEach(function (name) {
      var d = Object.getOwnPropertyDescriptor(XP, name);
      if (!d || !d.get) return;
      Object.defineProperty(XP, name, {
        configurable: true, enumerable: d.enumerable,
        get: function () {
          var v = d.get.call(this);
          if (this.readyState !== 4 || !looksLikeList(v)) return v;
          if (this.__stvIn === v) return this.__stvOut;
          var u;
          try { u = new URL(this.responseURL || this.__stvUrl, location.href).href; } catch (e) { u = this.responseURL || String(this.__stvUrl); }
          this.__stvIn = v; this.__stvOut = lengthenNow(v, u);
          return this.__stvOut;
        }
      });
    });
    /* the first time a list arrives, the player's "loaded" handlers wait for the check (about a second),
       so the player starts with the long list. Players get confused if a list grows backwards later. */
    var gate = function (x, run) {
      if (x.readyState !== 4) return run();
      if (x.__stvGate === undefined) {
        x.__stvGate = null;
        try {
          var rt = x.responseType;
          if (!rt || rt === 'text') {
            var raw = textGet.call(x);
            if (looksLikeList(raw)) {
              var u2; try { u2 = new URL(x.responseURL || x.__stvUrl, location.href).href; } catch (e) { u2 = String(x.__stvUrl); }
              var P = prep(raw, u2);
              if (P && typeof found[P.key] !== 'number') { INFO.lists--; x.__stvGate = probe(P).catch(function () {}); }
            }
          }
        } catch (e) {}
      }
      if (x.__stvGate) x.__stvGate.then(run); else run();
    };
    var EV = { load: 1, loadend: 1, readystatechange: 1 };
    var wrapped = typeof WeakMap === 'function' ? new WeakMap() : null;
    var wrapFn = function (fn) {
      if (typeof fn !== 'function' || !wrapped) return fn;
      var w = wrapped.get(fn);
      if (!w) { w = function (ev) { var x = this; gate(x, function () { fn.call(x, ev); }); }; wrapped.set(fn, w); }
      return w;
    };
    var xAdd = XP.addEventListener, xRemove = XP.removeEventListener;
    XP.addEventListener = function (type, fn, o) { return xAdd.call(this, type, EV[type] ? wrapFn(fn) : fn, o); };
    XP.removeEventListener = function (type, fn, o) { return xRemove.call(this, type, EV[type] && wrapped && wrapped.get(fn) || fn, o); };
    [[XP, 'onreadystatechange'], [window.XMLHttpRequestEventTarget && XMLHttpRequestEventTarget.prototype, 'onload'],
     [window.XMLHttpRequestEventTarget && XMLHttpRequestEventTarget.prototype, 'onloadend']].forEach(function (pair) {
      var proto = pair[0], name = pair[1], d = proto && Object.getOwnPropertyDescriptor(proto, name);
      if (!d || !d.set) return;
      Object.defineProperty(proto, name, {
        configurable: true, enumerable: d.enumerable,
        get: function () { return this['__stv_' + name] || null; },
        set: function (fn) { this['__stv_' + name] = fn; d.set.call(this, wrapFn(fn)); }
      });
    });
  } catch (e) {}
  if (rawFetch) {
    try {
      window.fetch = function (input, init) {
        var p = rawFetch(input, init);
        var u = typeof input === 'string' ? input : (input && input.url) || String(input);
        return p.then(function (r) {
          try {
            var ct = (r.headers && r.headers.get('content-type')) || '';
            if (!/mpegurl/i.test(ct) && !/\.m3u8/i.test(r.url || u)) return r;
            return r.clone().text().then(function (t) {
              if (!looksLikeList(t)) return r;
              return lengthen(t, r.url || u).then(function (t2) {
                if (t2 === t) return r;
                var h = new Headers(r.headers); h.delete('content-length'); h.delete('content-encoding');
                var out = new Response(t2, { status: r.status, statusText: r.statusText, headers: h });
                try { Object.defineProperty(out, 'url', { value: r.url }); } catch (e) {}
                return out;
              });
            }).catch(function () { return r; });
          } catch (e) { return r; }
        });
      };
    } catch (e) {}
  }

  function isDash(u, type) { return /\.mpd(\?|$)/i.test(String(u || '')) || /dash/i.test(String(type || '')); }

  function tune(g, how, args) {
    if (!g) return;
    try {
      if (g.kind === 'shaka') {
        var pl = g.obj;
        var conf = { streaming: { bufferBehind: DVR, bufferingGoal: 300 } };
        // DASH lists can be told to reach further back; HLS lists are lengthened below instead
        if (how === 'load' && args && isDash(args[0], args[2])) conf.manifest = { availabilityWindowOverride: REACH };
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

  function playerKind() {
    try {
      if (!INFO.kind || INFO.kind === 'unknown') {
        INFO.kind = window.videojs ? 'video.js' : window.jwplayer ? 'JW Player' : window.Clappr ? 'Clappr' : window.dashjs ? 'dash.js'
          : window.flowplayer ? 'Flowplayer' : window.Plyr ? 'Plyr' : 'unknown';
      }
    } catch (e) {}
    return INFO;
  }

  function status(v) {
    if (!v) return { has: false };
    var e = edges(v), live = !isFinite(v.duration) || v.duration > 86400 || engineLive(v) || !!INFO.live;
    return { has: true, paused: v.paused, muted: v.muted, t: v.currentTime, d: live ? null : v.duration,
             live: live, behind: live ? Math.max(0, e[1] - v.currentTime) : 0, filled: filled === v, q: qualities(v),
             from: live ? Math.max(0, v.currentTime - e[0]) : 0, dvr: playerKind() };
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
      // a little after the very first piece: some players jump to live if asked for a spot before it
      case 'start': { var e3 = edges(v); v.currentTime = e3[0] + (e3[1] - e3[0] > 300 ? 20 : 2); var p4 = v.play(); if (p4 && p4.catch) p4.catch(function () {}); break; }
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
