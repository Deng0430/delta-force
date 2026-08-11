package com.d4820.deltaforce.tacticalmap;

import android.os.Bundle;
import android.os.Build;
import android.graphics.Color;
import android.view.View;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.core.view.ViewCompat;
import androidx.core.graphics.Insets;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        enableDisplayCutoutLayout();
        applyWindowBackgrounds();
        installSafeAreaBridge();
        enableImmersiveMode();
    }

    @Override
    public void onResume() {
        super.onResume();
        enableImmersiveMode();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enableImmersiveMode();
        }
    }

    private void enableImmersiveMode() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

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

    private void applyWindowBackgrounds() {
        int appBackground = Color.rgb(2, 11, 16);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        getWindow().getDecorView().setBackgroundColor(appBackground);
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(appBackground);
        }
    }

    private void installSafeAreaBridge() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        View webViewParent = (View) getBridge().getWebView().getParent();
        ViewCompat.setOnApplyWindowInsetsListener(webViewParent, (view, windowInsets) -> {
            Insets safeArea = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            view.setPadding(0, 0, 0, 0);
            float density = getResources().getDisplayMetrics().density;
            int top = Math.round(safeArea.top / density);
            int right = Math.round(safeArea.right / density);
            int bottom = Math.round(safeArea.bottom / density);
            int left = Math.round(safeArea.left / density);
            String script = "document.documentElement.style.setProperty('--safe-area-inset-top','" + top + "px');" +
                "document.documentElement.style.setProperty('--safe-area-inset-right','" + right + "px');" +
                "document.documentElement.style.setProperty('--safe-area-inset-bottom','" + bottom + "px');" +
                "document.documentElement.style.setProperty('--safe-area-inset-left','" + left + "px');";
            getBridge().getWebView().evaluateJavascript(script, null);
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(webViewParent);
    }
}
