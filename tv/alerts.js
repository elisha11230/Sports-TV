/* EB Sports: game alerts while you watch.
   Every 30 seconds the NBA and NFL scoreboards are checked. A popup comes up when another live game
   gets close late, goes to overtime, or (if turned on) an NFL team gets into the red zone.
   Up adds that game to multiview (or swaps it in), Back closes the popup. On a phone, tap the buttons.
   A page turns it on with ALERTS.start({ watching, act, actLabel }). */
(function () {
  // switched off for now (Elisha, Nov 8): set to true to bring alerts and their settings back
  var ENABLED = false;
  var PATHS = { nba: 'basketball/nba', nfl: 'football/nfl' };
  var NAME = { nba: 'NBA', nfl: 'NFL' };
  var CLOSE = { nba: 5, nfl: 8 };      // points: a close game
  var LATE = 300;                      // seconds left in the 4th
  var SHOW = 12000;                    // how long a popup stays up
  var cfg = null, seen = {}, rzWas = {}, rzAt = {}, queue = [], cur = null, hideT = null, timer = null;

  function settings() { var s = STV.settings(); return { on: s.alerts || {}, spoilers: !!s.spoilers }; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function dayKey() { var d = new Date(); return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); }

  /* ---------- what's worth a popup ---------- */
  function check(sport, ev) {
    var c = ev.competitions && ev.competitions[0], st = ev.status || {}, ty = st.type || {};
    if (!c || ty.state !== 'in') return;
    var key = sport + ':' + ev.id;
    if (cfg.watching().indexOf(key) >= 0) return;
    var on = settings().on, per = st.period || 0, left = st.clock == null ? 9999 : +st.clock;
    var cs = c.competitors.slice().sort(function (x, y) { return (x.homeAway === 'home') - (y.homeAway === 'home'); });
    var margin = Math.abs((+cs[0].score || 0) - (+cs[1].score || 0));
    var base = { sport: sport, ev: ev, key: key, cs: cs, detail: ty.shortDetail || ty.detail || '' };
    if (on.ot && per >= 5 && !seen[key + ':ot' + per]) {
      seen[key + ':ot' + per] = 1;
      push(base, per === 5 ? 'Overtime' : (per - 4) + ' overtimes');
    }
    if (on.close && per === 4 && left <= LATE && margin <= CLOSE[sport] && !seen[key + ':close']) {
      seen[key + ':close'] = 1;
      push(base, 'Close finish');
    }
    if (sport === 'nfl') {
      var sit = c.situation || {}, rz = !!sit.isRedZone;
      // once per trip inside the 20, and not more than every 3 minutes for the same game
      if (on.rz && rz && !rzWas[key] && Date.now() - (rzAt[key] || 0) > 180000) {
        rzAt[key] = Date.now();
        var who = sit.possessionText || sit.downDistanceText || '';
        push(base, 'Red zone' + (who ? ' · ' + who : ''));
      }
      rzWas[key] = rz;
    }
  }
  function push(base, why) {
    queue = queue.filter(function (x) { return x.key !== base.key; });
    base.why = why;
    queue.push(base);
    if (!cur) next();
  }

  function poll() {
    clearTimeout(timer);
    var s = settings().on;
    if (!(s.close || s.ot || s.rz)) { timer = setTimeout(poll, 60000); return; }
    var day = dayKey();
    Promise.all(Object.keys(PATHS).map(function (sp) {
      return fetch('https://site.api.espn.com/apis/site/v2/sports/' + PATHS[sp] + '/scoreboard?dates=' + day, { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (j) { (j.events || []).forEach(function (ev) { check(sp, ev); }); })
        .catch(function () {});
    })).then(function () { timer = setTimeout(poll, 30000); });
  }

  /* ---------- the popup ---------- */
  var css = '#stv-al{position:fixed;top:18px;right:18px;z-index:2147483000;width:min(380px,calc(100vw - 36px));background:rgba(16,19,26,.96);' +
    'color:#fff;border:1px solid rgba(255,255,255,.14);border-left:4px solid #e23b3b;border-radius:14px;padding:14px 16px;font:15px/1.35 system-ui,sans-serif;' +
    'box-shadow:0 10px 30px rgba(0,0,0,.5);transform:translateY(-12px);opacity:0;transition:transform .2s,opacity .2s}' +
    '#stv-al.on{transform:none;opacity:1}#stv-al .k{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#ff8f8f;font-weight:700}' +
    '#stv-al .t{font-size:20px;font-weight:800;margin:3px 0 1px}#stv-al .s{color:#b9c0cc;font-size:14px}' +
    '#stv-al .b{display:flex;gap:8px;margin-top:10px}#stv-al button{font:inherit;font-size:14px;font-weight:700;border:0;border-radius:999px;padding:7px 14px;cursor:pointer;' +
    'background:rgba(255,255,255,.12);color:#fff}#stv-al button.go{background:#fff;color:#111}#stv-al .h{color:#8a93a3;font-size:12px;margin-top:8px}' +
    '#stv-al .bar{position:absolute;left:0;bottom:0;height:3px;background:#e23b3b;border-radius:0 0 0 14px;width:100%;transition:width linear}';
  function el() {
    var d = document.getElementById('stv-al');
    if (d) return d;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    d = document.createElement('div'); d.id = 'stv-al'; d.setAttribute('role', 'alert'); d.hidden = true;
    d.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.al === 'go') act(); else close();
    });
    document.body.appendChild(d);
    return d;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function next() {
    cur = queue.shift() || null;
    var d = el();
    if (!cur) { d.classList.remove('on'); setTimeout(function () { if (!cur) d.hidden = true; }, 220); return; }
    var a = cur.cs[0], h = cur.cs[1], hide = settings().spoilers;
    var line = hide ? (a.team.abbreviation + ' at ' + h.team.abbreviation)
      : (a.team.abbreviation + ' ' + a.score + ' · ' + h.team.abbreviation + ' ' + h.score);
    var tv = !STV.phone;
    d.innerHTML = '<div class="k">' + esc(NAME[cur.sport] + ' · ' + cur.why) + '</div><div class="t">' + esc(line) + '</div>' +
      '<div class="s">' + esc(hide ? 'Live now' : cur.detail) + '</div>' +
      '<div class="b"><button class="go" type="button" tabindex="-1" data-al="go">' + (tv ? '▲ ' : '') + esc(cfg.actLabel()) + '</button>' +
      '<button type="button" tabindex="-1" data-al="x">Dismiss</button></div>' +
      (tv ? '<div class="h">Up: ' + esc(cfg.actLabel().toLowerCase()) + ' · Back: dismiss</div>' : '') + '<div class="bar"></div>';
    d.hidden = false;
    requestAnimationFrame(function () {
      d.classList.add('on');
      var bar = d.querySelector('.bar');
      bar.style.transitionDuration = SHOW + 'ms';
      requestAnimationFrame(function () { bar.style.width = '0'; });
    });
    clearTimeout(hideT); hideT = setTimeout(close, SHOW);
  }
  function close() { clearTimeout(hideT); next(); }
  function act() {
    var c = cur; if (!c) return;
    clearTimeout(hideT); queue = []; next();
    cfg.act(STV.vars(c.ev, c.sport), c);
  }

  // Up on the remote acts on the popup; Back closes it. Registered before the page's own keys.
  window.addEventListener('keydown', function (e) {
    if (!cur) return;
    if (e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); act(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  }, true);
  var back = window.__tvBack;
  window.__tvBack = function () { if (cur) { close(); return true; } return back ? back.apply(this, arguments) : false; };

  window.ALERTS = {
    enabled: ENABLED,
    start: function (c) { cfg = c; if (ENABLED) setTimeout(poll, 4000); },
    isOpen: function () { return !!cur; },
    // for testing: run the rules on a scoreboard
    _check: function (sport, ev) { check(sport, ev); }
  };
})();
