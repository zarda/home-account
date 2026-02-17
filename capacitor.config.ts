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
    }
  }
};

export default config;
