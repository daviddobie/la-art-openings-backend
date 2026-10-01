// Load environment variables with proper priority (system > .env)
import "./scripts/load-env.js";
import type { ExpoConfig } from "expo/config";

// Bundle ID format: space.manus.<project_name_dots>.<timestamp>
// e.g., "my-app" created at 2024-01-15 10:30:45 -> "space.manus.my.app.t20240115103045"
// Bundle ID can only contain letters, numbers, and dots
// Android requires each dot-separated segment to start with a letter
const rawBundleId = "space.manus.la.art.openings.t20260411181801";
const bundleId =
  rawBundleId
    .replace(/[-_]/g, ".") // Replace hyphens/underscores with dots
    .replace(/[^a-zA-Z0-9.]/g, "") // Remove invalid chars
    .replace(/\.+/g, ".") // Collapse consecutive dots
    .replace(/^\.+|\.+$/g, "") // Trim leading/trailing dots
    .toLowerCase()
    .split(".")
    .map((segment) => {
      // Android requires each segment to start with a letter
      // Prefix with 'x' if segment starts with a digit
      return /^[a-zA-Z]/.test(segment) ? segment : "x" + segment;
    })
    .join(".") || "space.manus.app";
// Extract timestamp from bundle ID and prefix with "manus" for deep link scheme
// e.g., "space.manus.my.app.t20240115103045" -> "manus20240115103045"
const timestamp = bundleId.split(".").pop()?.replace(/^t/, "") ?? "";
const schemeFromBundleId = `manus${timestamp}`;
const androidPackage = "com.laartgalleryguide.app";

const env = {
  // App branding - update these values directly (do not use env vars)
  appName: "LA Gallery Guide",
  appSlug: "la-art-openings",
  // Generated project logo for the platform’s app branding display.
  logoUrl: "/manus-storage/la-gallery-guide-icon_2b5850e5.png",
  scheme: schemeFromBundleId,
  iosBundleId: bundleId,
  androidPackage,
};

const config: ExpoConfig = {
  name: env.appName,
  slug: env.appSlug,
  version: "1.0.42",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: env.scheme,
  userInterfaceStyle: "automatic",
  newArchEnabled: false,
  ios: {
    supportsTablet: true,
    bundleIdentifier: env.iosBundleId,
    buildNumber: "42",
    associatedDomains: [
      "applinks:share.thelosangelesartgallery.com",
      "applinks:web-production-41356.up.railway.app",
    ],
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSLocationWhenInUseUsageDescription: "Your location is used to show nearby art openings and sort your itinerary by distance.",
      NSLocationAlwaysAndWhenInUseUsageDescription: "Your location is used to show nearby art openings and sort your itinerary by distance.",
      NSCameraUsageDescription: "Camera access is not used by this app.",
      NSMicrophoneUsageDescription: "Microphone access is not used by this app.",
      NSPhotoLibraryUsageDescription: "Photo library access is not used by this app.",
      // Explicitly suppress background audio mode — expo-audio/expo-video plugins
      // can inject UIBackgroundModes: ["audio"] which triggers App Store rejection
      // when the app does not actually use background audio playback.
      UIBackgroundModes: []
    }
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    package: env.androidPackage,
    versionCode: 42,
    // Keep network access explicit in the release manifest because opening artwork
    // is loaded from the live HTTPS gallery service.
    permissions: ["INTERNET", "POST_NOTIFICATIONS"],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          {
            scheme: env.scheme,
            host: "*",
          },
          {
            scheme: "https",
            host: "share.thelosangelesartgallery.com",
            pathPrefix: "/share",
          },
          {
            scheme: "https",
            host: "share.thelosangelesartgallery.com",
            pathPrefix: "/event",
          },
          {
            scheme: "https",
            host: "laartopen-tb6xt9ma.manus.space",
            pathPrefix: "/share",
          },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  web: {
    bundler: "metro",
    // Keep the constrained managed development server focused on native Expo Go
    // delivery rather than concurrent server-rendered web route generation.
    output: "single",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    [
      "expo-asset",
      {
        assets: ["./assets/images"],
      },
    ],
    "expo-audio",
    "expo-video",
    "expo-web-browser",
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        dark: {
          backgroundColor: "#000000",
        },
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          buildArchs: ["armeabi-v7a", "arm64-v8a"],
          minSdkVersion: 24,
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    eas: {
      projectId: "2135e0e8-2da4-4474-9fb5-0b59b302887e",
    },
  },
};

export default config;
