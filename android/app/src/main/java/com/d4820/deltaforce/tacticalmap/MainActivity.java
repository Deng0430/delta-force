package com.d4820.deltaforce.tacticalmap;

import android.os.Bundle;
import android.os.Build;
import android.graphics.Color;
import android.view.View;
import android.view.ViewParent;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.core.view.ViewCompat;
import androidx.core.graphics.Insets;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    private int safeAreaTop = -1;
    private int safeAreaRight = -1;
    private int safeAreaBottom = -1;
    private int safeAreaLeft = -1;
    private int pushedSafeAreaTop = Integer.MIN_VALUE;
    private int pushedSafeAreaRight = Integer.MIN_VALUE;
    private int pushedSafeAreaBottom = Integer.MIN_VALUE;
    private int pushedSafeAreaLeft = Integer.MIN_VALUE;
    private boolean webContentReady = false;
    private boolean immersiveAppliedForCurrentFocus = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Configure the Activity window before Capacitor creates and attaches the WebView.
        // This avoids changing cutout/edge-to-edge geometry during the first WebView frame.
        configureWindowBeforeContent();
        super.onCreate(savedInstanceState);
        applyWebViewBackground();
        installWebContentLifecycleBridge();
        installSafeAreaBridge();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (!hasFocus) {
            immersiveAppliedForCurrentFocus = false;
            return;
        }
        if (!immersiveAppliedForCurrentFocus) {
            immersiveAppliedForCurrentFocus = true;
            hideSystemBars();
        }
    }

    private void configureWindowBeforeContent() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        enableDisplayCutoutLayout();

        int appBackground = Color.rgb(2, 11, 16);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        getWindow().getDecorView().setBackgroundColor(appBackground);
    }

    private void hideSystemBars() {
        View decorView = getWindow().getDecorView();
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), decorView);
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        );
    }

    private void enableDisplayCutoutLayout() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attributes = getWindow().getAttributes();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                attributes.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
            } else {
                attributes.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            }
            getWindow().setAttributes(attributes);
        }
    }

    private void applyWebViewBackground() {
        int appBackground = Color.rgb(2, 11, 16);
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(appBackground);
        }
    }

    private void installWebContentLifecycleBridge() {
        if (getBridge() == null) return;
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageStarted(WebView webView) {
                webContentReady = false;
                resetPushedSafeArea();
            }

            @Override
            public void onPageLoaded(WebView webView) {
                webContentReady = true;
                pushSafeAreaIfChanged();
            }
        });
    }

    private void installSafeAreaBridge() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        ViewParent parent = getBridge().getWebView().getParent();
        if (!(parent instanceof View)) return;
        View webViewParent = (View) parent;
        webViewParent.setPadding(0, 0, 0, 0);
        ViewCompat.setOnApplyWindowInsetsListener(webViewParent, (view, windowInsets) -> {
            Insets safeArea = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            float density = getResources().getDisplayMetrics().density;
            int nextTop = Math.round(safeArea.top / density);
            int nextRight = Math.round(safeArea.right / density);
            int nextBottom = Math.round(safeArea.bottom / density);
            int nextLeft = Math.round(safeArea.left / density);
            if (nextTop != safeAreaTop || nextRight != safeAreaRight ||
                nextBottom != safeAreaBottom || nextLeft != safeAreaLeft) {
                safeAreaTop = nextTop;
                safeAreaRight = nextRight;
                safeAreaBottom = nextBottom;
                safeAreaLeft = nextLeft;
                pushSafeAreaIfChanged();
            }
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(webViewParent);
    }

    private void pushSafeAreaIfChanged() {
        if (!webContentReady || safeAreaTop < 0 || getBridge() == null || getBridge().getWebView() == null) return;
        if (safeAreaTop == pushedSafeAreaTop && safeAreaRight == pushedSafeAreaRight &&
            safeAreaBottom == pushedSafeAreaBottom && safeAreaLeft == pushedSafeAreaLeft) return;

        final String script = "(function(){" +
            "var root=document.documentElement;if(!root)return false;" +
            "root.style.setProperty('--safe-area-inset-top','" + safeAreaTop + "px');" +
            "root.style.setProperty('--safe-area-inset-right','" + safeAreaRight + "px');" +
            "root.style.setProperty('--safe-area-inset-bottom','" + safeAreaBottom + "px');" +
            "root.style.setProperty('--safe-area-inset-left','" + safeAreaLeft + "px');" +
            "return true;})()";
        pushedSafeAreaTop = safeAreaTop;
        pushedSafeAreaRight = safeAreaRight;
        pushedSafeAreaBottom = safeAreaBottom;
        pushedSafeAreaLeft = safeAreaLeft;
        getBridge().getWebView().evaluateJavascript(script, null);
    }

    private void resetPushedSafeArea() {
        pushedSafeAreaTop = Integer.MIN_VALUE;
        pushedSafeAreaRight = Integer.MIN_VALUE;
        pushedSafeAreaBottom = Integer.MIN_VALUE;
        pushedSafeAreaLeft = Integer.MIN_VALUE;
    }
}
