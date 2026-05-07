package org.rrradio.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val RrGreen = Color(0xFF00A040)
val RrYellow = Color(0xFFFFFF00)
val RrLightBg = Color(0xFFF8F8F3)
val RrLightPanel = Color(0xFFFFFFFB)
val RrLightInk = Color(0xFF0E0E0D)
val RrDarkBg = Color(0xFF0A0A0A)
val RrDarkPanel = Color(0xFF131313)
val RrDarkInk = Color(0xFFF4F4F2)

@Composable
fun RrradioTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) darkScheme else lightScheme,
        content = content,
    )
}

private val lightScheme: ColorScheme = lightColorScheme(
    primary = RrGreen,
    onPrimary = RrLightBg,
    background = RrLightBg,
    onBackground = RrLightInk,
    surface = RrLightBg,
    onSurface = RrLightInk,
    surfaceVariant = RrLightPanel,
    onSurfaceVariant = RrLightInk.copy(alpha = 0.66f),
    outline = RrLightInk.copy(alpha = 0.10f),
)

private val darkScheme: ColorScheme = darkColorScheme(
    primary = RrYellow,
    onPrimary = RrDarkBg,
    background = RrDarkBg,
    onBackground = RrDarkInk,
    surface = RrDarkBg,
    onSurface = RrDarkInk,
    surfaceVariant = RrDarkPanel,
    onSurfaceVariant = RrDarkInk.copy(alpha = 0.66f),
    outline = RrDarkInk.copy(alpha = 0.12f),
)
