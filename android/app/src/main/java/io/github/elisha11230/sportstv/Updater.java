package io.github.elisha11230.sportstv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Updates from GitHub Releases. Every build on Actions is published as release "apk-N" with
 * versionCode N, so a release with a bigger N is newer than what's installed. A sideloaded app
 * can't install itself silently: this downloads the APK and opens the Fire TV installer, and the
 * person presses Install.
 */
class Updater {
    static final String TAG = "PressBoxTV";
    static final String LATEST = "https://api.github.com/repos/elisha11230/Sports-TV/releases/latest";
    static final long EVERY = 6L * 60 * 60 * 1000;

    final Activity act;
    boolean busy = false;
    long lastCheck = 0;
    int skipped = 0;   // "Later" on a build hides it until the app restarts

    Updater(Activity act) { this.act = act; }

    interface Found { void done(int build, String apkUrl, String error); }

    /** Quiet check: on launch and every few hours. Says nothing unless there's an update. */
    void checkIfDue() {
        long now = System.currentTimeMillis();
        if (busy || now - lastCheck < EVERY) return;
        lastCheck = now;
        latest((build, url, err) -> { if (err == null && url != null && build > BuildConfig.VERSION_CODE && build != skipped) offer(build, url); });
    }

    /** From the "Check for updates" button: always answers. */
    void checkNow() {
        lastCheck = System.currentTimeMillis();
        toast("Checking for updates…");
        latest((build, url, err) -> {
            if (err != null) toast("Couldn't check for updates (" + err + ")");
            else if (url != null && build > BuildConfig.VERSION_CODE) offer(build, url);
            else toast("Up to date (build " + BuildConfig.VERSION_CODE + ")");
        });
    }

    void latest(Found cb) {
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(LATEST).openConnection();
                c.setRequestProperty("Accept", "application/vnd.github+json");
                c.setRequestProperty("User-Agent", "PressBoxTV");
                c.setConnectTimeout(10000);
                c.setReadTimeout(15000);
                int code = c.getResponseCode();
                if (code != 200) throw new IOException("HTTP " + code);
                JSONObject j = new JSONObject(readAll(c.getInputStream()));
                String digits = j.optString("tag_name").replaceAll("\\D", "");
                int build = digits.isEmpty() ? 0 : Integer.parseInt(digits);
                String url = null;
                JSONArray assets = j.optJSONArray("assets");
                if (assets != null) for (int i = 0; i < assets.length(); i++) {
                    JSONObject a = assets.getJSONObject(i);
                    if (a.optString("name").endsWith(".apk")) { url = a.optString("browser_download_url"); break; }
                }
                final String u = url;
                act.runOnUiThread(() -> cb.done(build, u, null));
            } catch (Exception e) {
                Log.w(TAG, "update check", e);
                final String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                act.runOnUiThread(() -> cb.done(0, null, msg));
            }
        }).start();
    }

    void offer(int build, String url) {
        if (busy || act.isFinishing()) return;
        new AlertDialog.Builder(act, AlertDialog.THEME_DEVICE_DEFAULT_DARK)
            .setTitle("Update available")
            .setMessage("Press Box TV build " + build + " is ready. You have build " + BuildConfig.VERSION_CODE + ".")
            .setPositiveButton("Update", (d, w) -> download(build, url))
            .setNegativeButton("Later", (d, w) -> skipped = build)
            .show();
    }

    void download(int build, String url) {
        busy = true;
        final AlertDialog progress = new AlertDialog.Builder(act, AlertDialog.THEME_DEVICE_DEFAULT_DARK)
            .setTitle("Downloading update")
            .setMessage("Starting…")
            .setCancelable(false)
            .show();
        new Thread(() -> {
            try {
                // the installer has to be able to read the file: private cache via FileProvider,
                // or the app's external cache on very old Fire OS
                File dir = Build.VERSION.SDK_INT >= 24 ? new File(act.getCacheDir(), "updates") : new File(act.getExternalCacheDir(), "updates");
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("no space for the download");
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) //noinspection ResultOfMethodCallIgnored
                    f.delete();
                File apk = new File(dir, "PressBoxTV-" + build + ".apk");

                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setRequestProperty("User-Agent", "PressBoxTV");
                c.setConnectTimeout(15000);
                c.setReadTimeout(30000);
                int code = c.getResponseCode();
                if (code != 200) throw new IOException("HTTP " + code);
                long total = c.getContentLength();
                try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                    byte[] buf = new byte[16384];
                    long got = 0;
                    int n, lastPct = -1;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        got += n;
                        if (total > 0) {
                            int pct = (int) (got * 100 / total);
                            if (pct != lastPct && pct % 5 == 0) {
                                lastPct = pct;
                                final int p = pct;
                                act.runOnUiThread(() -> progress.setMessage(p + "%"));
                            }
                        }
                    }
                }
                if (Build.VERSION.SDK_INT < 24) //noinspection ResultOfMethodCallIgnored
                    apk.setReadable(true, false);
                act.runOnUiThread(() -> { progress.dismiss(); busy = false; install(apk); });
            } catch (Exception e) {
                Log.w(TAG, "update download", e);
                act.runOnUiThread(() -> { progress.dismiss(); busy = false; toast("Download failed. Try again later."); });
            }
        }).start();
    }

    void install(File apk) {
        // Fire OS 7 and newer ask once whether this app may install apps
        if (Build.VERSION.SDK_INT >= 26 && !act.getPackageManager().canRequestPackageInstalls()) {
            new AlertDialog.Builder(act, AlertDialog.THEME_DEVICE_DEFAULT_DARK)
                .setTitle("One time setup")
                .setMessage("Let Press Box TV install its updates: Settings → My Fire TV → Developer Options → Install unknown apps → Press Box TV → On. Then choose Update again.")
                .setPositiveButton("Open settings", (d, w) -> {
                    try {
                        act.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + act.getPackageName())));
                    } catch (Exception e) {
                        toast("Open Settings → My Fire TV → Developer Options → Install unknown apps");
                    }
                })
                .setNegativeButton("Later", null)
                .show();
            return;
        }
        try {
            Uri uri = Build.VERSION.SDK_INT >= 24
                ? FileProvider.getUriForFile(act, act.getPackageName() + ".files", apk)
                : Uri.fromFile(apk);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(i);
        } catch (Exception e) {
            Log.w(TAG, "update install", e);
            toast("Couldn't open the installer");
        }
    }

    void toast(String s) { Toast.makeText(act, s, Toast.LENGTH_LONG).show(); }

    static String readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return out.toString("UTF-8");
    }
}
