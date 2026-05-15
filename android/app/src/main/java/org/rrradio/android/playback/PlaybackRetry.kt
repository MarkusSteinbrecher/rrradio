package org.rrradio.android.playback

const val STREAM_RETRY_LIMIT = 2

fun shouldRetryStreamError(completedRetries: Int): Boolean =
    completedRetries < STREAM_RETRY_LIMIT

fun streamRetryDelayMillis(attempt: Int): Long =
    (attempt.coerceAtLeast(1) * 1_500L).coerceAtMost(5_000L)
