package com.kke7777.nuomi;

import static org.junit.Assert.*;
import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.graphics.Insets;
import androidx.core.view.WindowInsetsCompat;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {28, 34})
public class NativeSystemBarsTest {
    @Test public void restoresRealTransparentStatusBarAndAllowsCutoutBackground() {
        Activity activity = Robolectric.buildActivity(Activity.class).setup().get();
        Window window = activity.getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        NativeSystemBarsPlugin.configureWindow(window);
        assertEquals(0, window.getAttributes().flags & WindowManager.LayoutParams.FLAG_FULLSCREEN);
        assertEquals(Color.TRANSPARENT, window.getStatusBarColor());
        assertEquals(WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES,
                window.getAttributes().layoutInDisplayCutoutMode);
        if (Build.VERSION.SDK_INT < 30) {
            assertTrue((window.getDecorView().getSystemUiVisibility() & View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN) != 0);
        } else {
            assertFalse(window.isStatusBarContrastEnforced());
        }
    }

    @Test public void keyboardAndRotationReserveSpaceOnceAndRestoreAfterKeyboardCloses() {
        Activity activity = Robolectric.buildActivity(Activity.class).setup().get();
        View content = new View(activity);
        WindowInsetsCompat portrait = new WindowInsetsCompat.Builder()
                .setInsets(WindowInsetsCompat.Type.statusBars(), Insets.of(0, 32, 0, 0))
                .setInsets(WindowInsetsCompat.Type.navigationBars(), Insets.of(0, 0, 0, 24)).build();
        assertEquals(32, NativeSystemBarsPlugin.applyInsets(content, portrait));
        assertEquals(0, content.getPaddingTop());
        assertEquals(24, content.getPaddingBottom());
        WindowInsetsCompat keyboard = new WindowInsetsCompat.Builder(portrait)
                .setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, 300)).build();
        assertEquals(32, NativeSystemBarsPlugin.applyInsets(content, keyboard));
        assertEquals(300, content.getPaddingBottom());
        NativeSystemBarsPlugin.applyInsets(content, portrait);
        assertEquals(24, content.getPaddingBottom());
        WindowInsetsCompat landscape = new WindowInsetsCompat.Builder()
                .setInsets(WindowInsetsCompat.Type.systemBars(), Insets.of(40, 24, 20, 0)).build();
        assertEquals(24, NativeSystemBarsPlugin.applyInsets(content, landscape));
        assertEquals(40, content.getPaddingLeft());
        assertEquals(20, content.getPaddingRight());
        assertEquals(0, content.getPaddingBottom());
    }
}
