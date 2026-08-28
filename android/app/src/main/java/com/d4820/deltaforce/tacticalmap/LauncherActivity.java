package com.d4820.deltaforce.tacticalmap;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.ViewTreeObserver;

import androidx.core.splashscreen.SplashScreen;

/**
 * Owns the Android system splash in the launcher's current orientation. The WebView Activity is
 * started only after this lightweight window has drawn and received focus, so Android never has
 * to rotate the splash surface and create the WebView surface in the same transition.
 */
public class LauncherActivity extends Activity {
    private boolean mainActivityStarted = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        // The emulator failure leaves the platform splash reveal leash alive. Remove the splash
        // surface as soon as Android hands it to us; the native launch surface below remains dark.
        splashScreen.setOnExitAnimationListener(provider -> provider.remove());
        super.onCreate(savedInstanceState);

        View launchSurface = new View(this);
        launchSurface.setBackgroundColor(Color.rgb(2, 11, 16));
        setContentView(launchSurface);

        launchSurface.getViewTreeObserver().addOnPreDrawListener(new ViewTreeObserver.OnPreDrawListener() {
            @Override
            public boolean onPreDraw() {
                launchSurface.getViewTreeObserver().removeOnPreDrawListener(this);
                launchSurface.postOnAnimation(LauncherActivity.this::startMainActivity);
                return true;
            }
        });
    }

    private void startMainActivity() {
        if (mainActivityStarted || isFinishing()) return;
        mainActivityStarted = true;

        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(intent);
        finish();
        overridePendingTransition(0, 0);
    }
}
