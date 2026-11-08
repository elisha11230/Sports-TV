/* Press Box TV: remote control for embedded players.
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

  function status(v) {
    if (!v) return { has: false };
    var e = edges(v), live = !isFinite(v.duration) || v.duration > 86400;
    return { has: true, paused: v.paused, muted: v.muted, t: v.currentTime, d: live ? null : v.duration,
             live: live, behind: live ? Math.max(0, e[1] - v.currentTime) : 0, filled: filled === v };
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
        setTimeout(function () { reply(status(v)); }, 150);
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
