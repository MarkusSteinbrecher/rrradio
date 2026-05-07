package org.rrradio.android

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import org.rrradio.android.ui.RrradioApp
import org.rrradio.android.ui.RrradioViewModel
import org.rrradio.android.ui.theme.RrradioTheme

class MainActivity : ComponentActivity() {
    private val viewModel: RrradioViewModel by viewModels()
    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        setContent {
            val state by viewModel.uiState.collectAsState()
            RrradioTheme(darkTheme = state.darkTheme) {
                RrradioApp(state = state, actions = viewModel)
            }
        }
    }
}
