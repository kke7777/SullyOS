package com.kke7777.nuomi;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AmsgUnifiedPushPlugin.class);
        registerPlugin(NativeSystemBarsPlugin.class);
        registerPlugin(PhotoLibraryPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
