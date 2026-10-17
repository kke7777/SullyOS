package com.kke7777.nuomi;

import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Draw the real system status bar over the web page; never synthesize a clock. */
@CapacitorPlugin(name = "NativeSystemBars")
public class NativeSystemBarsPlugin extends Plugin {
    private View content;
    private int topInset;

    @SuppressWarnings("deprecation")
    static void configureWindow(Window window) {
        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN
                | WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams attributes = window.getAttributes();
            attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(attributes);
        }
        if (Build.VERSION.SDK_INT >= 29) window.setStatusBarContrastEnforced(false);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.show(WindowInsetsCompat.Type.statusBars());
        controller.setAppearanceLightStatusBars(true);
    }

    /** Bottom/side intrusions are reserved natively; only top is reserved in CSS. */
    static int applyInsets(View content, WindowInsetsCompat insets) {
        Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        int keyboard = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
        content.setPadding(bars.left, 0, bars.right, Math.max(bars.bottom, keyboard));
        return bars.top;
    }

    @Override public void load() {
        getActivity().runOnUiThread(() -> {
            configureWindow(getActivity().getWindow());
            content = (View) getBridge().getWebView().getParent();
            ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
                topInset = applyInsets(view, insets);
                notifyListeners("insetsChanged", insetResult());
                // WebView must not add a second native/IME inset via CSS env().
                // The decor view still owns the original insets for Keyboard events.
                return WindowInsetsCompat.CONSUMED;
            });
            ViewCompat.requestApplyInsets(content);
        });
    }

    private JSObject insetResult() {
        JSObject result = new JSObject();
        result.put("top", topInset / getContext().getResources().getDisplayMetrics().density);
        return result;
    }

    @PluginMethod public void getInsets(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (content != null) {
                WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(content);
                if (insets != null) topInset = applyInsets(content, insets);
            }
            call.resolve(insetResult());
        });
    }

    @PluginMethod public void setDarkIcons(PluginCall call) {
        boolean dark = call.getBoolean("dark", true);
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            WindowCompat.getInsetsController(window, window.getDecorView()).setAppearanceLightStatusBars(dark);
            call.resolve();
        });
    }

    @Override protected void handleOnResume() {
        if (content != null) getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            WindowCompat.getInsetsController(window, window.getDecorView()).show(WindowInsetsCompat.Type.statusBars());
            ViewCompat.requestApplyInsets(content);
        });
    }
}
