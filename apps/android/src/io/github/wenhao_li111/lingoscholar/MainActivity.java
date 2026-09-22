package io.github.wenhao_li111.lingoscholar;

import android.app.Activity;
import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.util.List;

/** Online companion: use the browser's secure session, PDF renderer and speech engine.
 * No WebView bridges, credential storage, analytics or background permissions. */
public final class MainActivity extends Activity {
    private static final String STUDY = "https://193.112.29.89/#/home";
    private static final String GUIDE = "https://wenhao-li111.github.io/lingo-scholar/";
    private static final int GREEN = Color.rgb(25, 62, 54);
    private int dp(int n) { return Math.round(n * getResources().getDisplayMetrics().density); }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.rgb(247, 245, 239));
        scroll.setFitsSystemWindows(true);
        // Android 15+ edge-to-edge: keep buttons clear of the status/navigation bars.
        scroll.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(24), dp(32), dp(24), dp(32));
        scroll.addView(body);
        text(body, "LINGO SCHOLAR", 14, false);
        text(body, "听词研习室", 34, true);
        text(body, "每天 20 个词\n把单词记进句子，把进步留在每一天。", 18, false);
        button(body, "开始 / 继续学习 →", () -> open(STUDY), true);
        button(body, "网站入口与使用说明", () -> open(GUIDE), false);
        text(body, "01  在语境中记忆", 22, true);
        text(body, "词义四选一、看义拼写、听音默写。答完对照例句和翻译。", 16, false);
        text(body, "02  换设备，接着学", 22, true);
        text(body, "使用同一邮箱登录。保持联网，让词库、收藏和听读进度从云端同步。", 16, false);
        text(body, "03  和好友一起进步", 22, true);
        text(body, "邮箱添加好友，用正确率积累星星。", 16, false);
        text(body, "安卓轻量安装版 · 1.0.0\n学习在系统浏览器支持的应用内页面中打开；不支持时会打开浏览器。需要联网和支持 HTTPS 的浏览器。\n\n没有离线教材包，不是完全原生学习引擎。APK 本身不保存密码，不申请通讯录、存储或录音权限。", 13, false);
        setContentView(scroll);
    }

    private void text(LinearLayout body, String value, int size, boolean bold) {
        TextView t = new TextView(this);
        t.setText(value); t.setTextSize(size); t.setTextColor(GREEN);
        t.setLineSpacing(dp(5), 1f);
        if (bold) t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
        p.topMargin = dp(18); body.addView(t, p);
    }

    private void button(LinearLayout body, String label, Runnable action, boolean primary) {
        Button b = new Button(this); b.setText(label); b.setTextSize(17);
        b.setAllCaps(false); b.setMinHeight(dp(56)); b.setPadding(dp(16), dp(12), dp(16), dp(12));
        b.setTextColor(primary ? Color.WHITE : GREEN);
        GradientDrawable background = new GradientDrawable();
        background.setColor(primary ? GREEN : Color.rgb(235, 212, 154));
        background.setCornerRadius(dp(14)); b.setBackground(background);
        b.setOnClickListener(v -> action.run());
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
        p.topMargin = dp(20); body.addView(b, p);
    }

    private void open(String url) {
        // Only these constants are accepted. Never forward arbitrary incoming intents/URLs.
        if (!STUDY.equals(url) && !GUIDE.equals(url)) return;
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        ResolveInfo defaultBrowser = getPackageManager().resolveActivity(intent, 0);
        List<ResolveInfo> providers = getPackageManager().queryIntentServices(
                new Intent("android.support.customtabs.action.CustomTabsService"), 0);
        String provider = null;
        for (ResolveInfo p : providers) {
            if (provider == null) provider = p.serviceInfo.packageName;
            if (defaultBrowser != null && p.serviceInfo.packageName.equals(defaultBrowser.activityInfo.packageName)) {
                provider = p.serviceInfo.packageName; break;
            }
        }
        if (provider != null) {
            intent.setPackage(provider);
            Bundle extras = new Bundle();
            extras.putBinder("android.support.customtabs.extra.SESSION", null);
            extras.putInt("android.support.customtabs.extra.TOOLBAR_COLOR", GREEN);
            extras.putInt("android.support.customtabs.extra.TITLE_VISIBILITY", 1);
            intent.putExtras(extras);
        }
        try { startActivity(intent); }
        catch (ActivityNotFoundException e) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
            catch (ActivityNotFoundException absent) { Toast.makeText(this, "请先安装支持 HTTPS 的浏览器，再打开学习网站。", Toast.LENGTH_LONG).show(); }
        }
    }
}
