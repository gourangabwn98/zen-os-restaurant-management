package com.zenos.delivery

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import org.json.JSONArray
import org.json.JSONObject

/**
 * Persistent state shared by the JS app, the location service and the push
 * service.
 *  - secure(): EncryptedSharedPreferences (Android Keystore) — the login token,
 *    API address and tracking config. Never plain prefs.
 *  - the GPS queue: points waiting to be uploaded (a dropped network must not
 *    lose a delivery's trail). App-private storage, capped.
 */
object TrackingStore {
  private const val SECURE = "zen_secure"
  private const val QUEUE = "zen_location_queue"
  private const val MAX_QUEUE = 1000

  @Volatile private var securePrefs: SharedPreferences? = null

  fun secure(ctx: Context): SharedPreferences {
    securePrefs?.let { return it }
    synchronized(this) {
      securePrefs?.let { return it }
      val app = ctx.applicationContext
      // security-crypto 1.0.0 (stable): AES-256-GCM master key in the Android Keystore.
      val keyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
      val p = EncryptedSharedPreferences.create(
        SECURE, keyAlias, app,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
      )
      securePrefs = p
      return p
    }
  }

  // ── tracking config (survives process recreation → the service resumes) ──
  data class Config(val apiBase: String, val token: String)

  fun saveConfig(ctx: Context, apiBase: String, token: String) {
    secure(ctx).edit().putString("trk.api", apiBase).putString("trk.token", token).putBoolean("trk.on", true).apply()
  }

  fun config(ctx: Context): Config? {
    val p = secure(ctx)
    if (!p.getBoolean("trk.on", false)) return null
    val api = p.getString("trk.api", null) ?: return null
    val token = p.getString("trk.token", null) ?: return null
    return Config(api, token)
  }

  fun clearConfig(ctx: Context) {
    secure(ctx).edit().remove("trk.api").remove("trk.token").putBoolean("trk.on", false).apply()
  }

  // ── offline queue of GPS points ───────────────────────────────────────────
  private fun queuePrefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(QUEUE, Context.MODE_PRIVATE)

  @Synchronized
  fun enqueue(ctx: Context, point: JSONObject) {
    val arr = JSONArray(queuePrefs(ctx).getString("q", "[]"))
    arr.put(point)
    val trimmed = if (arr.length() > MAX_QUEUE) JSONArray().also { out ->
      for (i in arr.length() - MAX_QUEUE until arr.length()) out.put(arr.get(i))
    } else arr
    queuePrefs(ctx).edit().putString("q", trimmed.toString()).apply()
  }

  /** The oldest [max] points (not removed until the server accepted them). */
  @Synchronized
  fun peek(ctx: Context, max: Int): JSONArray {
    val arr = JSONArray(queuePrefs(ctx).getString("q", "[]"))
    val out = JSONArray()
    for (i in 0 until minOf(max, arr.length())) out.put(arr.get(i))
    return out
  }

  @Synchronized
  fun drop(ctx: Context, count: Int) {
    val arr = JSONArray(queuePrefs(ctx).getString("q", "[]"))
    val out = JSONArray()
    for (i in count until arr.length()) out.put(arr.get(i))
    queuePrefs(ctx).edit().putString("q", out.toString()).apply()
  }

  @Synchronized
  fun size(ctx: Context): Int = JSONArray(queuePrefs(ctx).getString("q", "[]")).length()

  @Synchronized
  fun clearQueue(ctx: Context) { queuePrefs(ctx).edit().putString("q", "[]").apply() }
}
