/* =====================================================================================
   Sports TV remote layer
   Makes any of the sports pages work from a TV remote: the arrow keys move a focus ring
   to the nearest item in that direction, Select clicks it, Back closes the top panel.

   The Fire TV app injects this into every page it opens (NBA, NFL, the hub). On a computer
   it can be tried by adding ?tv=1 to a page that loads it.

   Nothing in the NBA or NFL app has to change for it to work. It finds what can be clicked
   by looking for buttons, links and anything styled with a pointer cursor, and it copies
   every :hover style onto the focused item so the apps highlight the same way they do
   under a mouse.
   ===================================================================================== */
(function () {
  'use strict';
  if (window.__tvNav) return;
  var W = window, D = document;
  var IN_SHELL = !!W.__STV_SHELL || /SportsTV\//.test(navigator.userAgent);
  var FORCED = /[?&#]tv=1/.test(location.search + location.hash) || !!W.__STV_FORCE;
  if (!IN_SHELL && !FORCED) return;
  W.__tvNav = { version: 1, shell: IN_SHELL };

  /* ---------------- styles ---------------- */
  var CSS = [
    'html.tv{scroll-behavior:auto!important}',
    '#tvring{position:fixed;z-index:2147483646;pointer-events:none;border:3px solid #FFD54A;border-radius:10px;',
    'box-shadow:0 0 0 3px rgba(0,0,0,.6),0 0 24px rgba(255,213,74,.55);transition:top .1s,left .1s,width .1s,height .1s;display:none}',
    '#tvtoast{position:fixed;z-index:2147483647;left:50%;bottom:28px;transform:translateX(-50%);background:rgba(10,14,22,.92);color:#fff;',
    'font:600 15px/1.3 system-ui,sans-serif;padding:10px 18px;border-radius:12px;border:1px solid rgba(255,255,255,.18);pointer-events:none;opacity:0;transition:opacity .2s}',
    '#tvtoast.on{opacity:1}',
    'html.tv :focus{outline:none!important}',
    'html.tv ::-webkit-scrollbar{width:0;height:0}'
  ].join('');

  function addStyle(id, text) {
    var s = D.getElementById(id);
    if (!s) { s = D.createElement('style'); s.id = id; (D.head || D.documentElement).appendChild(s); }
    s.textContent = text;
    return s;
  }

  /* ---------------- helpers ---------------- */
  var NATIVE = 'a[href],button:not([disabled]),input:not([type=hidden]):not([disabled]),select:not([disabled]),' +
    'textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"]),[onclick],[role=button],[role=tab],[role=option],' +
    '[role=menuitem],[role=link],[role=switch],[role=checkbox],[role=radio],[data-wt],[contenteditable=""],[contenteditable=true]';
  var ACTIVATES_ITSELF = /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/;
  var TYPING = /^(INPUT|TEXTAREA)$/;
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, TEMPLATE: 1, NOSCRIPT: 1, BR: 1, HEAD: 1, TITLE: 1, DEFS: 1 };
  var LAYERS = '[aria-modal="true"],[role=dialog],[role=menu],#clipview';

  function rectOf(el) { return el.getBoundingClientRect(); }
  function shown(el) {
    if (!el || !el.isConnected || el.hidden) return false;
    if (!el.getClientRects().length) return false;
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
    var r = rectOf(el);
    return r.width >= 3 && r.height >= 3;
  }
  function cursorOf(el) { try { return getComputedStyle(el).cursor; } catch (e) { return ''; } }
  function zOf(el) { var z = parseInt(getComputedStyle(el).zIndex, 10); return isNaN(z) ? 0 : z; }
  function depthOf(el) { var d = 0; while (el && (el = el.parentElement)) d++; return d; }

  /* ---------------- the open panel (focus stays inside it) ---------------- */
  function topLayer() {
    var list = D.querySelectorAll(LAYERS), best = null, bz = -1e9, bd = -1;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (!shown(el)) continue;
      var r = rectOf(el);
      // a small popover menu still counts; a zero sized wrapper does not
      if (r.width * r.height < 400) continue;
      var z = zOf(el), d = depthOf(el);
      if (z > bz || (z === bz && d >= bd)) { best = el; bz = z; bd = d; }
    }
    return best;
  }

  /* ---------------- what can be focused ---------------- */
  var dirty = true, cache = { root: null, list: [] };
  try {
    new MutationObserver(function () { dirty = true; })
      .observe(D.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'style', 'disabled', 'tabindex'] });
  } catch (e) {}

  function scan(root) {
    var out = [], seen = new Set();
    // buttons, links, inputs and anything marked as clickable
    var nat = root.querySelectorAll(NATIVE);
    for (var i = 0; i < nat.length; i++) {
      if (shown(nat[i]) && !nat[i].closest('[hidden]')) { out.push(nat[i]); seen.add(nat[i]); }
    }
    // anything styled with a pointer cursor whose parent is not (the outermost clickable box)
    var walker = D.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (n) {
        if (SKIP_TAGS[n.tagName.toUpperCase()]) return NodeFilter.FILTER_REJECT;
        if (n.id === 'tvring' || n.id === 'tvtoast') return NodeFilter.FILTER_REJECT;
        if (n.hidden || !n.getClientRects().length) {
          // display:contents keeps its children visible
          if (!n.hidden && getComputedStyle(n).display === 'contents') return NodeFilter.FILTER_SKIP;
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = walker.nextNode())) {
      if (seen.has(n)) continue;
      if (cursorOf(n) !== 'pointer') continue;
      var p = n.parentElement;
      if (p && cursorOf(p) === 'pointer') continue;
      if (!shown(n)) continue;
      out.push(n); seen.add(n);
    }
    return out;
  }
  function candidates(root) {
    if (dirty || cache.root !== root) { cache = { root: root, list: scan(root) }; dirty = false; }
    return cache.list.filter(function (el) { return el.isConnected; });
  }
  function isCandidate(el, root) { return candidates(root).indexOf(el) >= 0; }

  /* ---------------- focus and the ring ---------------- */
  var focused = null, ring, toastEl, toastT;
  function setFocus(el, opts) {
    if (!el) return;
    if (focused && focused !== el) focused.classList.remove('tvf');
    focused = el;
    el.classList.add('tvf');
    var natural = el.matches('a[href],button,input,select,textarea,summary,[tabindex]') || el.isContentEditable;
    if (!natural) el.setAttribute('tabindex', '-1');
    try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) {} }
    if (!opts || !opts.noScroll) reveal(el);
    drawRing();
  }
  function reveal(el) {
    var r = rectOf(el), vh = innerHeight, vw = innerWidth, pad = Math.min(80, vh * 0.12);
    var tall = r.height > vh * 0.7;
    if (r.top < pad || r.bottom > vh - pad || r.left < 0 || r.right > vw) {
      try { el.scrollIntoView({ block: tall ? 'start' : 'center', inline: 'nearest', behavior: 'auto' }); }
      catch (e) { el.scrollIntoView(); }
    }
  }
  function drawRing() {
    if (!ring) return;
    var el = focused;
    if (!el || !el.isConnected || !shown(el)) { ring.style.display = 'none'; return; }
    var r = rectOf(el);
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) { ring.style.display = 'none'; return; }
    var g = 4;
    ring.style.display = 'block';
    ring.style.left = (r.left - g) + 'px';
    ring.style.top = (r.top - g) + 'px';
    ring.style.width = (r.width + g * 2) + 'px';
    ring.style.height = (r.height + g * 2) + 'px';
    var br = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 6;
    ring.style.borderRadius = Math.min(br + g, 24) + 'px';
  }
  function toast(msg, ms) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('on'); }, ms || 1800);
  }

  /* ---------------- choosing the next item ---------------- */
  function gap(a1, a2, b1, b2) { return b2 < a1 ? a1 - b2 : b1 > a2 ? b1 - a2 : 0; }
  function scoreFor(r, c, dir) {
    var rx = (r.left + r.right) / 2, ry = (r.top + r.bottom) / 2;
    var cx = (c.left + c.right) / 2, cy = (c.top + c.bottom) / 2;
    var slackX = Math.min(8, r.width / 2), slackY = Math.min(8, r.height / 2), p, o, a;
    if (dir === 'right') { if (c.left < r.right - slackX || cx <= rx) return null; p = Math.max(0, c.left - r.right); o = gap(r.top, r.bottom, c.top, c.bottom); a = Math.abs(cy - ry); }
    else if (dir === 'left') { if (c.right > r.left + slackX || cx >= rx) return null; p = Math.max(0, r.left - c.right); o = gap(r.top, r.bottom, c.top, c.bottom); a = Math.abs(cy - ry); }
    else if (dir === 'down') { if (c.top < r.bottom - slackY || cy <= ry) return null; p = Math.max(0, c.top - r.bottom); o = gap(r.left, r.right, c.left, c.right); a = Math.abs(cx - rx); }
    else { if (c.bottom > r.top + slackY || cy >= ry) return null; p = Math.max(0, r.top - c.bottom); o = gap(r.left, r.right, c.left, c.right); a = Math.abs(cx - rx); }
    // left and right stay on roughly the same row; up and down may drift sideways more
    if ((dir === 'left' || dir === 'right') && o > Math.max(r.height, 40)) return null;
    if ((dir === 'up' || dir === 'down') && o > innerWidth * 0.6) return null;
    return { s: p + o * 2.5 + a * 0.1, p: p };
  }
  function onScreen(r) { return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; }
  function scrollerFor(el, vertical) {
    var n = el;
    while (n && n !== D.body && n !== D.documentElement) {
      var cs = getComputedStyle(n), ov = vertical ? cs.overflowY : cs.overflowX;
      if ((ov === 'auto' || ov === 'scroll') && (vertical ? n.scrollHeight > n.clientHeight + 2 : n.scrollWidth > n.clientWidth + 2)) return n;
      n = n.parentElement;
    }
    return D.scrollingElement || D.documentElement;
  }
  function firstIn(list, fromBottom) {
    var vis = list.filter(function (el) { return onScreen(rectOf(el)); });
    var pool = vis.length ? vis : list;
    pool.sort(function (a, b) {
      var ra = rectOf(a), rb = rectOf(b);
      return fromBottom ? (rb.top - ra.top) || (ra.left - rb.left) : (ra.top - rb.top) || (ra.left - rb.left);
    });
    return pool[0] || null;
  }
  function looksLikeClose(el) {
    var t = ((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '')).trim().toLowerCase();
    return /^(×|✕|✖|x)$/.test((el.textContent || '').trim()) || /\bclose\b/.test(t);
  }
  function focusFirst(root, list, fromBottom) {
    list = list || candidates(root);
    var pick = firstIn(list.filter(function (el) { return !looksLikeClose(el); }), fromBottom) || firstIn(list, fromBottom);
    if (pick) setFocus(pick);
    return pick;
  }

  function move(dir) {
    var root = topLayer() || D.body;
    var list = candidates(root);
    var cur = focused && focused.isConnected && root.contains(focused) && shown(focused) ? focused : null;
    if (!cur) { focusFirst(root, list, dir === 'up'); return; }
    var r = rectOf(cur);
    if (!onScreen(r)) { focusFirst(root, list, dir === 'up'); return; }
    var best = null, bs = null;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el === cur || el.contains(cur)) continue;
      var sc = scoreFor(r, rectOf(el), dir);
      if (sc && (!bs || sc.s < bs.s)) { best = el; bs = sc; }
    }
    var vertical = dir === 'up' || dir === 'down';
    var far = bs && bs.p > (vertical ? innerHeight * 0.9 : innerWidth * 0.9);
    if (!best || far) {
      // nothing close by in that direction: scroll so text without buttons can still be read
      var sc2 = scrollerFor(cur, vertical), amt = (vertical ? innerHeight : innerWidth) * 0.6;
      var before = vertical ? sc2.scrollTop : sc2.scrollLeft;
      var delta = (dir === 'down' || dir === 'right') ? amt : -amt;
      if (vertical) sc2.scrollTop += delta; else sc2.scrollLeft += delta;
      var after = vertical ? sc2.scrollTop : sc2.scrollLeft;
      if (after === before && best) { setFocus(best); return; }
      setTimeout(function () {
        if (!onScreen(rectOf(cur))) focusFirst(root, candidates(root), dir === 'up');
        drawRing();
      }, 30);
      return;
    }
    setFocus(best);
  }

  /* ---------------- Select ---------------- */
  function activate(el, e) {
    if (!el) return false;
    if (ACTIVATES_ITSELF.test(el.tagName.toUpperCase())) {
      // buttons and links click themselves on Enter; a checkbox or radio needs a nudge
      if (el.tagName === 'INPUT' && /^(checkbox|radio)$/i.test(el.type)) { e.preventDefault(); el.click(); }
      return true;
    }
    e.preventDefault();
    var r = rectOf(el), x = r.left + r.width / 2, y = r.top + r.height / 2;
    var init = { bubbles: true, cancelable: true, view: W, clientX: x, clientY: y, button: 0 };
    try { el.dispatchEvent(new PointerEvent('pointerdown', init)); } catch (er) {}
    el.dispatchEvent(new MouseEvent('mousedown', init));
    try { el.dispatchEvent(new PointerEvent('pointerup', init)); } catch (er) {}
    el.dispatchEvent(new MouseEvent('mouseup', init));
    el.dispatchEvent(new MouseEvent('click', init));
    return true;
  }

  // Select on a text box brings up the Fire TV keyboard
  function showKeyboard() {
    var msg = JSON.stringify({ id: 0, m: 'showKeyboard', a: [] });
    try {
      if (W.SportsTV && typeof W.SportsTV.postMessage === 'function') W.SportsTV.postMessage(msg);
      else if (W.SportsTVLegacy) W.SportsTVLegacy.call(msg);
    } catch (e) {}
  }

  /* ---------------- Back ---------------- */
  var CLOSE_SEL = '[aria-label*="close" i],[aria-label*="back" i],[title*="close" i],[data-close],.close,.x,.closebtn';
  function closeLayer(top) {
    var ev;
    try { ev = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }); }
    catch (e) { ev = D.createEvent('Event'); ev.initEvent('keydown', true, true); ev.key = 'Escape'; }
    (D.activeElement && D.activeElement !== D.body ? D.activeElement : D).dispatchEvent(ev);
    setTimeout(function () {
      if (shown(top)) {
        var btn = top.querySelector(CLOSE_SEL);
        if (!btn || !shown(btn)) {
          var all = top.querySelectorAll('button,[role=button]');
          for (var i = 0; i < all.length; i++) if (shown(all[i]) && looksLikeClose(all[i])) { btn = all[i]; break; }
        }
        if (btn) btn.click();
        else if (top.matches('[role=menu]')) top.hidden = true;
      }
      dirty = true;
      setTimeout(checkLayer, 40);
    }, 50);
  }
  // true when the page handled Back itself; false tells the app to go back a page
  W.__tvBack = function () {
    if (typeof W.__tvBackHook === 'function') { try { if (W.__tvBackHook() === true) return true; } catch (e) {} }
    var top = topLayer();
    if (top) { closeLayer(top); return true; }
    return false;
  };

  /* ---------------- per app fixes ---------------- */
  // NFL: opening a player does not add a history step, so Back goes to the team view first
  if (/\/nfl-rosters\//i.test(location.pathname) || /NFL/.test(D.title)) {
    var nflBack = null;
    try { nflBack = Function('try{if(typeof sel!=="undefined"&&sel){sel=null;paintSel();renderTeam();syncHash();return true}}catch(e){}return false'); } catch (e) {}
    if (nflBack && !W.__tvBackHook) W.__tvBackHook = function () {
      if (topLayer()) return false;
      var done = nflBack();
      if (done) setTimeout(function () { dirty = true; focusFirst(D.body); }, 80);
      return done;
    };
  }

  /* ---------------- panels opening and closing ---------------- */
  var curLayer = null, openers = new WeakMap();
  function checkLayer() {
    var L = topLayer();
    if (L === curLayer) return;
    var prev = curLayer;
    curLayer = L;
    dirty = true;
    if (L) {
      if (!openers.has(L)) openers.set(L, prev === null || (focused && !L.contains(focused)) ? focused : null);
      if (!focused || !L.contains(focused) || !shown(focused)) setTimeout(function () { if (topLayer() === L) focusFirst(L); }, 60);
    } else {
      var back = prev && openers.get(prev);
      if (prev) openers.delete(prev);
      if (back && back.isConnected && shown(back)) setFocus(back);
      else if (!focused || !focused.isConnected || !shown(focused)) focusFirst(D.body);
    }
  }

  /* ---------------- the remote ---------------- */
  var KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Up: 'up', Down: 'down', Left: 'left', Right: 'right' };
  var CODES = { 19: 'up', 20: 'down', 21: 'left', 22: 'right', 38: 'up', 40: 'down', 37: 'left', 39: 'right' };
  function onKey(e) {
    if (e.defaultPrevented) return;
    var dir = KEYS[e.key] || CODES[e.keyCode];
    var t = D.activeElement;
    var typing = t && (TYPING.test(t.tagName) && !/^(checkbox|radio|button|submit|range|color)$/i.test(t.type || '') || t.isContentEditable);
    if (dir) {
      // let text boxes move their cursor and sliders change their value
      if (typing && (dir === 'left' || dir === 'right')) {
        var v = t.value || '', s = t.selectionStart, en = t.selectionEnd;
        if (s == null || (dir === 'left' && s > 0) || (dir === 'right' && en < v.length)) return;
      }
      if (t && t.tagName === 'INPUT' && t.type === 'range' && (dir === 'left' || dir === 'right')) return;
      if (t && t.tagName === 'SELECT' && t.size > 1) return;
      e.preventDefault();
      move(dir);
      return;
    }
    if (e.key === 'Enter' || e.keyCode === 13 || e.keyCode === 23) {
      if (typing) { showKeyboard(); return; }
      var el = focused && focused.isConnected ? focused : null;
      if (el && (el === t || el.contains(t) || !t || t === D.body)) activate(el, e);
      return;
    }
    // trying it on a computer: Backspace stands in for the remote's Back button
    if (!IN_SHELL && e.key === 'Backspace' && !typing) {
      e.preventDefault();
      if (!W.__tvBack()) history.back();
    }
  }

  // play / pause and skip buttons on the remote
  W.__tvMedia = W.__tvMedia || function (action) {
    var v = D.querySelector('video');
    if (!v) return false;
    if (action === 'playpause') { if (v.paused) v.play(); else v.pause(); }
    else if (action === 'play') v.play();
    else if (action === 'pause') v.pause();
    else if (action === 'ff') v.currentTime += 15;
    else if (action === 'rw') v.currentTime -= 15;
    return true;
  };

  /* ---------------- :hover styles also show on the focused item ---------------- */
  function mirrorHover() {
    var out = [];
    function walk(rules, sink) {
      for (var i = 0; i < rules.length; i++) {
        var r = rules[i];
        if (r.type === 1) {
          if (r.selectorText && r.selectorText.indexOf(':hover') >= 0) sink.push(r.selectorText.replace(/:hover/g, '.tvf') + '{' + r.style.cssText + '}');
        } else if (r.type === 4 && r.cssRules) {
          var inner = []; walk(r.cssRules, inner);
          if (!inner.length) continue;
          var m = r.media.mediaText;
          // TVs report no hover, so rules kept for mouse screens are applied without their condition
          if (/\(\s*(any-)?hover\s*:\s*hover\s*\)|\(\s*(any-)?pointer\s*:\s*fine\s*\)/.test(m)) sink.push(inner.join(''));
          else sink.push('@media ' + m + '{' + inner.join('') + '}');
        } else if (r.type === 12 && r.cssRules) {
          var inner2 = []; walk(r.cssRules, inner2);
          if (inner2.length) sink.push('@supports ' + r.conditionText + '{' + inner2.join('') + '}');
        }
      }
    }
    for (var i = 0; i < D.styleSheets.length; i++) {
      var sh = D.styleSheets[i], rules;
      if (sh.ownerNode && /^tvnav-/.test(sh.ownerNode.id || '')) continue;
      try { rules = sh.cssRules; } catch (e) { continue; }
      if (rules) walk(rules, out);
    }
    addStyle('tvnav-hover', out.join('\n'));
  }

  /* ---------------- start ---------------- */
  function start() {
    D.documentElement.classList.add('tv');
    addStyle('tvnav-css', CSS);
    ring = D.createElement('div'); ring.id = 'tvring'; D.body.appendChild(ring);
    toastEl = D.createElement('div'); toastEl.id = 'tvtoast'; D.body.appendChild(toastEl);
    mirrorHover();
    setTimeout(mirrorHover, 2500);
    W.addEventListener('keydown', onKey, false);
    W.addEventListener('scroll', function () { drawRing(); }, { capture: true, passive: true });
    W.addEventListener('resize', function () { dirty = true; drawRing(); });
    // a mouse or touch tap moves the ring there too
    D.addEventListener('pointerdown', function (e) {
      var root = topLayer() || D.body, list = candidates(root), n = e.target;
      while (n && n !== D.body) { if (list.indexOf(n) >= 0) { setFocus(n, { noScroll: true }); break; } n = n.parentElement; }
    }, true);
    setInterval(function () { checkLayer(); drawRing(); }, 300);
    setTimeout(function () { if (!focused) { var L = topLayer(); focusFirst(L || D.body); } }, 900);
  }

  W.__tvNav.focus = setFocus;
  W.__tvNav.move = move;
  W.__tvNav.toast = toast;
  W.__tvNav.refresh = function () { dirty = true; mirrorHover(); };
  W.__tvNav.focused = function () { return focused; };
  W.__tvToast = toast;

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', start);
  else start();
})();
