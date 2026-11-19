package com.zenos.delivery

import android.app.PendingIntent
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * FCM data messages from the backend (services/deliveryRealtime.js):
 *   delivery_offer         → a loud, expiring notification; tap opens the request
 *   delivery_offer_closed  → removes it (taken by someone else / expired)
 * Only active when the app is built with google-services.json (Firebase). The
 * accept decision itself always happens in the app against the server — the
 * notification never accepts anything.
 */
class ZenMessagingService : FirebaseMessagingService() {

  override fun onNewToken(token: String) {
    TrackingStore.secure(this).edit().putString("push.token", token).putBoolean("push.dirty", true).apply()
  }

  override fun onMessageReceived(msg: RemoteMessage) {
    val d = msg.data
    val jobId = d["jobId"] ?: return
    Notifications.ensureChannels(this)
    val nm = Notifications.manager(this)
    when (d["type"]) {
      "delivery_offer" -> {
        val expires = runCatching {
          SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(d["expiresAt"] ?: "")?.time
        }.getOrNull()
        val ttl = expires?.let { it - System.currentTimeMillis() } ?: 45_000L
        if (ttl <= 0) return
        val km = d["distanceMeters"]?.toDoubleOrNull()?.let { String.format(Locale.US, "%.1f km", it / 1000) }
        val open = PendingIntent.getActivity(
          this, jobId.hashCode(),
          Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("offerJobId", jobId),
          PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = NotificationCompat.Builder(this, Notifications.CHANNEL_OFFERS)
          .setSmallIcon(R.drawable.ic_stat_zen)
          .setContentTitle("New delivery request · #${d["orderNo"] ?: ""}")
          .setContentText(listOfNotNull(d["pickupName"]?.takeIf { it.isNotBlank() }?.let { "Pickup: $it" }, km).joinToString(" · ").ifBlank { "Tap to view and accept" })
          .setPriority(NotificationCompat.PRIORITY_HIGH)
          .setCategory(NotificationCompat.CATEGORY_MESSAGE)
          .setAutoCancel(true)
          .setTimeoutAfter(ttl)
          .setContentIntent(open)
          .build()
        nm.notify(Notifications.offerNotificationId(jobId), n)
      }
      "delivery_offer_closed" -> nm.cancel(Notifications.offerNotificationId(jobId))
    }
  }
}
