// Template for local development configuration.
//
// Setup:
//   1. Copy this file to .vscode/environment.ts (the .vscode folder is gitignored)
//   2. Fill in your Firebase project values from the Firebase console
//      (Project settings → General → Your apps → SDK setup and configuration)
//   3. measurementId turns on Google Analytics 4. It only appears in the SDK
//      config once the project's Google Analytics integration is enabled
//      (Project settings → Integrations). Leaving the placeholder is fine: the
//      app skips analytics unless the value starts with "G-", so no tag is
//      loaded and no request is made. See docs/analytics.md for the one-time
//      console checklist.
//
// src/environments/environment.ts re-exports from .vscode/environment so local
// secrets never land in version control. Production builds replace it with
// environment.prod-local.ts via fileReplacements (see environment.prod-local.example.ts).
export const environment = {
  production: false,
  firebase: {
    apiKey: 'YOUR_FIREBASE_API_KEY',
    authDomain: 'your-project.firebaseapp.com',
    projectId: 'your-project',
    storageBucket: 'your-project.appspot.com',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId: 'YOUR_APP_ID',
    measurementId: 'YOUR_MEASUREMENT_ID'
  },
  donationUrlPaypal: ''
};
