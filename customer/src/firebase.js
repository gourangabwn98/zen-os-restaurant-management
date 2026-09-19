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
// the notification opt-in rather than throwing.
export const getMessagingIfSupported = async () => {
  const supported = await isSupported().catch(() => false);
  return supported ? getMessaging(app) : null;
};
