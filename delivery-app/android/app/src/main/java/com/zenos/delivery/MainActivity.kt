package com.zenos.delivery

import android.content.Intent
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  override fun getMainComponentName(): String = "ZenOSDelivery"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
    // Swap the splash theme (brand background) for the normal one before drawing.
    setTheme(R.style.AppTheme)
    super.onCreate(null)
    handleOfferIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleOfferIntent(intent)
  }

  /** A tapped "new delivery request" notification opens that request in the app. */
  private fun handleOfferIntent(intent: Intent?) {
    val jobId = intent?.getStringExtra("offerJobId") ?: return
    intent.removeExtra("offerJobId")
    ZenNativeModule.offerTapped(jobId)
  }
}
