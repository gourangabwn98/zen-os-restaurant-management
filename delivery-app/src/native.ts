// Typed access to the Android layer (android/app/src/main/java/com/zenos/delivery/ZenNativeModule.kt).
import { NativeEventEmitter, NativeModules } from 'react-native';

type Constants = { apiBase: string; mapsKeyConfigured: boolean; versionName: string; buildType: string; sdkInt: number };
type Native = Constants & {
  getConstants?: () => Constants;
  secureSet(key: string, value: string): Promise<boolean>;
  secureGet(key: string): Promise<string | null>;
  secureRemove(key: string): Promise<boolean>;
  startTracking(apiBase: string, token: string, summary: string): Promise<boolean>;
  updateTrackingSummary(summary: string): void;
  stopTracking(): Promise<boolean>;
  trackingStatus(): Promise<{ running: boolean; queued: number; permission: boolean }>;
  openNavigation(lat: number, lng: number, label: string): Promise<boolean>;
  dial(phone: string): Promise<boolean>;
  getPushToken(): Promise<string | null>;
  consumeTappedOffer(): Promise<string | null>;
  batteryOptimized(): Promise<boolean>;
  openAppSettings(): Promise<boolean>;
};

export const Zen: Native = NativeModules.ZenNative;
const constants: Constants = (Zen?.getConstants ? Zen.getConstants() : Zen) || ({} as Constants);

export const BUILD = {
  apiBase: constants.apiBase || '',
  mapsKeyConfigured: !!constants.mapsKeyConfigured,
  version: constants.versionName || '1.0.0',
  buildType: constants.buildType || 'debug',
  sdkInt: constants.sdkInt || 0,
};

export const zenEvents = new NativeEventEmitter(NativeModules.ZenNative);

export type TrackingEvent =
  | { type: 'location'; latitude: number; longitude: number; accuracy: number | null; heading: number | null; at: string }
  | { type: 'uploaded'; count: number; queued: number }
  | { type: 'error'; message: string; queued?: number }
  | { type: 'stopped'; reason: string };
