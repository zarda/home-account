// Template for the PRODUCTION (web deploy) configuration.
//
// Setup:
//   1. Copy this file to environment.prod-local.ts (gitignored — never committed)
//   2. Fill in your Firebase project's values from the Firebase console
//      (Project settings → General → Your apps → SDK setup and configuration)
//
// The production build (`ng build --configuration=production`, used by
// `npm run build:web`) swaps src/environments/environment.ts for
// environment.prod-local.ts via fileReplacements, so the real config reaches the
// deployed bundle while staying out of version control. If environment.prod-local.ts
// is missing, the production build fails loudly instead of shipping placeholders.
export const environment = {
  production: true,
  firebase: {
    apiKey: 'YOUR_FIREBASE_API_KEY',
    authDomain: 'your-project.firebaseapp.com',
    projectId: 'your-project',
    storageBucket: 'your-project.firebasestorage.app',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId: 'YOUR_APP_ID',
    measurementId: 'YOUR_MEASUREMENT_ID'
  },
  donationUrlPaypal: ''
};
