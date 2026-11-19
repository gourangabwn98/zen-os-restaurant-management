package com.zenos.delivery

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors

/**
 * Foreground location service — runs ONLY while the rider has an active
 * delivery (the JS app starts it; the server's `tracking:false` reply or the
 * app stops it). Persistent notification, type "location", started from the
 * foreground with the while-in-use permission — no background-location
 * permission is requested.
 *
 * Reliability: points go to a disk queue first and are uploaded in batches
 * every ~15 s (POST /api/delivery/me/locations); a dropped network keeps them
 * queued. START_STICKY + persisted config → resumes after a normal process
 * recreation. It does NOT survive force-stop, permission revocation or a
 * reboot (Android does not allow that) — documented, never claimed.
 */
class LocationTrackingService : Service() {

  companion object {
    private const val TAG = "ZenTracking"
    const val ACTION_STOP = "com.zenos.delivery.STOP_TRACKING"
    const val ACTION_SUMMARY = "com.zenos.delivery.TRACKING_SUMMARY"
    const val EXTRA_SUMMARY = "summary"
    private const val NOTIF_ID = 4101
    private const val INTERVAL_MS = 10_000L
    private const val FLUSH_MS = 15_000L

    @Volatile var running = false
      private set

    /** Set by ZenNativeModule so live fixes / stops reach the JS app. */
    @Volatile var listener: ((String, JSONObject) -> Unit)? = null

    fun hasPermission(ctx: Context) =
      ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
  }

  private lateinit var fused: FusedLocationProviderClient
  private val io = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())
  private var summary = "Sharing your location with your active deliveries"
  private var lastFlush = 0L
  private var updatesOn = false

  private val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }

  private val callback = object : LocationCallback() {
    override fun onLocationResult(result: LocationResult) {
      for (loc in result.locations) onFix(loc)
      if (System.currentTimeMillis() - lastFlush > FLUSH_MS || TrackingStore.size(this@LocationTrackingService) >= 5) flush()
    }
  }

  private val flushLoop = object : Runnable {
    override fun run() { flush(); main.postDelayed(this, FLUSH_MS) }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    fused = LocationServices.getFusedLocationProviderClient(this)
    Notifications.ensureChannels(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> { shutdown("STOPPED"); return START_NOT_STICKY }
      ACTION_SUMMARY -> {
        summary = intent.getStringExtra(EXTRA_SUMMARY) ?: summary
        if (running) Notifications.manager(this).notify(NOTIF_ID, buildNotification())
        return START_STICKY
      }
    }
    if (TrackingStore.config(this) == null || !hasPermission(this)) { shutdown("NO_CONFIG"); return START_NOT_STICKY }
    try {
      val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0
      ServiceCompat.startForeground(this, NOTIF_ID, buildNotification(), type)
    } catch (e: Exception) {
      // Android 12+ refuses a location FGS started from the background (e.g. a
      // sticky restart while the app is not visible). The app restarts it next
      // time it is opened — no silent tracking.
      Log.w(TAG, "could not enter foreground: ${e.message}")
      emit("error", JSONObject().put("message", "FOREGROUND_NOT_ALLOWED"))
      stopSelf()
      return START_NOT_STICKY
    }
    running = true
    startUpdates()
    main.removeCallbacks(flushLoop)
    main.postDelayed(flushLoop, FLUSH_MS)
    return START_STICKY
  }

  @SuppressLint("MissingPermission")
  private fun startUpdates() {
    if (updatesOn) return
    val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, INTERVAL_MS)
      .setMinUpdateIntervalMillis(5_000L)
      .setMinUpdateDistanceMeters(15f)
      .setWaitForAccurateLocation(false)
      .build()
    try {
      fused.requestLocationUpdates(req, callback, Looper.getMainLooper())
      updatesOn = true
    } catch (e: SecurityException) {
      shutdown("PERMISSION_REVOKED")
    }
  }

  private fun onFix(loc: Location) {
    val p = JSONObject()
      .put("latitude", loc.latitude).put("longitude", loc.longitude)
      .put("accuracy", if (loc.hasAccuracy()) loc.accuracy.toDouble() else JSONObject.NULL)
      .put("speed", if (loc.hasSpeed()) loc.speed.toDouble() else JSONObject.NULL)
      .put("heading", if (loc.hasBearing()) loc.bearing.toDouble() else JSONObject.NULL)
      .put("at", iso.format(Date(loc.time)))
    TrackingStore.enqueue(this, p)
    emit("location", p)
  }

  /** Upload queued points (oldest first). Kept on any failure but auth. */
  private fun flush() {
    lastFlush = System.currentTimeMillis()
    io.execute {
      val cfg = TrackingStore.config(this) ?: return@execute
      val batch = TrackingStore.peek(this, 100)
      if (batch.length() == 0) return@execute
      var conn: HttpURLConnection? = null
      try {
        conn = (URL("${cfg.apiBase.trimEnd('/')}/delivery/me/locations").openConnection() as HttpURLConnection).apply {
          requestMethod = "POST"; connectTimeout = 10_000; readTimeout = 15_000; doOutput = true
          setRequestProperty("Content-Type", "application/json")
          setRequestProperty("Authorization", "Bearer ${cfg.token}")
        }
        conn.outputStream.use { it.write(JSONObject().put("points", batch).toString().toByteArray()) }
        val code = conn.responseCode
        when {
          code in 200..299 -> {
            TrackingStore.drop(this, batch.length())
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            val tracking = runCatching { JSONObject(body).optBoolean("tracking", true) }.getOrDefault(true)
            emit("uploaded", JSONObject().put("count", batch.length()).put("queued", TrackingStore.size(this)))
            if (!tracking) main.post { shutdown("NO_ACTIVE_DELIVERIES") }
          }
          code == 400 -> TrackingStore.drop(this, batch.length()) // malformed batch can never succeed
          code == 401 || code == 403 -> main.post { shutdown("AUTH") }
          else -> emit("error", JSONObject().put("message", "HTTP_$code").put("queued", TrackingStore.size(this)))
        }
      } catch (e: Exception) {
        emit("error", JSONObject().put("message", "NETWORK").put("queued", TrackingStore.size(this)))
      } finally {
        conn?.disconnect()
      }
    }
  }

  private fun shutdown(reason: String) {
    main.removeCallbacks(flushLoop)
    if (updatesOn) runCatching { fused.removeLocationUpdates(callback) }
    updatesOn = false
    running = false
    TrackingStore.clearConfig(this)
    if (reason != "STOPPED") TrackingStore.clearQueue(this)
    emit("stopped", JSONObject().put("reason", reason))
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun emit(type: String, data: JSONObject) {
    try { listener?.invoke(type, data) } catch (_: Exception) { }
  }

  private fun buildNotification(): Notification {
    val open = PendingIntent.getActivity(
      this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    return NotificationCompat.Builder(this, Notifications.CHANNEL_TRACKING)
      .setSmallIcon(R.drawable.ic_stat_zen)
      .setContentTitle("On delivery")
      .setContentText(summary)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(open)
      .build()
  }

  override fun onDestroy() {
    main.removeCallbacks(flushLoop)
    if (updatesOn) runCatching { fused.removeLocationUpdates(callback) }
    running = false
    io.shutdown()
    super.onDestroy()
  }
}
