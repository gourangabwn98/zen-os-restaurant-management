# Zen OS Delivery — partner app (Android)

React Native 0.77 (TypeScript, old architecture) + a small native Kotlin layer.
Package `com.zenos.delivery`, app name **Zen OS Delivery**.

```
App.tsx                      shell: tabs (Home · Deliveries · History · Profile), pushed screens, offer sheet
src/store.tsx                session, server snapshot, Socket.IO, offers, GPS service orchestration
src/api.ts  src/native.ts    REST client · typed bridge to ZenNative
src/geo.ts                   distances, polyline decode, local stop suggestion (no invented ETA)
src/screens/*                Login/Splash, Home, Deliveries (multi-order + route), JobDetail (pickup → OTP → COD),
                             History, Profile (cash in hand, settings), Notifications, OfferOverlay
android/app/src/main/java/com/zenos/delivery/
  ZenNativeModule.kt         secure storage, start/stop tracking, Google Maps hand-off, dial, FCM token
  LocationTrackingService.kt foreground service (type=location) + disk-queued uploads
  ZenMessagingService.kt     FCM data messages → "new request" notification (only with google-services.json)
  TrackingStore.kt           EncryptedSharedPreferences + GPS queue
```

## What the rider can do
- **Account:** sign in with the phone number registered on Admin → Employees (category *Delivery partner*), using the same OTP flow as the other staff apps. Other roles are refused.
- **Requests:** go online and offline, receive requests (in-app sheet with a countdown, plus a push notification when Firebase is configured), and accept or reject them. The server decides who wins.
- **Multiple orders:** hold several deliveries up to the capacity the admin set. The app shows a stop plan: Google's optimised route when the server has a Routes key, otherwise a labelled suggestion (pickup first, then nearest drop, with old orders first).
- **Each delivery:** arrive at the restaurant, then pick up (only after the kitchen marks the order ready), then arrive at the customer, then complete with the customer's 4-digit code. For a COD order the rider also confirms the exact cash amount.
- **Maps and contact:** navigation hands off to the Google Maps app. The customer can be called, with their number masked on screen.
- **Records:** history, today's numbers, and cash in hand until the admin verifies it.
- **Location sharing:** a foreground service runs **only while a delivery is active**. It needs no background-location permission, queues points while offline, and stops when the server reports no active deliveries.

## Build

Requirements: JDK 17, Android SDK 35 (build-tools 35, NDK 27.1.12297006), Node 18+.

```bash
cd delivery-app && npm install
cd android
./gradlew assembleDebug          # → app/build/outputs/apk/debug/app-debug.apk   (JS bundled; no Metro needed)
./gradlew assembleRelease        # → app/build/outputs/apk/release/app-release(-unsigned).apk
```
If Gradle times out downloading (seen on this PC over IPv6), run it with
`JAVA_TOOL_OPTIONS=-Djava.net.preferIPv4Stack=true`.

### Configuration (Gradle properties: `-P…`, or `~/.gradle/gradle.properties`; never commit secrets)
| Property | Purpose | Default |
|---|---|---|
| `zenApiUrl` | Backend REST base. **Release requires https.** The rider can also change it in Settings. | debug: `http://10.0.2.2:5055/api` (local sandbox seen from the emulator); release: empty, so the rider must set it |
| `googleMapsKey` | Google Maps SDK for Android key, restricted to `com.zenos.delivery` + your SHA-1 | empty: the in-app map is replaced by a notice; Navigate still works |
| `zenReleaseStoreFile`, `zenReleaseStorePassword`, `zenReleaseKeyAlias`, `zenReleaseKeyPassword` | Release signing | absent: the release APK is **unsigned** (never debug-signed) |
| `android/app/google-services.json` (file) | FCM push for an Android app `com.zenos.delivery` in your Firebase project | absent: push is off and requests arrive only while the app is open |

## Test against the local sandbox (never production)
```bash
cd restaurant-server && node scripts/localSandbox.js     # throwaway in-memory DB, console OTP
# emulator: install the debug APK, sign in as 9000000011; the code is shown on screen ("Test server code")
```

## Known limits (Android, by design)
- Location sharing stops on force-stop, permission revocation or reboot. Android does not allow it to survive those. A sticky restart while the app is closed is refused by Android 12+; it resumes when the rider opens the app.
- Without FCM (`google-services.json`), requests only arrive while the app is running. Idle online riders with no signal are taken offline after the admin's presence timeout (default 10 minutes).
- Icons are tintable symbol glyphs, not an icon font (no extra dependency).
