// Swapped in for environment.ts by the `emulators` build configuration
// (`npm run start:emulators`) and by nothing else; build-configurations.spec.ts
// fails when another configuration names it.
//
// The ui-audit demo project (docs/ui-audit/tools/README.md): a `demo-` project
// has no live counterpart, and the seed scripts key their session records by
// this apiKey. It declares the keys environment.local.example.ts and the CI
// stubs declare, so the app compiles against it as it does against them.
//
// measurementId is deliberately not a GA4 id: analyticsIsConfigured() then
// withholds the Analytics providers, so an opted-in account on the emulators
// never loads gtag or reaches the live property.
export const environment = {
  production: false,
  firebase: {
    apiKey: 'demo-api-key',
    authDomain: 'demo-home-account.firebaseapp.com',
    projectId: 'demo-home-account',
    storageBucket: 'demo-home-account.appspot.com',
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:demo',
    measurementId: 'demo-measurement-id'
  },
  donationUrlPaypal: ''
};
