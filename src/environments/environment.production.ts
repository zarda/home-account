// Production environment
// Values are replaced during CI/CD build from GitHub secrets

export const environment = {
  production: true,
  firebase: {
    apiKey: '${FIREBASE_API_KEY}',
    authDomain: '${FIREBASE_AUTH_DOMAIN}',
    projectId: '${FIREBASE_PROJECT_ID}',
    storageBucket: '${FIREBASE_STORAGE_BUCKET}',
    messagingSenderId: '${FIREBASE_MESSAGING_SENDER_ID}',
    appId: '${FIREBASE_APP_ID}',
    measurementId: '${FIREBASE_MEASUREMENT_ID}'
  },
  geminiApiKey: '${GEMINI_API_KEY}',
  currencyApiKey: '${CURRENCY_API_KEY}'
};
