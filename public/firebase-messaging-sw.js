importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyC2R2WknsFJj9n5vU6DwnQrW6hqyeUq0oY",
  authDomain: "kingdavid-crm.firebaseapp.com",
  projectId: "kingdavid-crm",
  storageBucket: "kingdavid-crm.firebasestorage.app",
  messagingSenderId: "664395745801",
  appId: "1:664395745801:web:cc36a92ac5ec36e4dfc6d8",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body, icon } = payload.notification || {};
  self.registration.showNotification(title || 'King David CRM', {
    body: body || '',
    icon: icon || 'https://kingdavid4u.co.il/wp-content/uploads/2023/09/logo.png',
    badge: 'https://kingdavid4u.co.il/wp-content/uploads/2023/09/logo.png',
    dir: 'rtl',
    lang: 'he',
  });
});
