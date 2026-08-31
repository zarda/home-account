import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.homeaccount.app',
  appName: 'HomeAccount',
  webDir: 'dist/home-account/browser',
  server: {
    androidScheme: 'https',
    iosScheme: 'https'
  },
  ios: {
    contentInset: 'automatic',
    preferredContentMode: 'mobile'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#ffffff',
      showSpinner: false
    },
    FirebaseAuthentication: {
      skipNativeAuth: false,
      providers: ['google.com']
    },
    LocalNotifications: {
      // Without this iOS suppresses any notification that arrives while the
      // app is in the foreground — which is exactly when an open-app sweep
      // raises one, so the whole feature would look silent on device.
      presentationOptions: ['banner', 'sound']
    }
  }
};

export default config;
