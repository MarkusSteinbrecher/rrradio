package org.rrradio.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import org.rrradio.android.data.AccentPreference

val RrGreen = Color(0xFF00A040)
val RrYellow = Color(0xFFFFFF00)
val RrBlue = Color(0xFF2F80ED)
val RrPink = Color(0xFFFF4FA3)
val RrLightBg = Color(0xFFF8F8F3)
val RrLightPanel = Color(0xFFFFFFFB)
val RrLightInk = Color(0xFF0E0E0D)
val RrDarkBg = Color(0xFF0A0A0A)
val RrDarkPanel = Color(0xFF131313)
val RrDarkInk = Color(0xFFF4F4F2)

@Composable
fun RrradioTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    accentPreference: AccentPreference = AccentPreference.Classic,
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) darkScheme(accentPreference) else lightScheme(accentPreference),
        content = content,
    )
}

fun rrradioAccentColor(preference: AccentPreference, darkTheme: Boolean): Color = when (preference) {
    AccentPreference.Classic -> if (darkTheme) RrYellow else RrGreen
    AccentPreference.Yellow -> RrYellow
    AccentPreference.Green -> RrGreen
    AccentPreference.Blue -> RrBlue
    AccentPreference.Pink -> RrPink
}

private fun onAccentColor(preference: AccentPreference, darkTheme: Boolean): Color = when (preference) {
    AccentPreference.Blue,
    AccentPreference.Pink -> Color.White
    AccentPreference.Classic -> if (darkTheme) RrDarkBg else RrLightBg
    AccentPreference.Yellow,
    AccentPreference.Green -> if (darkTheme) RrDarkBg else RrLightBg
}

private fun lightScheme(accentPreference: AccentPreference): ColorScheme = lightColorScheme(
    primary = rrradioAccentColor(accentPreference, darkTheme = false),
    onPrimary = onAccentColor(accentPreference, darkTheme = false),
    background = RrLightBg,
    onBackground = RrLightInk,
    surface = RrLightBg,
    onSurface = RrLightInk,
    surfaceVariant = RrLightPanel,
    onSurfaceVariant = RrLightInk.copy(alpha = 0.66f),
    outline = RrLightInk.copy(alpha = 0.10f),
)

private fun darkScheme(accentPreference: AccentPreference): ColorScheme = darkColorScheme(
    primary = rrradioAccentColor(accentPreference, darkTheme = true),
    onPrimary = onAccentColor(accentPreference, darkTheme = true),
    background = RrDarkBg,
    onBackground = RrDarkInk,
    surface = RrDarkBg,
    onSurface = RrDarkInk,
    surfaceVariant = RrDarkPanel,
    onSurfaceVariant = RrDarkInk.copy(alpha = 0.66f),
    outline = RrDarkInk.copy(alpha = 0.12f),
)
