import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { supabase } from '@/api/supabaseClient';

const firebaseConfig = {
  apiKey: "AIzaSyC2R2WknsFJj9n5vU6DwnQrW6hqyeUq0oY",
  authDomain: "kingdavid-crm.firebaseapp.com",
  projectId: "kingdavid-crm",
  storageBucket: "kingdavid-crm.firebasestorage.app",
  messagingSenderId: "664395745801",
  appId: "1:664395745801:web:cc36a92ac5ec36e4dfc6d8",
};

const VAPID_KEY = 'BDTx4doRWzszljlkLR2FKgPd3-3O7uH2NrSRoJFjTxxMt5rzE2WxEVZ-ct5E_IJb72nomZQDx5Ura_IjA3Ejvfo';

let app;
let messaging;

try {
  app = initializeApp(firebaseConfig);
  messaging = getMessaging(app);
} catch (err) {
  console.warn('Firebase init failed:', err);
}

/**
 * Request notification permission and get FCM token.
 * Saves token to users table for the current user.
 */
export async function requestNotificationPermission(userId) {
  if (!messaging) return null;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      // Notification permission denied
      return null;
    }

    // Register service worker
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (token && userId) {
      // Save token to user record
      await supabase
        .from('users')
        .update({ push_token: token })
        .eq('id', userId);
    }

    return token;
  } catch (err) {
    console.error('Failed to get push token:', err);
    return null;
  }
}

/**
 * Listen for foreground messages and show toast.
 */
export function onForegroundMessage(callback) {
  if (!messaging) return () => {};
  return onMessage(messaging, (payload) => {
    callback(payload);
  });
}
