package io.github.elisha11230.sportstv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.pm.ActivityInfo;
import android.app.UiModeManager;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.speech.RecognizerIntent;
import java.util.ArrayList;
import android.util.Log;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;

/**
 * EB Sports: a full screen web view of the sports pages on GitHub Pages, set up for a TV remote.
 *
 * The pages do the real work. This app adds what a page can't do on its own:
 *  - loads the remote layer (tv-nav.js) into every page it opens, NBA and NFL apps included
 *  - turns the remote's Select into Enter, and Back into "close the top panel, then go back"
 *  - opens other installed apps, clicks inside a video player, keeps the screen awake
 */
public class MainActivity extends Activity {

    static final String TAG = "EBSports";
    static final String ORIGIN = "https://elisha11230.github.io";
    static final String HOME = ORIGIN + "/Sports-TV/";

    // adds tv-nav.js to a page (once); it refreshes from the site every hour
    static String loader(boolean tv) {
        return "(function(){window.__STV_DEVICE='" + (tv ? "tv" : "phone") + "';" +
            (tv ? LOADER : "window.__STV_SHELL=1;") + "})();";
    }
    static final String LOADER =
        "(function(){if(window.__stvLoader)return;window.__stvLoader=1;window.__STV_SHELL=1;" +
        "function go(){if(window.__tvNav)return;var s=document.createElement('script');" +
        "s.src='" + HOME + "tv/tv-nav.js?v='+Math.floor(Date.now()/3600000);" +
        "(document.head||document.documentElement).appendChild(s);}" +
        "if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go);else go();})();";

    static final String BACK_JS =
        "(function(){try{return window.__tvBack?window.__tvBack():false}catch(e){return false}})()";

    static final String OFFLINE_HTML =
        "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>" +
        "<style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0A111E;color:#EAF0F8;" +
        "font-family:sans-serif;text-align:center}h1{font-size:28px;margin:0 0 8px}p{color:#97A6BF;margin:0 0 24px}" +
        "button{font-size:20px;padding:12px 28px;border-radius:12px;border:3px solid #FFD54A;background:#18243C;color:#fff}" +
        "</style></head><body><div><h1>Can't reach the internet</h1><p>Check the Fire TV's connection, then try again.</p>" +
        "<button id='b' autofocus onclick=\"location.replace('" + HOME + "')\">Try again</button></div>" +
        "<script>document.getElementById('b').focus()</script></body></html>";

    WebView web;
    FrameLayout root;
    View fullView;
    WebChromeClient.CustomViewCallback fullCallback;
    SharedPreferences prefs;
    boolean docStartScript = false;
    boolean isTv = true;
    // made fresh each launch; only the player page gets it, and embedded players obey only commands carrying it
    final String frameKey = UUID.randomUUID().toString();
    long lastBackAtHome = 0;
    Updater updater;
    // the one outside address the player page may send the whole app to ("Open full page")
    volatile String allowedNav = null;

    // the pages that show stream sites: the player and multiview. Popups, redirects and app links are blocked there.
    boolean onPlayer() { String u = web.getUrl(); return u != null && u.startsWith(HOME) && (u.contains("player.html") || u.contains("multi.html")); }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs = getSharedPreferences("stv", MODE_PRIVATE);
        // a TV (Fire TV, Android TV) gets the remote layout; a phone or tablet gets touch and free rotation
        UiModeManager ui = (UiModeManager) getSystemService(Context.UI_MODE_SERVICE);
        isTv = (ui != null && ui.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION)
            || getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK)
            || getPackageManager().hasSystemFeature("amazon.hardware.fire_tv");
        setRequestedOrientation(isTv ? ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_FULL_USER);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0A111E"));
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        // new windows go through onCreateWindow below: popups are dropped, a link our apps open in a new tab loads here
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setTextZoom(prefs.getInt("textZoom", 100));
        s.setUserAgentString(s.getUserAgentString() + " SportsTV/" + BuildConfig.VERSION_NAME + (isTv ? " TV" : " Phone"));
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        Set<String> origins = Collections.singleton(ORIGIN);
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            try {
                WebViewCompat.addDocumentStartJavaScript(web, loader(isTv), origins);
                docStartScript = true;
            } catch (Exception e) { Log.w(TAG, "document start script", e); }
        }
        // embedded players (any site) get a small script that takes play, pause and skip commands from the player page
        if (docStartScript) {
            String frame = readAsset("frame-control.js");
            if (frame != null) {
                try { WebViewCompat.addDocumentStartJavaScript(web, frame.replace("__KEY__", frameKey), Collections.singleton("*")); }
                catch (Exception e) { Log.w(TAG, "frame control script", e); }
            }
        }
        // the pages talk to the app through window.SportsTV; only the sports site gets it, not embedded players
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "SportsTV", origins, (view, message, sourceOrigin, isMainFrame, reply) -> {
                String out = handle(message.getData());
                if (out != null) reply.postMessage(out);
            });
        } else {
            web.addJavascriptInterface(new Legacy(), "SportsTVLegacy");
        }

        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        web.requestFocus();

        if (saved != null) web.restoreState(saved);
        else web.loadUrl(HOME);

        // look for a newer build a little after launch, then every few hours while the app stays open
        updater = new Updater(this);
        web.postDelayed(() -> updater.checkIfDue(), 6000);
    }

    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
    @Override protected void onPause() { super.onPause(); web.onPause(); }
    @Override protected void onResume() { super.onResume(); web.onResume(); if (updater != null) updater.checkIfDue(); }
    @Override protected void onDestroy() { if (web != null) { web.destroy(); } super.onDestroy(); }

    /* ---------------- the remote ---------------- */

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int code = e.getKeyCode();
        boolean down = e.getAction() == KeyEvent.ACTION_DOWN;
        switch (code) {
            case KeyEvent.KEYCODE_BACK:
                if (down && e.getRepeatCount() == 0) onRemoteBack();
                return true;
            case KeyEvent.KEYCODE_MENU:
                if (down && e.getRepeatCount() == 0) web.evaluateJavascript("window.__tvMenu&&window.__tvMenu()", null);
                return true;
            // a remote or keyboard Search key opens search on the home screen
            case KeyEvent.KEYCODE_SEARCH:
                if (down && e.getRepeatCount() == 0) web.evaluateJavascript("window.__tvSearch?window.__tvSearch():(location.href='index.html#search')", null);
                return true;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_PLAY:
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
            case KeyEvent.KEYCODE_MEDIA_REWIND:
                if (fullView != null) return super.dispatchKeyEvent(e);
                if (down && e.getRepeatCount() == 0) {
                    String a = code == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD ? "ff" : code == KeyEvent.KEYCODE_MEDIA_REWIND ? "rw"
                        : code == KeyEvent.KEYCODE_MEDIA_PLAY ? "play" : code == KeyEvent.KEYCODE_MEDIA_PAUSE ? "pause" : "playpause";
                    web.evaluateJavascript("window.__tvMedia&&window.__tvMedia('" + a + "')", null);
                }
                return true;
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
                // the page sees Select as Enter, the same as a keyboard
                if (fullView == null) {
                    return web.dispatchKeyEvent(new KeyEvent(e.getDownTime(), e.getEventTime(), e.getAction(),
                        KeyEvent.KEYCODE_ENTER, e.getRepeatCount(), e.getMetaState()));
                }
                break;
        }
        return super.dispatchKeyEvent(e);
    }

    void onRemoteBack() {
        if (fullView != null) { exitFullscreen(); return; }
        // first the page: close a panel, a player card, the player controls
        web.evaluateJavascript(BACK_JS, handled -> {
            if ("true".equals(handled)) return;
            if (web.canGoBack()) { web.goBack(); return; }
            String url = web.getUrl();
            if (url == null || !url.startsWith(HOME) || url.contains("player.html")) { web.loadUrl(HOME); return; }
            long now = SystemClock.elapsedRealtime();
            if (now - lastBackAtHome < 2200) { finish(); return; }
            lastBackAtHome = now;
            Toast.makeText(this, "Press Back again to exit", Toast.LENGTH_SHORT).show();
        });
    }

    /* ---------------- talking to search ----------------
       Uses the device's speech service (phones with Google, and Fire TVs that have one). The words
       go back to the page through window.__tvHeard. Returns false when there's no speech service. */
    static final int REQ_SPEAK = 7101;

    boolean listen(String prompt) {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_PROMPT, prompt);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
        if (i.resolveActivity(getPackageManager()) == null) return false;
        runOnUiThread(() -> {
            try { startActivityForResult(i, REQ_SPEAK); }
            catch (Exception e) { heard(null); }
        });
        return true;
    }

    void heard(String text) {
        String js = "window.__tvHeard&&window.__tvHeard(" + (text == null ? "null" : JSONObject.quote(text)) + ")";
        runOnUiThread(() -> web.evaluateJavascript(js, null));
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req != REQ_SPEAK) return;
        ArrayList<String> got = (res == RESULT_OK && data != null) ? data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS) : null;
        heard(got != null && !got.isEmpty() ? got.get(0) : null);
    }

    /* ---------------- what the pages can ask for ---------------- */

    /** A request is {"id":1,"m":"launchApp","a":["com.example"]}; the answer is {"id":1,"r":...}. */
    String handle(String json) {
        try {
            JSONObject in = new JSONObject(json);
            String m = in.optString("m");
            JSONArray a = in.optJSONArray("a");
            if (a == null) a = new JSONArray();
            Object r = null;
            switch (m) {
                case "version": r = BuildConfig.VERSION_NAME; break;
                case "build": r = BuildConfig.VERSION_CODE; break;
                case "checkUpdate": runOnUiThread(() -> updater.checkNow()); r = true; break;
                case "allowNav": allowedNav = a.optString(0, null); r = true; break;
                case "device": r = isTv ? "tv" : "phone"; break;
                case "orientation": {
                    // the player and multiview turn a phone sideways; other pages rotate freely
                    if (isTv) { r = false; break; }
                    String o = a.optString(0, "auto");
                    final int req = "landscape".equals(o) ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_FULL_USER;
                    runOnUiThread(() -> setRequestedOrientation(req));
                    r = true; break;
                }
                case "frameKey": r = docStartScript ? frameKey : JSONObject.NULL; break;
                case "launchApp": r = launchApp(a.optString(0)); break;
                case "listApps": r = listApps(); break;
                case "setTextZoom": {
                    int z = Math.max(50, Math.min(200, a.optInt(0, 100)));
                    prefs.edit().putInt("textZoom", z).apply();
                    runOnUiThread(() -> web.getSettings().setTextZoom(z));
                    r = true; break;
                }
                case "keepAwake": {
                    boolean on = a.optBoolean(0, true);
                    runOnUiThread(() -> {
                        if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    });
                    r = true; break;
                }
                case "showKeyboard":
                    runOnUiThread(() -> {
                        web.requestFocus();
                        InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                        if (imm != null) imm.showSoftInput(web, InputMethodManager.SHOW_IMPLICIT);
                    });
                    r = true; break;
                case "listen": r = listen(a.optString(0, "Say a team or a game")); break;
                case "tap": r = tap((float) a.optDouble(0, 0.5), (float) a.optDouble(1, 0.5)); break;
                case "exit": runOnUiThread(this::finish); r = true; break;
                default: r = JSONObject.NULL;
            }
            JSONObject out = new JSONObject();
            out.put("id", in.opt("id"));
            out.put("r", r == null ? JSONObject.NULL : r);
            return out.toString();
        } catch (Exception e) {
            Log.w(TAG, "bridge", e);
            return null;
        }
    }

    boolean launchApp(String pkg) {
        if (pkg == null || pkg.isEmpty()) return false;
        PackageManager pm = getPackageManager();
        Intent i = null;
        try { i = pm.getLeanbackLaunchIntentForPackage(pkg); } catch (Exception ignored) {}
        if (i == null) i = pm.getLaunchIntentForPackage(pkg);
        if (i == null) return false;
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        final Intent go = i;
        try { runOnUiThread(() -> startActivity(go)); return true; }
        catch (ActivityNotFoundException e) { return false; }
    }

    JSONArray listApps() {
        PackageManager pm = getPackageManager();
        List<ResolveInfo> all = new ArrayList<>();
        for (String cat : new String[]{Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER}) {
            Intent q = new Intent(Intent.ACTION_MAIN).addCategory(cat);
            try { all.addAll(pm.queryIntentActivities(q, 0)); } catch (Exception ignored) {}
        }
        Set<String> seen = new HashSet<>();
        List<JSONObject> rows = new ArrayList<>();
        for (ResolveInfo ri : all) {
            String pkg = ri.activityInfo.packageName;
            if (pkg.equals(getPackageName()) || !seen.add(pkg)) continue;
            try {
                JSONObject o = new JSONObject();
                o.put("pkg", pkg);
                o.put("label", String.valueOf(ri.loadLabel(pm)));
                rows.add(o);
            } catch (Exception ignored) {}
        }
        Collections.sort(rows, (x, y) -> x.optString("label").compareToIgnoreCase(y.optString("label")));
        JSONArray out = new JSONArray();
        for (JSONObject o : rows) out.put(o);
        return out;
    }

    /** Taps the screen at a spot (0 to 1 across and down), so a player's own play button can be pressed. */
    boolean tap(float fx, float fy) {
        runOnUiThread(() -> {
            float x = web.getWidth() * fx, y = web.getHeight() * fy;
            long t = SystemClock.uptimeMillis();
            MotionEvent d = MotionEvent.obtain(t, t, MotionEvent.ACTION_DOWN, x, y, 0);
            d.setSource(InputDevice.SOURCE_TOUCHSCREEN);
            web.dispatchTouchEvent(d);
            d.recycle();
            web.postDelayed(() -> {
                long t2 = SystemClock.uptimeMillis();
                MotionEvent u = MotionEvent.obtain(t, t2, MotionEvent.ACTION_UP, x, y, 0);
                u.setSource(InputDevice.SOURCE_TOUCHSCREEN);
                web.dispatchTouchEvent(u);
                u.recycle();
            }, 70);
        });
        return true;
    }

    String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } catch (Exception e) {
            Log.w(TAG, "asset " + name, e);
            return null;
        }
    }

    /** For old Fire TV web views without message listeners. */
    class Legacy {
        @JavascriptInterface public String call(String json) { return handle(json); }
    }

    /* ---------------- page loading ---------------- */

    class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            String scheme = u.getScheme() == null ? "" : u.getScheme();
            // while a game plays, an embed can't redirect the app to another site (ad redirects)
            if (req.isForMainFrame() && onPlayer() && !u.toString().startsWith(ORIGIN)) {
                String ok = allowedNav;
                if (ok != null && ok.equals(u.toString())) { allowedNav = null; return false; }
                Log.i(TAG, "blocked redirect from player: " + u);
                return true;
            }
            if (scheme.equals("http") || scheme.equals("https") || scheme.equals("about") || scheme.equals("data")) return false;
            // app links (intent:, market:) from inside a player are ignored too
            if (onPlayer()) return true;
            try {
                Intent i = scheme.equals("intent") ? Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME) : new Intent(Intent.ACTION_VIEW, u);
                i.addCategory(Intent.CATEGORY_BROWSABLE);
                i.setComponent(null);
                startActivity(i);
            } catch (Exception e) {
                if (scheme.equals("intent")) {
                    try {
                        String fallback = Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME).getStringExtra("browser_fallback_url");
                        if (fallback != null) view.loadUrl(fallback);
                    } catch (Exception ignored) {}
                }
            }
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            // pages from other sites, and older web views, get the remote layer here
            if (url != null && url.startsWith("http")) view.evaluateJavascript(loader(isTv), null);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
            if (req.isForMainFrame()) view.loadDataWithBaseURL(null, OFFLINE_HTML, "text/html", "utf-8", null);
        }
    }

    class Chrome extends WebChromeClient {
        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
            // popups: always dropped on the player page, and anywhere when nobody pressed anything
            if (onPlayer() || !isUserGesture) { Log.i(TAG, "blocked popup"); return false; }
            // a link one of the apps opens in a new tab (a highlight, a box score): show it in this window
            WebView catcher = new WebView(MainActivity.this);
            catcher.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                    String target = r.getUrl().toString();
                    if (target.startsWith("http")) web.loadUrl(target);
                    v.destroy();
                    return true;
                }
            });
            ((WebView.WebViewTransport) resultMsg.obj).setWebView(catcher);
            resultMsg.sendToTarget();
            return true;
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback cb) {
            if (fullView != null) { cb.onCustomViewHidden(); return; }
            fullView = view;
            fullCallback = cb;
            root.addView(view, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
            web.setVisibility(View.GONE);
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            view.requestFocus();
        }

        @Override
        public void onHideCustomView() { exitFullscreen(); }

        @Override
        public Bitmap getDefaultVideoPoster() {
            // no grey play button over videos before they start
            Bitmap b = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
            b.eraseColor(Color.BLACK);
            return b;
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            // protected video (some official players) asks for this; nothing else is granted
            for (String r : request.getResources()) {
                if (PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID.equals(r)) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID});
                    return;
                }
            }
            request.deny();
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage m) {
            Log.d(TAG, m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
            return true;
        }
    }

    void exitFullscreen() {
        if (fullView == null) return;
        root.removeView(fullView);
        fullView = null;
        web.setVisibility(View.VISIBLE);
        web.requestFocus();
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (fullCallback != null) { fullCallback.onCustomViewHidden(); fullCallback = null; }
    }
}
