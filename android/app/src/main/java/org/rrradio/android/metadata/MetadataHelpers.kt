package org.rrradio.android.metadata

internal fun cleanMetadataComponent(value: String?): String? =
    value?.trim()?.takeIf { it.isNotEmpty() }

internal fun metadataRaw(artist: String?, title: String): String =
    listOfNotNull(cleanMetadataComponent(artist), cleanMetadataComponent(title))
        .joinToString(" - ")

internal fun metadataTitleCase(value: String): String {
    val lowercased = value.lowercase()
    val output = StringBuilder()
    var shouldUppercase = true

    lowercased.forEach { char ->
        if (shouldUppercase && char.isLetter()) {
            output.append(char.uppercaseChar())
            shouldUppercase = false
        } else {
            output.append(char)
        }

        shouldUppercase = when {
            char == ' ' || char == '\t' || char == '\n' || char == '\'' || char == '-' || char == '/' -> true
            char.isLetterOrDigit() -> false
            else -> shouldUppercase
        }
    }

    return output.toString()
}

internal fun stripMetadataHtml(input: String?): String? {
    val withoutTags = input?.replace(Regex("<[^>]*>"), " ") ?: return null
    val collapsed = withoutTags.replace(Regex("\\s+"), " ").trim()
    return collapsed.ifEmpty { null }
}
