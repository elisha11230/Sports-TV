/* EB Sports: box score panel for the player and multiview.
   Slides in on the right over the game, the way Prime Video shows stats: the score by period,
   team stats and the players for each team, from ESPN's game summary. Updates every 15 seconds
   while it's open. For NFL RedZone it shows every NFL game of the day instead.

   BOX.open(game)   game is the player's game info (sport, gameId, yyyymmdd, title)
   BOX.close()  BOX.toggle(game)  BOX.isOpen() */
window.BOX = (function () {
  'use strict';
  var PATHS = { nba: 'basketball/nba', nfl: 'football/nfl', cfb: 'football/college-football', mlb: 'baseball/mlb' };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var nav = function () { return window.__tvNav; };

  var CSS = '' +
    '#boxp{position:fixed;top:0;right:0;bottom:0;width:min(46vw,440px);z-index:20;color:#EAF0F8;font-family:Barlow,Roboto,system-ui,sans-serif;' +
    'background:linear-gradient(90deg,rgba(6,10,18,.55),rgba(6,10,18,.93) 18%);display:flex;flex-direction:column;' +
    'transform:translateX(102%);transition:transform .22s ease-out;will-change:transform}' +
    '#boxp.on{transform:none}' +
    '#boxp[hidden]{display:none}' +
    '#boxp .bh{padding:16px 18px 8px 34px;display:flex;align-items:center;gap:8px}' +
    '#boxp .bh h2{margin:0;font-size:15px;letter-spacing:.12em;text-transform:uppercase;color:#A7B4CA;font-weight:700;flex:1}' +
    '#boxp .bt{display:flex;gap:6px;padding:0 18px 8px 34px}' +
    '#boxp .b{padding:5px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.2);background:rgba(20,28,44,.85);color:inherit;font:600 13px inherit;cursor:pointer}' +
    '#boxp .b.on{background:#EAF0F8;color:#0A111E;border-color:#EAF0F8}' +
    '#boxp .bb{flex:1;overflow:auto;padding:4px 18px 24px 34px}' +
    '#boxp .bs{position:absolute;right:16px;bottom:10px;font-size:11px;color:#A7B4CA;background:rgba(6,10,18,.85);padding:3px 9px;border-radius:999px;pointer-events:none}' +
    '#boxp .bs:empty{display:none}' +
    '#boxp .score{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;margin:2px 0 10px}' +
    '#boxp .tm{display:flex;align-items:center;gap:8px;font-weight:700;font-size:18px}' +
    '#boxp .tm.r{justify-content:flex-end}' +
    '#boxp .tm img{width:28px;height:28px;object-fit:contain}' +
    '#boxp .tm b{font-size:28px}' +
    '#boxp .st{font-size:12px;color:#FFD54A;text-align:center;font-weight:700;letter-spacing:.06em;text-transform:uppercase}' +
    '#boxp table{width:100%;border-collapse:collapse;font-size:13px;margin:4px 0 12px}' +
    '#boxp th{font-weight:600;color:#7F8DA6;text-align:right;padding:3px 4px;font-size:11px;letter-spacing:.04em}' +
    '#boxp td{padding:4px;text-align:right;border-top:1px solid rgba(255,255,255,.07);font-variant-numeric:tabular-nums}' +
    '#boxp th:first-child,#boxp td:first-child{text-align:left}' +
    '#boxp td.n{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '#boxp tr.tot td{font-weight:700}' +
    '#boxp .sec{margin:10px 0 2px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7F8DA6;font-weight:700}' +
    '#boxp .cmp{display:grid;grid-template-columns:1fr auto 1fr;gap:3px 10px;font-size:13px;margin:4px 0 10px}' +
    '#boxp .cmp .l{text-align:right;font-weight:600}' +
    '#boxp .cmp .m{text-align:center;color:#7F8DA6;font-size:12px}' +
    '#boxp .cmp .r{font-weight:600}' +
    '#boxp .note{color:#7F8DA6;font-size:13px;padding:20px 0}' +
    '#boxp .g{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:8px 0;border-top:1px solid rgba(255,255,255,.07);font-size:14px}' +
    '#boxp .g .s{font-weight:700;text-align:right}' +
    '#boxp .g .d{grid-column:1/-1;font-size:11px;color:#A7B4CA}' +
    '#boxp .g .d.live{color:#FF6B6B}';

  var el = null, game = null, timer = null, side = 1, last = null;

  function ensure() {
    if (el) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    el = document.createElement('aside');
    el.id = 'boxp';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Box score');
    el.innerHTML = '<div class="bh"><h2 id="boxt">Box score</h2><button class="b" type="button" data-x="1" aria-label="Close box score">Close</button></div>' +
      '<div class="bt" id="boxtabs"></div><div class="bb" id="boxb"><p class="note">Loading…</p></div><div class="bs" id="boxs"></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.x) close();
      else if (b.dataset.side != null) { side = +b.dataset.side; draw(); refocus('[data-side="' + side + '"]'); }
    });
    // Escape (and the remote's Back, through tv-nav) closes it; Up and Down scroll it
    document.addEventListener('keydown', function (e) {
      if (!isOpen()) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      var dir = e.key === 'ArrowDown' || e.keyCode === 20 ? 1 : e.key === 'ArrowUp' || e.keyCode === 19 ? -1 : 0;
      if (!dir) return;   // left and right still move between the buttons
      e.preventDefault(); e.stopImmediatePropagation();
      var b = el.querySelector('#boxb');
      b.scrollTop += dir * Math.max(90, Math.round(b.clientHeight * 0.35));
      hint();
    }, true);
  }
  function refocus(sel) {
    setTimeout(function () {
      var b = null, list = sel.split(',');
      for (var i = 0; i < list.length && !b; i++) b = el.querySelector(list[i].trim());
      if (b && nav()) nav().focus(b, { noScroll: true });
    }, 20);
  }

  function hint() {
    var b = el.querySelector('#boxb'), more = b.scrollHeight - b.clientHeight - b.scrollTop > 4, up = b.scrollTop > 4;
    el.querySelector('#boxs').textContent = more ? '▼ more' : up ? '▲ top' : '';
  }
  function isOpen() { return !!el && !el.hidden; }
  function open(g) {
    ensure();
    if (!g || !PATHS[g.sport]) return;
    if (!game || game.gameId !== g.gameId) { last = null; side = 1; el.querySelector('#boxb').innerHTML = '<p class="note">Loading…</p>'; }
    game = g;
    el.hidden = false;
    requestAnimationFrame(function () { el.classList.add('on'); });
    load();
    clearInterval(timer);
    timer = setInterval(function () { if (!document.hidden) load(); }, 15000);
    refocus('[data-side="' + side + '"], [data-x]');
  }
  function close() {
    if (!el) return;
    el.classList.remove('on');
    clearInterval(timer);
    setTimeout(function () { if (!el.classList.contains('on')) el.hidden = true; }, 230);
  }
  function toggle(g) { if (isOpen() && game && g && game.gameId === g.gameId) close(); else open(g); }

  /* ---------- data ---------- */
  function load() {
    var g = game;
    var base = 'https://site.api.espn.com/apis/site/v2/sports/' + PATHS[g.sport];
    var url = g.gameId === 'redzone'
      ? base + '/scoreboard?dates=' + (g.yyyymmdd || '')
      : base + '/summary?event=' + encodeURIComponent(g.gameId);
    fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { if (game !== g) return; last = d; draw(); })
      .catch(function () { if (game === g && !last) el.querySelector('#boxb').innerHTML = '<p class="note">Couldn\'t load the box score.</p>'; });
  }

  /* ---------- drawing ---------- */
  function draw() {
    if (!last || !game) return;
    var body = el.querySelector('#boxb'), keep = body.scrollTop;
    if (game.gameId === 'redzone') { drawLeague(body); body.scrollTop = keep; hint(); return; }
    var comp = (last.header && last.header.competitions && last.header.competitions[0]) || {};
    var teams = (comp.competitors || []).slice().sort(function (a, b) { return (a.homeAway === 'home') - (b.homeAway === 'home'); });
    if (teams.length < 2) { body.innerHTML = '<p class="note">No box score for this game yet.</p>'; return; }
    var st = (comp.status && comp.status.type) || {};
    el.querySelector('#boxt').textContent = 'Box score';
    // team buttons for the player lists
    var tabs = teams.map(function (t, i) {
      return '<button class="b' + (i === side ? ' on' : '') + '" type="button" data-side="' + i + '">' + esc(abbr(t)) + ' players</button>';
    }).join('');
    var tabsEl = el.querySelector('#boxtabs');
    if (tabsEl.__k !== tabs) { tabsEl.innerHTML = tabs; tabsEl.__k = tabs; }

    var h = '<div class="score">' + teamHead(teams[0], false) +
      '<div class="st">' + esc(st.shortDetail || st.detail || '') + '</div>' + teamHead(teams[1], true) + '</div>';
    h += lineScore(teams);
    h += teamStats(teams);
    h += players(teams[side]);
    body.innerHTML = h;
    body.scrollTop = keep;
    hint();
  }
  function abbr(t) { return (t.team && (t.team.abbreviation || t.team.shortDisplayName)) || ''; }
  function logo(t) { var tm = t.team || {}; return tm.logo || (tm.logos && tm.logos[0] && tm.logos[0].href) || ''; }
  function teamHead(t, right) {
    var img = logo(t) ? '<img src="' + esc(logo(t)) + '" alt="">' : '';
    var name = '<span>' + esc(abbr(t)) + '</span>', sc = '<b>' + esc(t.score == null ? '' : t.score) + '</b>';
    return '<div class="tm' + (right ? ' r' : '') + '">' + (right ? sc + name + img : img + name + sc) + '</div>';
  }
  function lineScore(teams) {
    var n = Math.max.apply(null, teams.map(function (t) { return (t.linescores || []).length; }));
    if (!n) return '';
    var head = '<tr><th></th>';
    for (var i = 0; i < n; i++) head += '<th>' + (i < 4 || game.sport === 'mlb' ? (i + 1) : 'OT' + (n > 5 ? i - 3 : '')) + '</th>';
    head += '<th>T</th></tr>';
    var rows = teams.map(function (t) {
      var r = '<tr class="tot"><td>' + esc(abbr(t)) + '</td>';
      for (var i = 0; i < n; i++) { var ls = (t.linescores || [])[i]; r += '<td>' + esc(ls ? (ls.displayValue != null ? ls.displayValue : ls.value) : '') + '</td>'; }
      return r + '<td>' + esc(t.score == null ? '' : t.score) + '</td></tr>';
    }).join('');
    return '<table>' + head + rows + '</table>';
  }

  // [ESPN's name for the stat, what the panel calls it, ESPN labels to match if the name differs]
  var TEAM_STATS = {
    nba: [['fieldGoalPct', 'FG%', ['field goal %', 'fg%']], ['threePointFieldGoalPct', '3P%', ['three point %', '3p%', '3pt %']],
          ['freeThrowPct', 'FT%', ['free throw %', 'ft%']], ['totalRebounds', 'Rebounds', ['rebounds', 'reb']],
          ['assists', 'Assists', ['assists', 'ast']], ['turnovers', 'Turnovers', ['turnovers', 'to']],
          ['steals', 'Steals', ['steals', 'stl']], ['blocks', 'Blocks', ['blocks', 'blk']]],
    nfl: [['totalYards', 'Total yards', ['total yards']], ['netPassingYards', 'Passing', ['passing']], ['rushingYards', 'Rushing', ['rushing']],
          ['firstDowns', 'First downs', ['1st downs', 'first downs']], ['thirdDownEff', '3rd down', ['3rd down efficiency']],
          ['turnovers', 'Turnovers', ['turnovers']], ['totalPenaltiesYards', 'Penalties', ['penalties']], ['possessionTime', 'Possession', ['possession']]]
  };
  TEAM_STATS.cfb = TEAM_STATS.nfl;
  function teamStats(teams) {
    var bt = (last.boxscore && last.boxscore.teams) || [];
    if (bt.length < 2) return '';
    var byTeam = teams.map(function (t) {
      var id = t.team && t.team.id, m = null;
      for (var i = 0; i < bt.length; i++) if (bt[i].team && String(bt[i].team.id) === String(id)) m = bt[i];
      return m || bt[teams.indexOf(t)] || {};
    });
    var want = TEAM_STATS[game.sport] || [];
    var find = function (tb, name, labels) {
      var s = tb.statistics || [], i;
      for (i = 0; i < s.length; i++) if (s[i].name === name) return s[i].displayValue;
      for (i = 0; i < s.length; i++) if (labels.indexOf(String(s[i].label || '').toLowerCase()) >= 0) return s[i].displayValue;
      return null;
    };
    var rows = want.map(function (w) {
      var a = find(byTeam[0], w[0], w[2]), b = find(byTeam[1], w[0], w[2]);
      if (a == null && b == null) return '';
      return '<div class="l">' + esc(a == null ? '–' : a) + '</div><div class="m">' + esc(w[1]) + '</div><div class="r">' + esc(b == null ? '–' : b) + '</div>';
    }).join('');
    if (!rows) {
      // a sport without a list: show the first stats ESPN gives
      var s0 = byTeam[0].statistics || [], s1 = byTeam[1].statistics || [];
      rows = s0.slice(0, 8).map(function (s, i) {
        return '<div class="l">' + esc(s.displayValue) + '</div><div class="m">' + esc(s.label || s.name) + '</div><div class="r">' + esc((s1[i] || {}).displayValue || '–') + '</div>';
      }).join('');
    }
    return rows ? '<div class="sec">Team stats</div><div class="cmp">' + rows + '</div>' : '';
  }

  // which columns to show for each group of player stats
  var COLS = {
    nba: { '': ['MIN', 'PTS', 'REB', 'AST', 'FG', '3PT'] },
    nfl: { passing: ['C/ATT', 'YDS', 'TD', 'INT'], rushing: ['CAR', 'YDS', 'TD'], receiving: ['REC', 'YDS', 'TD'],
           defensive: ['TOT', 'SACKS'], kicking: ['FG', 'XP', 'PTS'] },
    mlb: { batting: ['AB', 'R', 'H', 'RBI', 'HR'], pitching: ['IP', 'H', 'ER', 'K'] }
  };
  COLS.cfb = COLS.nfl;
  var SORT = { nba: 'PTS', passing: 'YDS', rushing: 'YDS', receiving: 'YDS', defensive: 'TOT', kicking: 'PTS', batting: 'H', pitching: 'IP' };
  function players(t) {
    var groups = (last.boxscore && last.boxscore.players) || [];
    var mine = null, id = t && t.team && t.team.id;
    for (var i = 0; i < groups.length; i++) if (groups[i].team && String(groups[i].team.id) === String(id)) mine = groups[i];
    if (!mine) return '<p class="note">Player stats show once the game starts.</p>';
    var cols = COLS[game.sport] || {};
    var out = '';
    (mine.statistics || []).forEach(function (grp) {
      var gname = (grp.name || '').toLowerCase();
      var want = cols[gname] || cols[''];
      if (!want) return;
      var labels = (grp.labels || grp.names || []).map(function (x) { return String(x).toUpperCase(); });
      var idx = want.map(function (w) { return labels.indexOf(w); });
      if (idx.every(function (x) { return x < 0; })) return;
      var sortKey = labels.indexOf(SORT[game.sport === 'nba' ? 'nba' : gname] || '');
      var list = (grp.athletes || []).filter(function (a) { return a.stats && a.stats.length && !a.didNotPlay; });
      if (sortKey >= 0) list.sort(function (a, b) { return num(b.stats[sortKey]) - num(a.stats[sortKey]); });
      list = list.slice(0, game.sport === 'nba' ? 10 : 3);
      if (!list.length) return;
      var head = '<tr><th>' + esc(gname && game.sport !== 'nba' ? cap(gname) : '') + '</th>' + want.map(function (w, i) { return idx[i] >= 0 ? '<th>' + esc(w) + '</th>' : ''; }).join('') + '</tr>';
      var rows = list.map(function (a) {
        var nm = (a.athlete && (a.athlete.shortName || a.athlete.displayName)) || '';
        return '<tr><td class="n">' + esc(nm) + '</td>' + want.map(function (w, i) { return idx[i] >= 0 ? '<td>' + esc(a.stats[idx[i]]) + '</td>' : ''; }).join('') + '</tr>';
      }).join('');
      out += '<table>' + head + rows + '</table>';
    });
    return '<div class="sec">' + esc(abbr(t)) + ' players</div>' + (out || '<p class="note">No player stats yet.</p>');
  }
  function num(v) { var n = parseFloat(String(v).split(/[-/]/)[0]); return isNaN(n) ? -1 : n; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // RedZone: every NFL game of the day, live ones first
  function drawLeague(body) {
    el.querySelector('#boxt').textContent = 'Around the NFL';
    el.querySelector('#boxtabs').innerHTML = ''; el.querySelector('#boxtabs').__k = '';
    var rank = { 'in': 0, pre: 1, post: 2 };
    var evs = (last.events || []).slice().sort(function (a, b) {
      return (rank[a.status.type.state] - rank[b.status.type.state]) || (new Date(a.date) - new Date(b.date));
    });
    if (!evs.length) { body.innerHTML = '<p class="note">No NFL games today.</p>'; return; }
    body.innerHTML = evs.map(function (e) {
      var c = e.competitions[0], st = e.status.type;
      var ts = c.competitors.slice().sort(function (a, b) { return (a.homeAway === 'home') - (b.homeAway === 'home'); });
      var live = st.state === 'in';
      var sit = live && c.situation && c.situation.downDistanceText ? ' · ' + c.situation.downDistanceText : '';
      var line = function (t) { return esc(t.team.abbreviation) + (st.state === 'pre' ? '' : ' ' + esc(t.score)); };
      return '<div class="g"><div>' + line(ts[0]) + '  @  ' + line(ts[1]) + '</div><div class="s"></div>' +
        '<div class="d' + (live ? ' live' : '') + '">' + esc(st.shortDetail || '') + esc(sit) + '</div></div>';
    }).join('');
  }

  return { open: open, close: close, toggle: toggle, isOpen: isOpen };
})();
