package com.zenos.delivery

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build

/** Notification channels: new delivery requests (loud) and the tracking service (silent). */
object Notifications {
  const val CHANNEL_OFFERS = "delivery_offers"
  const val CHANNEL_TRACKING = "delivery_tracking"

  fun manager(ctx: Context) = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  fun ensureChannels(ctx: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val m = manager(ctx)
    if (m.getNotificationChannel(CHANNEL_OFFERS) == null) {
      m.createNotificationChannel(NotificationChannel(CHANNEL_OFFERS, "New delivery requests", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "Orders offered to you — accept quickly, they expire"
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 400, 200, 400, 200, 600)
        setSound(
          RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
          AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT).build(),
        )
      })
    }
    if (m.getNotificationChannel(CHANNEL_TRACKING) == null) {
      m.createNotificationChannel(NotificationChannel(CHANNEL_TRACKING, "Active delivery", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Shown while your location is shared with customers you are delivering to"
        setShowBadge(false)
      })
    }
  }

  fun offerNotificationId(jobId: String) = 5000 + (jobId.hashCode() and 0xFFFF)
}
