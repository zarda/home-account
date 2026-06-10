// Template for local development configuration.
//
// Setup:
//   1. Copy this file to .vscode/environment.ts (the .vscode folder is gitignored)
//   2. Fill in your Firebase project values from the Firebase console
//      (Project settings → General → Your apps → SDK setup and configuration)
//
// src/environments/environment.ts re-exports from .vscode/environment so local
// secrets never land in version control. Production builds replace it with
// environment.production.ts via fileReplacements (values injected in CI/CD).
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
