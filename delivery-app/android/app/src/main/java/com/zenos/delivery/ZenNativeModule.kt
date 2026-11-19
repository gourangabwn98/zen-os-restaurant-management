package com.zenos.delivery

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject

/**
 * The JS app's bridge to Android (NativeModules.ZenNative):
 *   secure storage (Keystore-encrypted), the location service, Google Maps
 *   navigation hand-off, FCM token, battery-optimisation status.
 * Events to JS: "ZenTracking" { type: location|uploaded|error|stopped, ... }
 *               "ZenOfferTapped" { jobId }
 */
class ZenNativeModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

  override fun getName() = "ZenNative"

  init {
    LocationTrackingService.listener = { type, data -> sendEvent("ZenTracking", toMap(data).apply { putString("type", type) }) }
    instance = this
  }

  companion object {
    @Volatile var instance: ZenNativeModule? = null
    @Volatile var pendingOfferJobId: String? = null

    fun offerTapped(jobId: String) {
      pendingOfferJobId = jobId
      instance?.sendEvent("ZenOfferTapped", Arguments.createMap().apply { putString("jobId", jobId) })
    }
  }

  override fun getConstants(): MutableMap<String, Any> = hashMapOf(
    "apiBase" to BuildConfig.ZEN_API_URL,
    "mapsKeyConfigured" to BuildConfig.MAPS_KEY_SET,
    "versionName" to BuildConfig.VERSION_NAME,
    "buildType" to BuildConfig.BUILD_TYPE,
    "sdkInt" to Build.VERSION.SDK_INT,
  )

  // ── secure storage ────────────────────────────────────────────────────────
  @ReactMethod fun secureSet(key: String, value: String, p: Promise) = guard(p) { TrackingStore.secure(ctx).edit().putString("app.$key", value).apply(); p.resolve(true) }
  @ReactMethod fun secureGet(key: String, p: Promise) = guard(p) { p.resolve(TrackingStore.secure(ctx).getString("app.$key", null)) }
  @ReactMethod fun secureRemove(key: String, p: Promise) = guard(p) { TrackingStore.secure(ctx).edit().remove("app.$key").apply(); p.resolve(true) }

  // ── location service ──────────────────────────────────────────────────────
  @ReactMethod
  fun startTracking(apiBase: String, token: String, summary: String, p: Promise) = guard(p) {
    if (!LocationTrackingService.hasPermission(ctx)) { p.reject("NO_PERMISSION", "Location permission is not granted"); return@guard }
    TrackingStore.saveConfig(ctx, apiBase, token)
    val i = Intent(ctx, LocationTrackingService::class.java)
    ContextCompat.startForegroundService(ctx, i)
    ctx.startService(Intent(ctx, LocationTrackingService::class.java).setAction(LocationTrackingService.ACTION_SUMMARY).putExtra(LocationTrackingService.EXTRA_SUMMARY, summary))
    p.resolve(true)
  }

  @ReactMethod
  fun updateTrackingSummary(summary: String) {
    if (!LocationTrackingService.running) return
    runCatching { ctx.startService(Intent(ctx, LocationTrackingService::class.java).setAction(LocationTrackingService.ACTION_SUMMARY).putExtra(LocationTrackingService.EXTRA_SUMMARY, summary)) }
  }

  @ReactMethod
  fun stopTracking(p: Promise) = guard(p) {
    TrackingStore.clearConfig(ctx)
    if (LocationTrackingService.running) ctx.startService(Intent(ctx, LocationTrackingService::class.java).setAction(LocationTrackingService.ACTION_STOP))
    p.resolve(true)
  }

  @ReactMethod fun trackingStatus(p: Promise) = guard(p) {
    p.resolve(Arguments.createMap().apply {
      putBoolean("running", LocationTrackingService.running)
      putInt("queued", TrackingStore.size(ctx))
      putBoolean("permission", LocationTrackingService.hasPermission(ctx))
    })
  }

  // ── navigation hand-off (Google Maps app, else any maps app) ──────────────
  @ReactMethod
  fun openNavigation(lat: Double, lng: Double, label: String, p: Promise) = guard(p) {
    val nav = Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=$lat,$lng&mode=l")).setPackage("com.google.android.apps.maps")
    val i = if (nav.resolveActivity(ctx.packageManager) != null) nav
      else Intent(Intent.ACTION_VIEW, Uri.parse("geo:$lat,$lng?q=$lat,$lng(${Uri.encode(label)})"))
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    ctx.startActivity(i)
    p.resolve(true)
  }

  @ReactMethod
  fun dial(phone: String, p: Promise) = guard(p) {
    ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${Uri.encode(phone)}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    p.resolve(true)
  }

  // ── push (FCM) — only when the app was built with google-services.json ────
  @ReactMethod
  fun getPushToken(p: Promise) {
    if (FirebaseApp.getApps(ctx).isEmpty()) { p.resolve(null); return }
    try {
      FirebaseMessaging.getInstance().token
        .addOnSuccessListener { p.resolve(it) }
        .addOnFailureListener { p.resolve(null) }
    } catch (e: Exception) { p.resolve(null) }
  }

  @ReactMethod fun consumeTappedOffer(p: Promise) { p.resolve(pendingOfferJobId); pendingOfferJobId = null }

  // ── battery / settings ────────────────────────────────────────────────────
  @ReactMethod fun batteryOptimized(p: Promise) = guard(p) {
    val pm = ctx.getSystemService(PowerManager::class.java)
    p.resolve(!pm.isIgnoringBatteryOptimizations(ctx.packageName))
  }

  @ReactMethod fun openAppSettings(p: Promise) = guard(p) {
    ctx.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    p.resolve(true)
  }

  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}

  // ── helpers ───────────────────────────────────────────────────────────────
  private inline fun guard(p: Promise, block: () -> Unit) {
    try { block() } catch (e: Exception) { p.reject("NATIVE_ERROR", e.message, e) }
  }

  fun sendEvent(name: String, data: WritableMap) {
    if (!ctx.hasActiveReactInstance()) return
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, data)
  }

  private fun toMap(o: JSONObject): WritableMap {
    val m = Arguments.createMap()
    for (k in o.keys()) {
      when (val v = o.get(k)) {
        is Int -> m.putInt(k, v)
        is Long -> m.putDouble(k, v.toDouble())
        is Double -> m.putDouble(k, v)
        is Boolean -> m.putBoolean(k, v)
        JSONObject.NULL -> m.putNull(k)
        else -> m.putString(k, v.toString())
      }
    }
    return m
  }
}
