// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getMessaging, isSupported } from "firebase/messaging";

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Cloud Messaging isn't available in every browser/context (older Safari,
// non-HTTPS in dev, etc.) — services/notificationService.js calls this
// instead of getMessaging() directly so unsupported browsers just don't see
// the notification opt-in rather than throwing. getMessaging() itself can
// also throw (e.g. messagingSenderId missing because the dev server was
// started before VITE_FIREBASE_MESSAGING_SENDER_ID was added to .env — Vite
// only reads .env at server startup, a running `npm run dev` won't pick up
// an edit without a restart) — caught here for the same "just act
// unsupported" reason, logged so it's diagnosable instead of silently null.
export const getMessagingIfSupported = async () => {
  const supported = await isSupported().catch(() => false);
  if (!supported) return null;
  try {
    return getMessaging(app);
  } catch (err) {
    console.error("Firebase Messaging unavailable:", err);
    return null;
  }
};
