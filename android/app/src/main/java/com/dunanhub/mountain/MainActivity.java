package com.dunanhub.mountain;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TrackingWidgetPlugin.class);
        super.onCreate(savedInstanceState);
    }
}