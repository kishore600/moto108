/* eslint-disable react/no-unescaped-entities */
// tabs/customer.tsx
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
  Modal,
  ScrollView,
  Dimensions,
  AppState,
  AppStateStatus,
  Platform,
  StatusBar,
  Animated,
  Easing,
  Linking,
} from "react-native";

import { GestureHandlerRootView } from "react-native-gesture-handler";
// ✅ FIX — SafeAreaView here (imported as `SafeAreaView` from
// react-native-safe-area-context, aliased as `ModalSafeArea` below for
// clarity) is used ONLY inside <Modal> screens. React Native's own
// `SafeAreaView` (from the "react-native" package) is an iOS-only no-op —
// on Android it doesn't apply any inset padding at all, which is why
// content like the "Cancel Search" button could end up sitting under the
// Android nav bar. `SafeAreaProvider`/`useSafeAreaInsets` come from the
// same package and are re-mounted inside each Modal (see renderWaitingScreen
// and renderTrackingScreen) because Modals render into their own native
// root window, so the outer SafeAreaProvider's measurements don't
// automatically apply there.
import {
  useSafeAreaInsets,
  SafeAreaProvider,
  SafeAreaView as ModalSafeArea,
} from "react-native-safe-area-context";
import BottomSheet, {
  BottomSheetFlatList,
} from "@gorhom/bottom-sheet";
import * as Location from "expo-location";
import MapView, { Marker, Callout, Circle, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import MapViewDirections from "react-native-maps-directions";
import { api } from "@/lib/api";
import { Booking, Mechanic, ServiceItem, SavedLocation } from "@/types";
import { socketService } from "@/lib/socket"; // ✅ ONE import, no dual export
import { useAuth } from "@/context/AuthContext";
import { router, useFocusEffect } from "expo-router";
import { Ionicons, FontAwesome5, MaterialCommunityIcons } from "@expo/vector-icons";
import { LocationPicker } from "@/components/LocationPicker";
import { VehicleType } from "@/components/VehicleTypePicker";
import { UserLocationMarker } from "@/app/Userlocationpin";
import { useBookingUI } from "@/context/BookingUIContext";

// ---------------------------------------------------------------------------
// ✅ Single source of truth for "is this service actually bookable right
// now" — shared between the Quick Access tiles AND the "View All" service
// list modal, so the two can never disagree about availability. Match is
// case-insensitive and trims whitespace, since service names come straight
// from the API and small casing/spacing differences shouldn't silently
// disable a service that should be available. Keep this list in sync with
// the one in service-selection.tsx.
//
// ✅ "Battery Jump Start" is intentionally NOT in this list — it has a
// Quick Access tile (key: "battery_jump_start") so people can see it's a
// planned service, but the tile renders dimmed and non-tappable (see the
// Quick Access grid render + isServiceAvailable() below) until it's added
// back here.
// ---------------------------------------------------------------------------
const AVAILABLE_SERVICE_NAMES = [
  "Towing Support",
  "Tubeless Mushroom Puncture",
  "Tubeless Puncture",
  "Tube Puncture",
];

function isServiceAvailable(name?: string | null): boolean {
  if (!name) return false;
  const normalized = name.trim().toLowerCase();
  return AVAILABLE_SERVICE_NAMES.some(
    (allowed) => allowed.toLowerCase() === normalized,
  );
}

function serviceMatchesKeyword(serviceName: string, keyword: string): boolean {
  const name = serviceName.toLowerCase();
  const kw = keyword.toLowerCase().trim();
  if (!kw) return false;
  if (kw.includes(" ")) {
    return name.includes(kw);
  }
  const re = new RegExp(`\\b${kw}\\b`, "i");
  return re.test(name);
}

const QUICK_ACCESS_CONFIG: {
  key: string;
  label: string;
  keywords: string[];
  icon: { lib: "Ionicons" | "FontAwesome5" | "MaterialCommunityIcons"; name: string };
}[] = [
  {
    key: "towing",
    label: "Towing",
    keywords: ["towing support", "tow"],
    icon: { lib: "MaterialCommunityIcons", name: "tow-truck" },
  },
  {
    key: "tube_puncture",
    label: "Mushroom\nPuncture",
    keywords: ["tubeless mushroom puncture"],
    icon: { lib: "Ionicons", name: "disc-outline" },
  },
  {
    key: "tubeless_puncture",
    label: "Tubeless\nPuncture",
    keywords: ["tubeless puncture"],
    icon: { lib: "Ionicons", name: "aperture-outline" },
  },
  {
    key: "battery_jump_start",
    label: "Battery\nJump Start",
    keywords: ["battery jump start", "jump start", "battery"],
    icon: { lib: "MaterialCommunityIcons", name: "car-battery" },
  },
];

function iconForVehicleCategory(
  category?: string | null,
): { lib: "Ionicons" | "FontAwesome5" | "MaterialCommunityIcons"; name: string } {
  switch ((category ?? "").toLowerCase()) {
    case "two-wheeler":
      return { lib: "FontAwesome5", name: "motorcycle" };
    case "auto":
      return { lib: "MaterialCommunityIcons", name: "rickshaw" };
    case "four-wheeler":
      return { lib: "Ionicons", name: "car-sport" };
    case "commercial":
      return { lib: "FontAwesome5", name: "shuttle-van" };
    case "heavy":
      return { lib: "FontAwesome5", name: "truck-moving" };
    default:
      return { lib: "Ionicons", name: "car-outline" };
  }
}

function iconForService(
  name?: string | null,
): { lib: "Ionicons" | "FontAwesome5" | "MaterialCommunityIcons"; name: string } {
  const n = (name ?? "").toLowerCase();
  if (n.includes("tow")) return { lib: "MaterialCommunityIcons", name: "tow-truck" };
  if (n.includes("mushroom")) return { lib: "Ionicons", name: "disc-outline" };
  if (n.includes("tubeless")) return { lib: "Ionicons", name: "aperture-outline" };
  if (n.includes("tube")) return { lib: "Ionicons", name: "aperture-outline" };
  if (n.includes("battery") || n.includes("jump")) return { lib: "MaterialCommunityIcons", name: "car-battery" };
  if (n.includes("ev") || n.includes("electric")) return { lib: "MaterialCommunityIcons", name: "ev-station" };
  if (n.includes("fuel") || n.includes("petrol") || n.includes("diesel")) return { lib: "MaterialCommunityIcons", name: "gas-station" };
  if (n.includes("grease") || n.includes("oil") || n.includes("lubric")) return { lib: "MaterialCommunityIcons", name: "oil" };
  if (n.includes("puncture") || n.includes("tyre") || n.includes("tire")) return { lib: "Ionicons", name: "ellipse-outline" };
  return { lib: "Ionicons", name: "construct-outline" };
}

const DEFAULT_REGION = {
  latitude: 13.0827,
  longitude: 80.2707,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

const CLOSE_REGION_DELTA = 0.01;

// ---------------------------------------------------------------------------
// ✅ 3-tier expanding search radius: 2km → 5km → 10km.
// MECHANIC_SEARCH_RADIUS_KM (used for the actual /mechanics/nearby API
// call) always equals the WIDEST tier, so we fetch once up front and just
// filter what's shown locally as the search radius expands — no re-fetch
// needed when a tier changes (fetchNearbyMechanicsForMap still polls on an
// interval to keep the underlying data fresh).
// ---------------------------------------------------------------------------
const MECHANIC_INNER_RING_KM = 2;
const MECHANIC_MIDDLE_RING_KM = 5;
const MECHANIC_OUTER_RING_KM = 10;
const MECHANIC_SEARCH_RADIUS_KM = MECHANIC_OUTER_RING_KM;

const KM_PER_DEGREE_LAT = 111;
const WAITING_REGION_PADDING = 1.3;

const WAITING_REGION_DELTA_INNER =
  (MECHANIC_INNER_RING_KM * 2 * WAITING_REGION_PADDING) / KM_PER_DEGREE_LAT;
const WAITING_REGION_DELTA_MIDDLE =
  (MECHANIC_MIDDLE_RING_KM * 2 * WAITING_REGION_PADDING) / KM_PER_DEGREE_LAT;
const WAITING_REGION_DELTA_OUTER =
  (MECHANIC_OUTER_RING_KM * 2 * WAITING_REGION_PADDING) / KM_PER_DEGREE_LAT;

function getMechanicCoordinate(
  mechanic: any,
): { latitude: number; longitude: number } | null {
  const lat = Number(mechanic?.current_lat);
  const lng = Number(mechanic?.current_lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { latitude: lat, longitude: lng };
}

function weatherIconFor(code: number | null): keyof typeof Ionicons.glyphMap {
  if (code === null) return "partly-sunny-outline";
  if (code === 0) return "sunny-outline";
  if (code <= 3) return "partly-sunny-outline";
  if (code <= 48) return "cloud-outline";
  if (code <= 67) return "rainy-outline";
  if (code <= 77) return "snow-outline";
  if (code <= 82) return "rainy-outline";
  if (code >= 95) return "thunderstorm-outline";
  return "partly-sunny-outline";
}

function formatTimeAgo(dateStr?: string): string {
  if (!dateStr) return "";
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  const diffDays = Math.floor((now - then) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return `${diffDays} days ago`;
}

// ---------------------------------------------------------------------------
// ✅ Formats a booking timeline timestamp for the tracking-screen status
// list. Tries several possible field-name variants per step (different
// backends/migrations tend to name these slightly differently), so this
// keeps working even if the API adds/renames a column later. Returns null
// (never a fabricated value) if nothing usable is found for that step.
// ---------------------------------------------------------------------------
const TRACKING_STEP_FIELD_CANDIDATES: Record<string, string[]> = {
  requested: ["requested_at", "created_at"],
  accepted: ["accepted_at"],
  on_the_way: ["on_the_way_at", "started_at", "on_the_way_since"],
  arrived: ["arrived_at"],
  completed: ["completed_at", "completed_time"],
};

function getStepTimestamp(booking: any, key: string): string | null {
  const fields = TRACKING_STEP_FIELD_CANDIDATES[key] || [];
  for (const field of fields) {
    const raw = booking?.[field];
    if (!raw) continue;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
  }
  return null;
}

const { width, height } = Dimensions.get("window");
const GOOGLE_MAPS_API_KEY = process.env
  .EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string;

if (!GOOGLE_MAPS_API_KEY) {
  console.error("❌ GOOGLE_MAPS_API_KEY is missing! Check your .env file");
}

// ---------------------------------------------------------------------------
// ✅ Search timeline (out of the 120s waiting window):
//   0s  -> 45s : searching within MECHANIC_INNER_RING_KM  (2km)  — teal
//   45s -> 80s : searching within MECHANIC_MIDDLE_RING_KM (5km)  — amber
//   80s -> 120s: searching within MECHANIC_OUTER_RING_KM (10km) — purple
// Each tier gets its own ripple loop, its own solid ring on the map, and
// its own legend dot — all driven off the SAME showMiddleRing /
// showOuterRing booleans so nothing can visually disagree.
// ---------------------------------------------------------------------------
const MIDDLE_RIPPLE_DELAY_SEC = 45;
const OUTER_RIPPLE_DELAY_SEC = 80;

const INNER_RIPPLE_DURATION_MS = 2000;
const MIDDLE_RIPPLE_DURATION_MS = 2600;
const OUTER_RIPPLE_DURATION_MS = 3200;

// ✅ One color per ring — the legend dots, solid rings, and ripple pulses
// all pull from here so a color only ever needs to change in one place.
const RING_COLORS = {
  inner: {
    solid: "#063F47",
    stroke: "rgba(6, 63, 71, 0.6)",
    fill: "rgba(6, 63, 71, 0.12)",
    rippleStroke: (o: number) => `rgba(6, 63, 71, ${o * 0.8})`,
    rippleFill: (o: number) => `rgba(6, 63, 71, ${o * 0.18})`,
  },
  middle: {
    solid: "#D97706",
    stroke: "rgba(217, 119, 6, 0.55)",
    fill: "rgba(251, 191, 36, 0.08)",
    rippleStroke: (o: number) => `rgba(217, 119, 6, ${o * 0.8})`,
    rippleFill: (o: number) => `rgba(217, 119, 6, ${o * 0.15})`,
  },
  outer: {
    solid: "#7C3AED",
    stroke: "rgba(124, 58, 237, 0.55)",
    fill: "rgba(167, 139, 250, 0.08)",
    rippleStroke: (o: number) => `rgba(124, 58, 237, ${o * 0.8})`,
    rippleFill: (o: number) => `rgba(124, 58, 237, ${o * 0.15})`,
  },
} as const;

// ---------------------------------------------------------------------------
// ✅ Mechanic marker colors — used by BOTH the waiting/home map pins AND
// the tracking-screen pin now, so the exact same hard-hat pin shows up
// everywhere a mechanic is plotted (home map, "Finding a Mechanic" map,
// and "Mechanic Assigned!" / "Mechanic Has Arrived!" tracking map).
// ---------------------------------------------------------------------------
const MECHANIC_PIN_ONLINE = { bg: "#FC6B36", border: "#FFD9C7" };
const MECHANIC_PIN_OFFLINE = { bg: "#94A3B8", border: "#E2E8F0" };

// ---------------------------------------------------------------------------
// ✅ Tracking-screen status timeline — mirrors the booking status machine
// used throughout this file (requested -> accepted -> on_the_way ->
// arrived -> completed). Shared by the tracking-card timeline UI so the
// step highlighted there can never disagree with activeBooking.status.
// ---------------------------------------------------------------------------
const TRACKING_STEPS: { key: string; label: string }[] = [
  { key: "requested", label: "Request Confirmed" },
  { key: "accepted", label: "Mechanic Assigned" },
  { key: "on_the_way", label: "On The Way" },
  { key: "arrived", label: "Arrived" },
  { key: "completed", label: "Completed" },
];

function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default function CustomerScreen() {
  const insets = useSafeAreaInsets();
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [nearbyMechanics, setNearbyMechanics] = useState<Mechanic[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [activeBooking, setActiveBooking] = useState<any | null>(null);
  const [issueNote, setIssueNote] = useState("");
  const [coords, setCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creatingBooking, setCreatingBooking] = useState(false);
  const [waitingForMechanic, setWaitingForMechanic] = useState(false);
  const [selectedService, setSelectedService] = useState<ServiceItem | null>(
    null,
  );
  const [chosenService, setChosenService] = useState<ServiceItem | null>(
    null,
  );
  const { user, logout } = useAuth();
  const [timeRemaining, setTimeRemaining] = useState<number>(120);
  const [timerInterval, setTimerInterval] = useState<NodeJS.Timeout | null>(
    null,
  );
  const [serviceLocation, setServiceLocation] = useState<{
    latitude: number;
    longitude: number;
    address: string;
  } | null>(null);
  const [showOTPModal, setShowOTPModal] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [customerRating, setCustomerRating] = useState(0);
  const [customerReview, setCustomerReview] = useState("");
  const [completingService, setCompletingService] = useState(false);
  const [showVehicleListModal, setShowVehicleListModal] = useState(false);
  const [showServiceListModal, setShowServiceListModal] = useState(false);
  const [completedBookingId, setCompletedBookingId] = useState<string | null>(
    null,
  );
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleType | null>(
    null,
  );
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [vehicleTypesLoading, setVehicleTypesLoading] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<{
    latitude: number;
    longitude: number;
    address: string;
    isCurrentLocation?: boolean;
    savedLocationId?: string;
  } | null>(null);
  const [servicePrices, setServicePrices] = useState<Map<string, number>>(
    new Map(),
  );
  const [pricingLoading, setPricingLoading] = useState(false);
  const [priceDetails, setPriceDetails] = useState<Map<string, any>>(new Map());
  const [mechanicLocation, setMechanicLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [routeInfo, setRouteInfo] = useState<{
    distance: number;
    duration: number;
    distanceText: string;
    durationText: string;
  } | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [currentTrackingModal, setCurrentTrackingModal] = useState<"waiting" | "tracking" | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [mechanicName, setMechanicName] = useState<string>("");
  const [customerOtp, setCustomerOtp] = useState<string | null>(null);
  const [otpExpiry, setOtpExpiry] = useState<Date | null>(null);
  const [isWaitingForOtp, setIsWaitingForOtp] = useState(false);

  const [weatherTemp, setWeatherTemp] = useState<number | null>(null);
  const [weatherCode, setWeatherCode] = useState<number | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState(false);

  // ✅ One ripple animation per ring (inner 2km / middle 5km / outer 10km).
  const innerRippleAnim = useRef(new Animated.Value(0)).current;
  const middleRippleAnim = useRef(new Animated.Value(0)).current;
  const outerRippleAnim = useRef(new Animated.Value(0)).current;
  const [innerRippleRadius, setInnerRippleRadius] = useState(0);
  const [innerRippleOpacity, setInnerRippleOpacity] = useState(0);
  const [middleRippleRadius, setMiddleRippleRadius] = useState(0);
  const [middleRippleOpacity, setMiddleRippleOpacity] = useState(0);
  const [outerRippleRadius, setOuterRippleRadius] = useState(0);
  const [outerRippleOpacity, setOuterRippleOpacity] = useState(0);
  // showMiddleRing → 5km ring visible; showOuterRing → 10km ring visible.
  // Inner (2km) ring is always visible while the waiting screen is open.
  const [showMiddleRing, setShowMiddleRing] = useState(false);
  const [showOuterRing, setShowOuterRing] = useState(false);

  // ✅ Shared UI state pushed up to the Tabs layout so the bottom tab bar
  // itself can swap to a "Book Now" bar — see the sync effect below and
  // context/BookingUIContext.tsx. This is still wired up: the tab bar
  // (app/(tabs)/_layout.tsx) is the ONLY place that renders the Book Now
  // button now. This screen no longer renders its own duplicate footer.
  const { setBookingUI } = useBookingUI();

  const mapRef = useRef<MapView>(null);
  const homeMapRef = useRef<MapView>(null);
  const waitingMapRef = useRef<MapView>(null);
  const bottomSheetRef = useRef<BottomSheet>(null);
  const [homeMapReady, setHomeMapReady] = useState(false);
  const [waitingMapReady, setWaitingMapReady] = useState(false);

  const sheetSnapPoints = useMemo(() => ["43%", "75%", "80%"], []);
  const locationUpdateInterval = useRef<any>(null);
  const routeRetryCount = useRef(0);

  // ✅ Single derived source of truth for "how wide is the search right
  // now" — both the map's zoom level (delta) and the km number shown in
  // the UI are driven off this, so they can never fall out of sync as the
  // ring expands from 2km → 5km → 10km.
  const activeWaitingRadiusKm = showOuterRing
    ? MECHANIC_OUTER_RING_KM
    : showMiddleRing
    ? MECHANIC_MIDDLE_RING_KM
    : MECHANIC_INNER_RING_KM;

  const activeWaitingDelta = useMemo(() => {
    if (showOuterRing) return WAITING_REGION_DELTA_OUTER;
    if (showMiddleRing) return WAITING_REGION_DELTA_MIDDLE;
    return WAITING_REGION_DELTA_INNER;
  }, [showMiddleRing, showOuterRing]);

  useEffect(() => {
    if (chosenService) {
      bottomSheetRef.current?.snapToIndex(1);
    } else {
      bottomSheetRef.current?.snapToIndex(0);
    }
  }, [chosenService]);

  const activeBookingRef = useRef<any>(null);
  useEffect(() => {
    activeBookingRef.current = activeBooking;
  }, [activeBooking]);

  // ✅ NEW — tracks the last status we already reacted to (alerted on /
  // opened a modal for), so the socket handler AND the new polling
  // fallback below can share one code path without firing duplicate
  // alerts when they both observe the same status.
  const lastNotifiedStatusRef = useRef<string | null>(null);
  useEffect(() => {
    lastNotifiedStatusRef.current = activeBooking?.status ?? null;
  }, [activeBooking?.id]);

  // ---------------------------------------------------------------------
  // ✅ FIX (double feedback popup) — tracks booking IDs whose completion
  // has ALREADY been fully handled (rating modal opened / "Skip" chosen),
  // across every possible source of a "completed" signal:
  //   1) the "booking:status:updated" socket event (status: "completed")
  //   2) the separate "service:completed" socket event
  //   3) the reconciliation poll / app-foreground re-check re-fetching a
  //      booking that is already completed
  //   4) the customer's own OTP-verify path
  // Backends commonly fire BOTH #1 and #2 for the same completion, and
  // without a shared guard each one independently shows its own
  // "Service Completed" alert / opens the rating modal — which is
  // exactly what caused the feedback popup to appear twice. Every path
  // below now checks this ref before showing anything, and marks the
  // booking as handled the first time (whichever fires first wins; the
  // rest become silent no-ops).
  // ---------------------------------------------------------------------
  const completedBookingIdsRef = useRef<Set<string>>(new Set());

  // ---------------------------------------------------------------------
  // ✅ FIX — fetchBookingOTP now takes an explicit `openModalIfFound`
  // flag instead of unconditionally deciding modal visibility itself.
  // This is what lets us fetch/poll the OTP in the background (e.g. once
  // the mechanic marks the job "Arrived", so we're ready) WITHOUT that
  // background fetch popping the "Service Completion" screen on its own.
  // The modal should only ever appear because of an explicit trigger:
  //   1) the "otp:generated" socket event (mechanic tapped "Generate
  //      OTP" / "Complete Service" — see the listener below), or
  //   2) resuming the app on an "arrived" booking that ALREADY has an
  //      OTP generated server-side (checkActiveBooking, below), or
  //   3) the customer manually tapping "Complete Service with OTP" on
  //      the tracking screen.
  // In every other case (plain background polling) we only update
  // `customerOtp` / `isWaitingForOtp` silently.
  // ---------------------------------------------------------------------
  const fetchBookingOTP = async (
    bookingId: string,
    openModalIfFound: boolean = false,
  ) => {
    try {
      const response = await api.get(`/bookings/${bookingId}`);
      if (response.data) {
        if (response.data.completion_otp) {
          setCustomerOtp(response.data.completion_otp);
          setOtpExpiry(response.data.otp_expires_at ? new Date(response.data.otp_expires_at) : null);
          setIsWaitingForOtp(false);
          if (openModalIfFound) {
            setShowOTPModal(true);
          }
        } else {
          setIsWaitingForOtp(true);
          setCustomerOtp(null);
          setTimeout(() => fetchBookingOTP(bookingId, openModalIfFound), 5000);
        }
      }
    } catch (error) {
      console.error("Failed to fetch booking OTP:", error);
    }
  };

  // ---------------------------------------------------------------------
  // ✅ Single, shared "service actually completed" handler. This is now
  // the ONLY place that opens the rating modal — every code path that
  // learns the booking reached "completed" (the "booking:status:updated"
  // socket event, the "service:completed" socket event, or the
  // customer's own OTP-verify path) routes through this function instead
  // of duplicating the cleanup logic. That guarantees the rating popup
  // can never appear except as a direct, single-source reaction to the
  // booking's status genuinely becoming "completed" — and that every
  // other piece of in-flight UI (OTP modal/pin, tracking modal, waiting
  // timer) is always torn down at the same time, so nothing stale can
  // linger and re-trigger something later.
  //
  // ✅ FIX (double feedback popup) — this function is now idempotent per
  // booking id via completedBookingIdsRef: the FIRST caller (whichever
  // completion signal arrives first) opens the rating modal and tears
  // down state; every subsequent call for the SAME booking id — from a
  // duplicate socket event, a stray reconciliation-poll match, or a
  // second tap — is a silent no-op. This is what stops the rating
  // popup from appearing a second time.
  // ---------------------------------------------------------------------
  const handleBookingCompleted = useCallback((bookingId: string | null | undefined) => {
    if (!bookingId) return;
    if (completedBookingIdsRef.current.has(bookingId)) return; // already handled — prevent duplicate popup
    completedBookingIdsRef.current.add(bookingId);

    setCompletedBookingId(bookingId);
    setShowRatingModal(true);

    // Tear down every other piece of in-flight state for this booking —
    // completion supersedes all of it.
    setActiveBooking(null);
    setIsTracking(false);
    setCurrentTrackingModal(null);
    setWaitingForMechanic(false);
    setShowOTPModal(false);
    setCustomerOtp(null);
    setOtpExpiry(null);
    setIsWaitingForOtp(false);
    setMechanicLocation(null);
    setRouteInfo(null);
    setRouteError(null);
  }, []);

  const showRatingFlow = useCallback((bookingId: string) => {
    handleBookingCompleted(bookingId);
  }, [handleBookingCompleted]);

  // ---------------------------------------------------------------------
  // ✅ NEW — single shared function for applying a booking-status change.
  // Pulled out of the socket handler so the reconciliation poll further
  // down can reuse the EXACT same logic. This is what actually fixes the
  // "arrived" screen getting stuck on a stale status — it's no longer
  // only reachable via a single socket message that can be dropped (app
  // backgrounded, brief reconnect, etc). Every code path that learns
  // about a status change — socket push OR poll — now funnels through
  // here, so the UI can never show two different ideas of what the
  // booking's status is.
  // ---------------------------------------------------------------------
  const applyBookingStatusUpdate = useCallback(
    (updatedBooking: any) => {
      const current = activeBookingRef.current;
      if (!current || updatedBooking?.id !== current.id) return;

      if (updatedBooking.mechanic?.full_name) {
        setMechanicName(updatedBooking.mechanic.full_name);
      }

      const prevStatus = lastNotifiedStatusRef.current;
      const nextStatus = updatedBooking.status;

      if (nextStatus === "on_the_way") {
        setActiveBooking(updatedBooking);
        if (prevStatus !== "on_the_way") {
          Alert.alert("🚗 Mechanic On The Way!");
        }
        setCurrentTrackingModal("tracking");
        setIsTracking(true);
        socketService.requestMechanicLocation(updatedBooking.id);
      } else if (nextStatus === "arrived") {
        setActiveBooking(updatedBooking);
        // -------------------------------------------------------------
        // ✅ FIX — arriving no longer opens the OTP / "Service
        // Completion" popup by itself. It only lets the customer know
        // the mechanic is there and keeps the tracking screen visible.
        // The popup opens ONLY when the mechanic actually generates a
        // pin (via the "otp:generated" socket listener registered
        // below), i.e. once they tap "Generate OTP" or "Complete
        // Service" on their own dashboard — never just from tapping
        // "Arrived".
        // -------------------------------------------------------------
        if (prevStatus !== "arrived") {
          Alert.alert(
            "📍 Mechanic Arrived",
            "Your mechanic has arrived. They'll share a code with you shortly to complete the service.",
          );
        }
        setCurrentTrackingModal("tracking");
      } else if (nextStatus === "completed") {
        // -------------------------------------------------------------
        // ✅ FIX (double feedback popup) — this is THE real completion
        // signal: the mechanic verified the OTP and the backend/
        // mechanic app explicitly marked the booking "completed" (see
        // socketService.updateBookingStatus(bookingId, "completed") in
        // the mechanic dashboard's verifyMechanicOTP). We now check
        // completedBookingIdsRef BEFORE showing the alert — if the
        // "service:completed" socket event (handleServiceCompleted,
        // below) already handled this exact booking id first, we skip
        // the alert entirely instead of showing a second one. Either
        // way we route through the single shared, idempotent
        // handleBookingCompleted() so the rating popup — and ONLY the
        // rating popup — appears once, with every other bit of state
        // (OTP modal, tracking screen, etc.) cleared at the same time.
        // We intentionally do NOT setActiveBooking here first;
        // handleBookingCompleted clears it for us.
        // -------------------------------------------------------------
        const alreadyHandled = completedBookingIdsRef.current.has(updatedBooking.id);
        if (!alreadyHandled && prevStatus !== "completed") {
          Alert.alert(
            "✅ Service Completed",
            "Thank you for using our service! Please rate your experience.",
          );
        }
        handleBookingCompleted(updatedBooking.id);
        loadBookings();
      } else if (nextStatus === "cancelled") {
        if (prevStatus !== "cancelled") {
          Alert.alert("❌ Request Cancelled", "Your request has been cancelled.");
        }
        setActiveBooking(null);
        setWaitingForMechanic(false);
        setIsTracking(false);
        setCurrentTrackingModal(null);
        loadBookings();
      } else {
        setActiveBooking(updatedBooking);
      }

      lastNotifiedStatusRef.current = nextStatus;
    },
    [handleBookingCompleted],
  );

  useEffect(() => {
    const handleBookingAccepted = (data: {
      booking: Booking;
      mechanic: Mechanic;
    }) => {
      console.log("Booking accepted!", data);
      const current = activeBookingRef.current;
      if (!current || data.booking?.id !== current.id) return;

      setActiveBooking(data.booking);
      setMechanicName(data.mechanic.full_name);
      setWaitingForMechanic(false);
      setIsTracking(true);
      setCurrentTrackingModal("tracking");
      // ✅ NEW — keep the shared "last status we reacted to" ref in sync
      // so the reconciliation poll doesn't re-alert on the status we
      // just handled here.
      lastNotifiedStatusRef.current = (data.booking as any)?.status || "accepted";

      Alert.alert(
        "✓ Request Accepted!",
        `${data.mechanic.full_name} has accepted your request. Tracking their location now.`,
        [{ text: "OK" }],
      );

      startTrackingMechanic(data.booking);
    };

    // ✅ FIX — now just delegates to the shared applyBookingStatusUpdate()
    // function above, so socket pushes and the reconciliation poll can
    // never disagree about how a given status transition is handled.
    const handleStatusUpdated = (updatedBooking: Booking) => {
      console.log("Booking status updated:", updatedBooking);
      applyBookingStatusUpdate(updatedBooking);
    };

    // -----------------------------------------------------------------
    // ✅ FIX (double feedback popup) — this is a SEPARATE socket event
    // from "booking:status:updated" (status: "completed") above, and
    // some backends fire both for the same completion. This handler now
    // checks completedBookingIdsRef FIRST: if applyBookingStatusUpdate
    // already handled this exact booking id (e.g. its socket event
    // arrived a moment earlier), this becomes a silent no-op instead of
    // popping a second "Service Completed" alert on top of the rating
    // modal that's already showing. If this event arrives FIRST instead,
    // it proceeds as before, and the later "booking:status:updated" for
    // the same id will see it's already handled and skip its own alert.
    // -----------------------------------------------------------------
    const handleServiceCompleted = (data: { bookingId: string }) => {
      const current = activeBookingRef.current;
      if (!current || data.bookingId !== current.id) return;
      if (completedBookingIdsRef.current.has(data.bookingId)) return;

      Alert.alert(
        "✅ Service Completed!",
        "Your service has been completed. Please rate your experience.",
        [
          {
            text: "Rate Now",
            onPress: () => showRatingFlow(current.id),
          },
          {
            text: "Skip",
            style: "cancel",
            onPress: () => {
              // ✅ FIX — "Skip" marks the booking as handled (so a later
              // "booking:status:updated" completion event for the same
              // id can't reopen anything) and tears down the same
              // in-flight state handleBookingCompleted would have (OTP
              // modal/pin, tracking modal, waiting timer), instead of
              // only clearing activeBooking/isTracking and leaving OTP
              // state stranded.
              completedBookingIdsRef.current.add(current.id);
              setActiveBooking(null);
              setIsTracking(false);
              setCurrentTrackingModal(null);
              setWaitingForMechanic(false);
              setShowOTPModal(false);
              setCustomerOtp(null);
              setOtpExpiry(null);
              setIsWaitingForOtp(false);
            },
          },
        ],
      );
      loadBookings();
    };

    // -----------------------------------------------------------------
    // ✅ NEW — this is the ONE trigger that should open the customer's
    // "Service Completion" / OTP screen. It fires when the mechanic
    // explicitly taps "Generate OTP" or "Complete Service" on their
    // dashboard (see generateOTPForCompletion → socketService
    // .emitOtpGenerated(...) in the mechanic screen). Marking a job
    // "Arrived" alone never fires this event, so the popup can never
    // appear prematurely.
    // -----------------------------------------------------------------
    const handleOtpGenerated = (data: {
      bookingId: string;
      mechanicId?: string;
    }) => {
      const current = activeBookingRef.current;
      if (!current || data.bookingId !== current.id) return;

      setIsWaitingForOtp(true);
      setShowOTPModal(true);
      fetchBookingOTP(data.bookingId, true);
    };

    const handleMechanicLocationUpdate = (data: {
      bookingId: string;
      location: { lat: number; lng: number };
      eta: number;
      timestamp?: string;
      mechanic?: { full_name: string };
    }) => {
      const current = activeBookingRef.current;
      if (!current || data.bookingId !== current.id) return;

      if (
        !data.location ||
        typeof data.location.lat !== "number" ||
        typeof data.location.lng !== "number"
      ) {
        console.error("❌ Invalid location data received:", data.location);
        return;
      }

      const newLocation = {
        latitude: data.location.lat,
        longitude: data.location.lng,
      };

      setMechanicLocation(newLocation);

      if (data.mechanic?.full_name) {
        setMechanicName(data.mechanic.full_name);
      }

      setActiveBooking((prev: any) =>
        prev
          ? {
              ...prev,
              mechanic_location: data.location,
              eta_minutes: data.eta,
              mechanic: prev.mechanic || {
                full_name: data.mechanic?.full_name || prev.mechanic?.full_name,
              },
            }
          : null,
      );

      setCurrentTrackingModal("tracking");
      setIsTracking(true);
      setRouteError(null);
      routeRetryCount.current = 0;

      if (mapRef.current) {
        setTimeout(() => {
          mapRef.current?.fitToCoordinates(
            [newLocation],
            {
              edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
              animated: true,
            },
          );
        }, 500);
      }
    };

    socketService.on("booking:accepted", handleBookingAccepted);
    socketService.on("booking:status:updated", handleStatusUpdated);
    socketService.on("service:completed", handleServiceCompleted);
    socketService.on("otp:generated", handleOtpGenerated);
    socketService.on("mechanic:location:update", handleMechanicLocationUpdate);

    return () => {
      socketService.off("booking:accepted", handleBookingAccepted);
      socketService.off("booking:status:updated", handleStatusUpdated);
      socketService.off("service:completed", handleServiceCompleted);
      socketService.off("otp:generated", handleOtpGenerated);
      socketService.off(
        "mechanic:location:update",
        handleMechanicLocationUpdate,
      );

      if (locationUpdateInterval.current) {
        clearInterval(locationUpdateInterval.current);
      }
      if (timerInterval) {
        clearInterval(timerInterval);
      }
    };
  }, [handleBookingCompleted, showRatingFlow, applyBookingStatusUpdate]);

  useEffect(() => {
    if (activeBooking?.id) {
      socketService.joinBookingRoom(activeBooking.id);
      socketService.requestMechanicLocation(activeBooking.id);
    }
  }, [activeBooking?.id]);

  // ---------------------------------------------------------------------
  // ✅ NEW — reconciliation poll. This is the actual fix for the
  // "customer stuck on 'Mechanic is Coming!' after the mechanic dashboard
  // already shows ARRIVED" bug: relying solely on the "booking:status:
  // updated" socket event means a single dropped/late message (app
  // briefly backgrounded, reconnect, race with room-join, etc.) leaves
  // the customer's screen frozen on a stale status with nothing to ever
  // correct it. While a booking is active, this quietly re-fetches it
  // from the API every 6s and — ONLY if the server's status has moved
  // past what we're currently showing — runs it through the exact same
  // applyBookingStatusUpdate() the socket handler uses. So regardless of
  // whether the update arrives via socket or this poll, it's handled
  // identically (same alerts, same modal transitions, same dedupe via
  // lastNotifiedStatusRef AND completedBookingIdsRef), and the tracking
  // screen can no longer get permanently stuck, nor can this poll ever
  // pop a duplicate completion alert.
  // ---------------------------------------------------------------------
  useEffect(() => {
    const id = activeBooking?.id;
    const status = activeBooking?.status;
    if (!id || !["accepted", "on_the_way", "arrived"].includes(status)) return;

    const interval = setInterval(async () => {
      try {
        const { data } = await api.get(`/bookings/${id}`);
        if (data && data.status !== activeBookingRef.current?.status) {
          applyBookingStatusUpdate(data);
        }
      } catch (error) {
        console.error("Booking status reconciliation poll failed:", error);
      }
    }, 6000);

    return () => clearInterval(interval);
  }, [activeBooking?.id, activeBooking?.status, applyBookingStatusUpdate]);

  // ---------------------------------------------------------------------
  // ✅ FIX — this effect used to force `setShowOTPModal(true)` the moment
  // `activeBooking.status` became "arrived", which is exactly what made
  // the "Service Completion" popup appear on the customer side as soon
  // as the mechanic tapped "Arrived" — before any pin had actually been
  // generated. It now only makes sure we're silently polling for the
  // OTP in the background (via fetchBookingOTP, openModalIfFound=false)
  // so `customerOtp`/`isWaitingForOtp` are ready and accurate. The modal
  // itself only opens from the "otp:generated" socket event above, from
  // checkActiveBooking finding an OTP already generated on app-resume,
  // or from the customer manually tapping "Complete Service with OTP".
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (activeBooking?.status === "arrived" && activeBooking?.id && !customerOtp) {
      fetchBookingOTP(activeBooking.id, false);
    }
  }, [activeBooking?.status, activeBooking?.id]);

  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      (nextAppState: AppStateStatus) => {
        if (nextAppState === "active" && activeBookingRef.current) {
          fetchCurrentLocation();
          if (activeBookingRef.current.mechanic_id) {
            socketService.requestMechanicLocation(activeBookingRef.current.id);
          }
          // ✅ NEW — resuming from background is exactly when a socket
          // event is most likely to have been missed, so force an
          // immediate reconciliation check instead of waiting for the
          // next 6s poll tick.
          if (activeBookingRef.current.id) {
            api
              .get(`/bookings/${activeBookingRef.current.id}`)
              .then(({ data }) => {
                if (data && data.status !== activeBookingRef.current?.status) {
                  applyBookingStatusUpdate(data);
                }
              })
              .catch((error) =>
                console.error("Foreground reconciliation check failed:", error),
              );
          }
        }
      },
    );
    return () => subscription.remove();
  }, [applyBookingStatusUpdate]);

  useEffect(() => {
    if (waitingForMechanic && activeBooking) {
      setTimeRemaining(120);
      const interval: any = setInterval(() => {
        setTimeRemaining((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            cancelActiveBooking();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      setTimerInterval(interval);
      return () => {
        if (interval) clearInterval(interval);
      };
    } else {
      if (timerInterval) {
        clearInterval(timerInterval);
        setTimerInterval(null);
      }
    }
  }, [waitingForMechanic, activeBooking?.id]);

  useEffect(() => {
    if (activeBooking && activeBooking.status === "accepted") {
      const interval = setInterval(() => {
        sendLocationUpdate(activeBooking.id, 10);
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [activeBooking?.id, activeBooking?.status]);

  useEffect(() => {
    if (currentTrackingModal !== "waiting" || !coords) return;
    const interval = setInterval(() => {
      fetchNearbyMechanicsForMap();
    }, 8000);
    return () => clearInterval(interval);
  }, [currentTrackingModal, coords?.latitude, coords?.longitude]);

  // ✅ Inner (2km) ripple — always animating while the waiting screen is
  // open, same as before.
  useEffect(() => {
    if (currentTrackingModal !== "waiting") return;

    innerRippleAnim.setValue(0);
    const loop = Animated.loop(
      Animated.timing(innerRippleAnim, {
        toValue: 1,
        duration: INNER_RIPPLE_DURATION_MS,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }),
    );
    loop.start();

    const listenerId = innerRippleAnim.addListener(({ value }) => {
      setInnerRippleRadius(MECHANIC_INNER_RING_KM * 1000 * value);
      setInnerRippleOpacity(1 - value);
    });

    return () => {
      loop.stop();
      innerRippleAnim.removeListener(listenerId);
      setInnerRippleRadius(0);
      setInnerRippleOpacity(0);
    };
  }, [currentTrackingModal]);

  // ✅ Drives BOTH expansion flags off the same countdown timer that
  // powers the inner ring, so the 2km → 5km → 10km handoff always lines
  // up with the "Elapsed time" stat shown on screen.
  useEffect(() => {
    if (currentTrackingModal !== "waiting") {
      setShowMiddleRing(false);
      setShowOuterRing(false);
      return;
    }
    if (timeRemaining <= 120 - MIDDLE_RIPPLE_DELAY_SEC) {
      setShowMiddleRing(true);
    }
    if (timeRemaining <= 120 - OUTER_RIPPLE_DELAY_SEC) {
      setShowOuterRing(true);
    }
  }, [timeRemaining, currentTrackingModal]);

  // ✅ Middle (5km) ripple — same pattern as the inner ripple, just gated
  // behind showMiddleRing instead of always-on.
  useEffect(() => {
    if (!showMiddleRing) return;

    middleRippleAnim.setValue(0);
    const loop = Animated.loop(
      Animated.timing(middleRippleAnim, {
        toValue: 1,
        duration: MIDDLE_RIPPLE_DURATION_MS,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }),
    );
    loop.start();

    const listenerId = middleRippleAnim.addListener(({ value }) => {
      setMiddleRippleRadius(MECHANIC_MIDDLE_RING_KM * 1000 * value);
      setMiddleRippleOpacity(1 - value);
    });

    return () => {
      loop.stop();
      middleRippleAnim.removeListener(listenerId);
      setMiddleRippleRadius(0);
      setMiddleRippleOpacity(0);
    };
  }, [showMiddleRing]);

  // ✅ Outer (10km) ripple — same pattern again, gated behind showOuterRing.
  useEffect(() => {
    if (!showOuterRing) return;

    outerRippleAnim.setValue(0);
    const loop = Animated.loop(
      Animated.timing(outerRippleAnim, {
        toValue: 1,
        duration: OUTER_RIPPLE_DURATION_MS,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }),
    );
    loop.start();

    const listenerId = outerRippleAnim.addListener(({ value }) => {
      setOuterRippleRadius(MECHANIC_OUTER_RING_KM * 1000 * value);
      setOuterRippleOpacity(1 - value);
    });

    return () => {
      loop.stop();
      outerRippleAnim.removeListener(listenerId);
      setOuterRippleRadius(0);
      setOuterRippleOpacity(0);
    };
  }, [showOuterRing]);

  useFocusEffect(
    useCallback(() => {
      if (user) {
        checkActiveBooking();
      }
    }, [user]),
  );

  useEffect(() => {
    if (user) {
      initializeApp();
    }
  }, [user]);

  useEffect(() => {
    fetchVehicleTypes();
  }, []);

  async function fetchVehicleTypes() {
    setVehicleTypesLoading(true);
    try {
      const { data } = await api.get("/services/vehicle-types");
      const normalized: VehicleType[] = (data || []).map((vt: any) => ({
        id: Number(vt.id),
        name: vt.name,
        category: vt.category,
        display_order: vt.display_order,
      }));
      normalized.sort((a, b) => a.display_order - b.display_order);
      setVehicleTypes(normalized);
    } catch (error) {
      console.error("Failed to fetch vehicle types:", error);
    } finally {
      setVehicleTypesLoading(false);
    }
  }

  const fetchDynamicPricing = useCallback(async () => {
    if (!selectedVehicle) return;

    setPricingLoading(true);
    try {
      const { data } = await api.get(
        `/services/pricing/vehicle/${selectedVehicle.id}`,
      );
      const priceMap = new Map<string, number>();
      const detailsMap = new Map<string, any>();

      if (data && Array.isArray(data)) {
        data.forEach((pricingItem: any) => {
          const serviceName = pricingItem.services?.name;
          if (serviceName) {
            priceMap.set(serviceName, pricingItem.price);
            detailsMap.set(serviceName, {
              price: pricingItem.price,
              notes: pricingItem.notes,
              serviceId: pricingItem.service_id,
              pricingId: pricingItem.id,
            });
          }
        });
      }

      setServicePrices(priceMap);
      setPriceDetails(detailsMap);
    } catch (error: any) {
      console.error(
        "Failed to fetch dynamic pricing:",
        error?.response?.data || error,
      );
      const fallbackMap = new Map<string, number>();
      services.forEach((service) => {
        fallbackMap.set(service.name, service.base_price);
      });
      setServicePrices(fallbackMap);
      Alert.alert(
        "Pricing Unavailable",
        "Unable to fetch pricing for this vehicle. Using base prices.",
      );
    } finally {
      setPricingLoading(false);
    }
  }, [selectedVehicle, services]);

  useEffect(() => {
    if (selectedVehicle && services.length > 0) {
      fetchDynamicPricing();
    }
  }, [selectedVehicle?.id, services.length]);

  useEffect(() => {
    if (!coords) {
      setWeatherLoading(false);
      setWeatherError(false);
      return;
    }

    let cancelled = false;

    const debounceTimer = setTimeout(async () => {
      setWeatherLoading(true);
      setWeatherError(false);
      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude}&longitude=${coords.longitude}&current_weather=true`,
        );

        if (!res.ok) {
          throw new Error(`Weather API responded with status ${res.status}`);
        }

        const json = await res.json();

        if (cancelled) return;

        if (json?.current_weather) {
          setWeatherTemp(Math.round(json.current_weather.temperature));
          setWeatherCode(json.current_weather.weathercode);
          setWeatherError(false);
        } else {
          throw new Error("Weather API response missing current_weather");
        }
      } catch (error) {
        console.error("Failed to fetch weather:", error);
        if (!cancelled) {
          setWeatherTemp(null);
          setWeatherCode(null);
          setWeatherError(true);
        }
      } finally {
        if (!cancelled) setWeatherLoading(false);
      }
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(debounceTimer);
    };
  }, [coords?.latitude, coords?.longitude]);

  useEffect(() => {
    if (!coords || !homeMapReady) return;
    homeMapRef.current?.animateToRegion(
      {
        ...coords,
        latitudeDelta: CLOSE_REGION_DELTA,
        longitudeDelta: CLOSE_REGION_DELTA,
      },
      500,
    );
  }, [coords?.latitude, coords?.longitude, homeMapReady]);

  useEffect(() => {
    if (!coords || !waitingMapReady || currentTrackingModal !== "waiting") return;
    waitingMapRef.current?.animateToRegion(
      {
        ...coords,
        latitudeDelta: activeWaitingDelta,
        longitudeDelta: activeWaitingDelta,
      },
      400,
    );
  }, [
    coords?.latitude,
    coords?.longitude,
    waitingMapReady,
    currentTrackingModal,
    nearbyMechanics.length,
    activeWaitingDelta,
  ]);

  const recenterOnMe = useCallback(async () => {
    await fetchCurrentLocation();
  }, []);

  const recenterWaitingMap = useCallback(() => {
    if (!coords) return;
    waitingMapRef.current?.animateToRegion(
      {
        ...coords,
        latitudeDelta: activeWaitingDelta,
        longitudeDelta: activeWaitingDelta,
      },
      400,
    );
  }, [coords, activeWaitingDelta]);

  const mappableMechanics = useMemo(
    () =>
      nearbyMechanics
        .map((mechanic: any) => ({
          mechanic,
          coordinate: getMechanicCoordinate(mechanic),
        }))
        .filter(
          (
            entry,
          ): entry is {
            mechanic: any;
            coordinate: { latitude: number; longitude: number };
          } => entry.coordinate !== null,
        ),
    [nearbyMechanics],
  );

  // ✅ Only show mechanics that fall inside whichever ring is currently
  // active (2km, then 5km, then 10km) — same filtering pattern as before,
  // just parameterized by activeWaitingRadiusKm instead of a single
  // hardcoded threshold.
  const visibleWaitingMechanics = useMemo(() => {
    if (!coords) return mappableMechanics;
    return mappableMechanics.filter(({ mechanic, coordinate }) => {
      const distanceKm =
        typeof mechanic.distance_km === "number"
          ? mechanic.distance_km
          : calculateDistance(
              coords.latitude,
              coords.longitude,
              coordinate.latitude,
              coordinate.longitude,
            );
      return distanceKm <= activeWaitingRadiusKm;
    });
    
  }, [mappableMechanics, activeWaitingRadiusKm, coords]);

  const quickAccessData = useMemo(
    () =>
      QUICK_ACCESS_CONFIG.map((cfg) => {
        const service = services.find((s) =>
          cfg.keywords.some((kw) => serviceMatchesKeyword(s.name ?? "", kw)),
        );
        return {
          ...cfg,
          service,
          available: isServiceAvailable(service?.name),
        };
      }),
    [services],
  );

  const chosenServicePrice = useMemo(() => {
    if (!chosenService) return null;
    return servicePrices.get(chosenService.name) ?? chosenService.base_price;
  }, [chosenService, servicePrices]);

  // ✅ Price for the service actively being searched for a mechanic
  // (selectedService is set at createBooking time and stays populated
  // while the waiting screen is showing, so the waiting card can display
  // what the customer is being charged for this request).
  const selectedServicePrice = useMemo(() => {
    if (!selectedService) return null;
    return (
      servicePrices.get(selectedService.name) ?? selectedService.base_price
    );
  }, [selectedService, servicePrices]);

  const canBookNow = !!(
    chosenService &&
    selectedVehicle &&
    (selectedLocation || coords)
  );

  // ---------------------------------------------------------------------
  // ✅ Pushes booking-readiness state up to BookingUIContext, which the
  // Tabs layout (app/(tabs)/_layout.tsx) reads to render its "Book Now"
  // tab bar. This is the ONLY Book Now UI now — the in-sheet footer that
  // used to duplicate it here has been removed (see render below).
  // ---------------------------------------------------------------------
  useEffect(() => {
    setBookingUI({
      canBookNow,
      price: chosenServicePrice,
      loading: creatingBooking,
      onBookNow: chosenService ? () => createBooking(chosenService) : null,
    });
  }, [canBookNow, chosenServicePrice, creatingBooking, chosenService, setBookingUI]);

  const recentBooking = useMemo(() => {
    const completed = bookings
      .filter((b) => b.status === "completed")
      .sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      );
    return completed[0] || null;
  }, [bookings]);

  const recentBookingServiceName = useMemo(() => {
    if (!recentBooking) return "Service";
    const match = services.find((s) => s.id === recentBooking.service_id);
    return match?.name || "Service";
  }, [recentBooking, services]);

  // ---------------------------------------------------------------------
  // ✅ Selecting a service (not deselecting it) automatically opens the
  // vehicle-type modal if no vehicle has been picked yet. This replaces
  // the old always-visible inline "Vehicle Type" grid — the vehicle
  // picker now only appears when it's actually needed, right after the
  // customer commits to a service.
  // ---------------------------------------------------------------------
  const handleQuickAccessPress = useCallback(
    (qa: (typeof quickAccessData)[number]) => {
      if (!qa.available) {
        Alert.alert(
          "Currently unavailable",
          `${qa.label.replace("\n", " ")} isn't available for booking yet. Please check back soon.`,
        );
        return;
      }
      if (!qa.service) {
        Alert.alert(
          "Not available",
          `${qa.label.replace("\n", " ")} isn't offered in your area yet.`,
        );
        return;
      }

      const wasSelected = chosenService?.id === qa.service.id;
      setChosenService(wasSelected ? null : qa.service);

      if (!wasSelected && !selectedVehicle) {
        setShowVehicleListModal(true);
      }
    },
    [chosenService, selectedVehicle],
  );

  const handleServiceModalSelect = useCallback(
    (service: ServiceItem) => {
      if (!isServiceAvailable(service.name)) {
        Alert.alert(
          "Service Unavailable",
          `${service.name} isn't available for booking right now.`,
        );
        return;
      }

      const wasSelected = chosenService?.id === service.id;
      setChosenService(wasSelected ? null : service);
      setShowServiceListModal(false);

      if (!wasSelected && !selectedVehicle) {
        setShowVehicleListModal(true);
      }
    },
    [chosenService, selectedVehicle],
  );

  // ---------------------------------------------------------------------
  // ✅ FIX — vehicle selection TOGGLES, and deselecting a vehicle (by any
  // route — tapping the already-selected vehicle again here, OR tapping
  // the dustbin/delete button on the "selected vehicle" card) now ALWAYS
  // clears the chosen service too. Previously, tapping the same vehicle
  // again to unselect it only cleared `selectedVehicle`, leaving
  // `chosenService` (and therefore `canBookNow`) still set — so "Book
  // Now" could remain active with no vehicle chosen. Both deselect paths
  // now go through the same clearing logic so they can never disagree.
  // ---------------------------------------------------------------------
  const handleVehicleSelect = useCallback(
    (vt: VehicleType) => {
      // Tapping the already-selected vehicle again unselects it — and
      // clears the chosen service along with it.
      if (selectedVehicle?.id === vt.id) {
        setSelectedVehicle(null);
        setChosenService(null);
        return;
      }

      const lat = selectedLocation?.latitude ?? coords?.latitude;
      const lng = selectedLocation?.longitude ?? coords?.longitude;

      if (!lat || !lng) {
        Alert.alert(
          "Location missing",
          "Please select a location before choosing a vehicle.",
        );
        return;
      }

      setSelectedVehicle(vt);
    },
    [selectedLocation, coords, selectedVehicle],
  );

  // ---------------------------------------------------------------------
  // ✅ Clears the selected vehicle AND the chosen service together.
  // Wired to the dustbin (delete) button on the "selected vehicle" card
  // below. Clearing selectedVehicle automatically hides the whole
  // "Vehicle Type" section (it's already gated on `selectedVehicle &&`
  // in the render), and clearing chosenService puts the "Choose a
  // Service" quick-access grid back to its unselected state (isSelected
  // there is derived from chosenService?.id, so no separate reset is
  // needed).
  // ---------------------------------------------------------------------
  const handleRemoveVehicleSelection = useCallback(() => {
    setSelectedVehicle(null);
    setChosenService(null);
  }, []);

  const fetchCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setCoords({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
    } catch (error) {
      console.error("Failed to get location:", error);
    }
  };

  const sendLocationUpdate = async (bookingId: string, eta: number) => {
    try {
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      socketService.sendMechanicLocation(
        bookingId,
        { lat: location.coords.latitude, lng: location.coords.longitude },
        eta,
        user?.id,
      );
    } catch (error) {
      console.error("Failed to get location for update:", error);
    }
  };

  async function checkActiveBooking() {
    try {
      const { data } = await api.get(`/bookings/customer/${user?.id}`);
      const active = data.find(
        (b: Booking) => b.status !== "completed" && b.status !== "cancelled",
      );

      if (active) {
        setActiveBooking(active);

        if (active.customer_lat && active.customer_lng) {
          setServiceLocation({
            latitude: active.customer_lat,
            longitude: active.customer_lng,
            address: active.customer_address || "Service Location",
          });
        }

        if (active.mechanic?.full_name) {
          setMechanicName(active.mechanic.full_name);
        }

        if (
          active.status === "accepted" ||
          active.status === "on_the_way" ||
          active.status === "arrived"
        ) {
          setIsTracking(true);
          setCurrentTrackingModal("tracking");
          startTrackingMechanic(active);

          if (active.mechanic_id) {
            setTimeout(() => {
              socketService.requestMechanicLocation(active.id);
            }, 1000);
          }

          // -----------------------------------------------------------
          // ✅ FIX — resuming into an "arrived" booking no longer force
          // -opens the OTP modal. We only fetch the OTP, and pass
          // openModalIfFound=true so the modal appears ONLY if the
          // mechanic had already generated a pin before the app was
          // reopened (in which case popping it back up is correct — the
          // customer was already meant to see it). If no pin has been
          // generated yet, this just starts the silent background poll
          // and the modal stays closed until "otp:generated" fires or
          // one shows up.
          // -----------------------------------------------------------
          if (active.status === "arrived") {
            fetchBookingOTP(active.id, true);
          }
        } else if (active.status === "requested") {
          setWaitingForMechanic(true);
          setCurrentTrackingModal("waiting");

          // ✅ Keep the selectedService (and its price) in sync when we
          // resume an in-flight "requested" booking after a refresh /
          // app relaunch, so the waiting card can still show the price.
          const match = services.find((s) => s.id === active.service_id);
          if (match) setSelectedService(match);

          await fetchNearbyMechanicsForMap();
        }
      } else {
        setServiceLocation(null);
      }
    } catch (error) {
      console.error("Failed to check active booking:", error);
      Alert.alert("Error", "Failed to check Active Bookings");
    }
  }

  async function initializeApp() {
    await fetchServices();
    await fetchLocationAndMechanics();
    await loadBookings();
    setLoading(false);
  }

  async function fetchServices() {
    try {
      const { data } = await api.get("/services");
      setServices(data || []);
    } catch (error) {
      console.error("Failed to fetch services:", error);
    }
  }

  async function fetchLocationAndMechanics() {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      Alert.alert(
        "Permission required",
        "Location is needed to find nearby mechanics.",
      );
      return;
    }

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    const nextCoords = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    };
    setCoords(nextCoords);

    try {
      const { data } = await api.get("/mechanics/nearby", {
        params: {
          lat: nextCoords.latitude,
          lng: nextCoords.longitude,
          radiusKm: MECHANIC_SEARCH_RADIUS_KM,
        },
      });
      setNearbyMechanics(data || []);
    } catch (error) {
      console.error("Failed to fetch mechanics:", error);
    }
  }

  async function fetchNearbyMechanicsForMap() {
    if (!coords) return;
    try {
      const { data } = await api.get("/mechanics/nearby", {
        params: {
          lat: coords.latitude,
          lng: coords.longitude,
          radiusKm: MECHANIC_SEARCH_RADIUS_KM,
        },
      });
      console.log("🔧 /mechanics/nearby raw response:", JSON.stringify(data));
    console.log("🔧 mechanic count from API:", data?.length ?? 0);
      setNearbyMechanics(data || []);
    } catch (error) {
      console.error("Failed to fetch mechanics for map:", error);
    }
  }

  async function loadBookings() {
    if (!user) return;
    try {
      const { data } = await api.get(`/bookings/customer/${user?.id}`);
      setBookings(data);
    } catch (error) {
      console.error("Failed to load bookings:", error);
    }
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchServices();
    await fetchLocationAndMechanics();
    await loadBookings();
    await fetchVehicleTypes();
    setRefreshing(false);
  }, []);

  const handleLocationSelect = (location: {
    latitude: number;
    longitude: number;
    address: string;
    isCurrentLocation?: boolean;
    savedLocationId?: string;
  }) => {
    setSelectedLocation(location);
    setCoords({ latitude: location.latitude, longitude: location.longitude });
  };

  async function createBooking(service: ServiceItem) {
    const locationToUse =
      selectedLocation ||
      (coords
        ? {
            latitude: coords.latitude,
            longitude: coords.longitude,
            address: "Live GPS location",
            isCurrentLocation: true,
          }
        : null);

    if (!locationToUse) {
      Alert.alert("Location missing", "Please select a location first.");
      return;
    }

    if (!user) {
      Alert.alert("Not logged in", "Please login to create a booking");
      router.push("/(auth)/login");
      return;
    }

    if (!selectedVehicle) {
      Alert.alert("Vehicle Required", "Please select your vehicle type below.");
      return;
    }

    setCreatingBooking(true);
    setSelectedService(service);

    const dynamicPrice = servicePrices.get(service.name);
    const finalAmount = dynamicPrice || service.base_price;
    const priceInfo = priceDetails.get(service.name);

    try {
      const payload = {
        customerId: user?.id,
        mechanicId: null,
        serviceId: service?.id,
        issueNote: issueNote || `${service?.name} assistance needed`,
        customerLat: locationToUse?.latitude,
        customerLng: locationToUse?.longitude,
        customerAddress: locationToUse?.address,
        status: "requested",
        savedLocationId: locationToUse?.savedLocationId ?? null,
        vehicle_type: selectedVehicle.category,
        vehicle_model: String(selectedVehicle.id),
        amount: Number(finalAmount),
        service_pricing_id: priceInfo?.pricingId ?? null,
      };

      console.log("Creating booking with payload:", JSON.stringify(payload));

      const { data } = await api.post("/bookings", payload);

      if (!data || typeof data !== 'object') {
        throw new Error("Invalid response from server. Please try again.");
      }

      if (!data.id) {
        throw new Error(
          data.message || data.error || "Booking creation failed — no ID returned."
        );
      }

      setActiveBooking(data);

      if (data.customer_lat && data.customer_lng) {
        setServiceLocation({
          latitude: Number(data.customer_lat),
          longitude: Number(data.customer_lng),
          address: data.customer_address || locationToUse.address || "Service Location",
        });
      } else {
        setServiceLocation({
          latitude: locationToUse.latitude,
          longitude: locationToUse.longitude,
          address: locationToUse.address,
        });
      }

      setWaitingForMechanic(true);
      setCurrentTrackingModal("waiting");
      socketService.joinBookingRoom(data?.id);

      await fetchNearbyMechanicsForMap();

      Alert.alert(
        "Request Sent",
        "Looking for nearby mechanics... You'll be notified when one accepts your request."
      );
      setIssueNote("");
      setChosenService(null);
    } catch (error: any) {
      console.error("Booking creation error:", error);

      let errMsg = "Failed to create booking. Please try again.";

      if (typeof error?.message === "string" && error.message.length > 0) {
        errMsg = error.message;
      } else if (typeof error?.response?.data?.message === "string") {
        errMsg = error.response.data.message;
      } else if (typeof error?.response?.data?.error === "string") {
        errMsg = error.response.data.error;
      }

      if (errMsg.toLowerCase().includes("timeout") || errMsg.toLowerCase().includes("timed out")) {
        errMsg = "Server is starting up (this happens once). Please wait 10 seconds and try again.";
      }

      Alert.alert("Booking Failed", errMsg);
      setWaitingForMechanic(false);
      setSelectedService(null);
      setCurrentTrackingModal(null);
    } finally {
      setCreatingBooking(false);
    }
  }

  const handleRebook = useCallback(
    (booking: Booking) => {
      const match = services.find((s) => s.id === booking.service_id);

      if (!match) {
        Alert.alert("Unavailable", "This service can't be rebooked right now.");
        return;
      }
      if (!selectedVehicle) {
        Alert.alert(
          "Vehicle Required",
          "Please select your vehicle type below first.",
        );
        return;
      }
      createBooking(match);
    },
    [services, selectedVehicle, createBooking],
  );

  function startTrackingMechanic(booking: Booking) {
    if (booking.mechanic_id) {
      socketService.joinMechanicRoom(booking.mechanic_id);
    }
  }

  // ---------------------------------------------------------------------
  // ✅ NOTE — this customer-side verify function is intentionally NOT
  // wired to any button in the UI. Per the product flow, the CUSTOMER
  // never types the OTP — the MECHANIC does (they read it back from the
  // customer and enter it in their own app; see verifyMechanicOTP in the
  // mechanic dashboard). This is kept only in case a future "customer
  // self-serve" entry point is added, and if it ever runs it now routes
  // completion through the same idempotent handleBookingCompleted() used
  // everywhere else, so the rating popup can never appear through two
  // different code paths with two different cleanup behaviors.
  // ---------------------------------------------------------------------
  async function handleVerifyOTP() {
    if (!otpCode || otpCode.length !== 6) {
      Alert.alert("Error", "Please enter the 6-digit OTP code");
      return;
    }

    setCompletingService(true);
    try {
      const response = await api.post(
        `/bookings/${activeBookingRef.current?.id}/verify-otp`,
        {
          otp: otpCode,
        },
      );

      if (response.data.success) {
        const bookingId = activeBookingRef.current?.id;
        socketService.emitOtpVerified(bookingId);
        socketService.updateBookingStatus(bookingId, "completed");
        setOtpCode("");

        Alert.alert(
          "✓ Service Completed!",
          "Thank you for using our service! Please rate your experience.",
        );

        handleBookingCompleted(bookingId);
        await loadBookings();
      }
    } catch (error: any) {
      console.error("OTP verification error:", error);
      Alert.alert(
        "Verification Failed",
        error?.message || "Invalid OTP. Please try again.",
      );
    } finally {
      setCompletingService(false);
    }
  }

  async function submitRating() {
    if (customerRating === 0) {
      Alert.alert("Error", "Please rate your experience");
      return;
    }

    setCompletingService(true);
    try {
      await api.post(`/bookings/${completedBookingId}/add-rating`, {
        rating: customerRating,
        review: customerReview.trim() || undefined,
      });

      Alert.alert(
        "Thank You!",
        "Your feedback has been submitted successfully.",
        [
          {
            text: "OK",
            onPress: () => {
              setShowRatingModal(false);
              setCustomerRating(0);
              setCustomerReview("");
              setCompletedBookingId(null);
              setActiveBooking(null);
              setWaitingForMechanic(false);
              setIsTracking(false);
              setCurrentTrackingModal(null);
              loadBookings();
            },
          },
        ],
      );
    } catch (error: any) {
      Alert.alert(
        "Error",
        error?.message || "Failed to submit rating",
      );
    } finally {
      setCompletingService(false);
    }
  }

  async function cancelActiveBooking() {
    Alert.alert(
      "Cancel Request",
      "Are you sure you want to cancel this request?",
      [
        { text: "No", style: "cancel" },
        {
          text: "Yes",
          style: "destructive",
          onPress: async () => {
            try {
              await api.patch(
                `/bookings/${activeBookingRef.current?.id}/cancel`,
                {},
              );
              setActiveBooking(null);
              setWaitingForMechanic(false);
              setIsTracking(false);
              setCurrentTrackingModal(null);
              setChosenService(null);
              Alert.alert("Cancelled", "Your request has been cancelled.");
              loadBookings();
            } catch (error) {
              Alert.alert("Error", "Failed to cancel request");
            }
          },
        },
      ],
    );
  }

  async function handleLogout() {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      { text: "Logout", onPress: () => logout() },
    ]);
  }

  const renderWaitingScreen = () => (
    <Modal
      visible={currentTrackingModal === "waiting"}
      transparent={false}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={cancelActiveBooking}
      onShow={() => {
        if (coords) {
          waitingMapRef.current?.animateToRegion(
            {
              ...coords,
              latitudeDelta: activeWaitingDelta,
              longitudeDelta: activeWaitingDelta,
            },
            0,
          );
        }
        fetchNearbyMechanicsForMap();
      }}
    >
      {/*
        ✅ FIX — SafeAreaProvider re-mounted here.
        react-native-safe-area-context's insets are computed from the
        provider that's mounted in the *native root view* the component
        tree renders into. RN's <Modal> renders its children into a
        SEPARATE native window/root on Android (and sometimes iOS), so
        the outer SafeAreaProvider (mounted at the app root) doesn't
        automatically know about that window's edges — useSafeAreaInsets()
        can silently report bottom: 0 inside a Modal, even on a phone
        with a soft-key nav bar. That's why "Cancel Search" was being
        clipped by the Android nav bar in testing. Wrapping the Modal's
        content in its own SafeAreaProvider forces it to remeasure insets
        for the Modal's own window, so insets.bottom is correct here.

        ✅ FIX — LAYOUT: the map and the status card are now laid out as
        two flex children of one flex column (`waitingContainer`):
          - `mapContainerFull` uses `flex: 1` so the map ALWAYS eats
            whatever vertical space the card doesn't need. It grows or
            shrinks automatically — no more fixed height * 0.5 fighting
            with the card for space.
          - `waitingStatusCard` is NOT flexed — it sizes itself to its
            own content (header + stats + notice + price row + button),
            capped by `maxHeight` as a safety net for very short/small
            screens. Because it's not flex:1 anymore, there's no leftover
            empty space between the price row and the "Cancel Search"
            button — the button sits directly after the content with a
            fixed marginTop, and any extra room in the screen goes to
            the map instead of to blank space in the card.
          - `waitingScrollArea` is back to `flexGrow: 0 / flexShrink: 1`
            so it only takes the height its content needs; it will only
            start scrolling internally if the content is taller than the
            card's `maxHeight` allows (e.g. very small phones).
      */}
      <SafeAreaProvider>
        {/*
          ✅ FIX — "bottom" removed from edges here. ModalSafeArea was
          padding the WHOLE screen by insets.bottom, and then
          waitingStatusCard below ALSO added insets.bottom (+16, +24 on
          Android) as its own paddingBottom — the two stacked, which is
          what was pushing "Cancel Search" up with a large empty gap
          beneath it. Only the card should own the bottom safe-area
          padding now; the outer SafeAreaView only handles top/left/right.
        */}
        <ModalSafeArea style={styles.waitingContainer} edges={["top", "left", "right"]}>
          <View style={[styles.mapContainer, styles.mapContainerFull]}>
            {coords ? (
              <MapView
                ref={waitingMapRef}
                style={styles.map}
                provider={PROVIDER_GOOGLE}
                initialRegion={{
                  latitude: coords.latitude,
                  longitude: coords.longitude,
                  latitudeDelta: WAITING_REGION_DELTA_INNER,
                  longitudeDelta: WAITING_REGION_DELTA_INNER,
                }}
                onMapReady={() => setWaitingMapReady(true)}
                showsUserLocation={false}
                showsMyLocationButton={false}
                showsCompass={false}
                rotateEnabled={false}
                pitchEnabled={false}
              >
                {/*
                  ✅ Rings are drawn widest-first (10km → 5km → 2km) so the
                  smaller, more "active" rings always render on top of the
                  wider ones. Each ring only mounts once its tier is
                  reached, exactly mirroring how the original 5km ring
                  used to gate on showOuterRipple.
                */}
                {showOuterRing && (
                  <Circle
                    center={coords}
                    radius={MECHANIC_OUTER_RING_KM * 1000}
                    strokeWidth={1.5}
                    strokeColor={RING_COLORS.outer.stroke}
                    fillColor={RING_COLORS.outer.fill}
                  />
                )}

                {showMiddleRing && (
                  <Circle
                    center={coords}
                    radius={MECHANIC_MIDDLE_RING_KM * 1000}
                    strokeWidth={1.5}
                    strokeColor={RING_COLORS.middle.stroke}
                    fillColor={RING_COLORS.middle.fill}
                  />
                )}

                <Circle
                  center={coords}
                  radius={MECHANIC_INNER_RING_KM * 1000}
                  strokeWidth={1.5}
                  strokeColor={RING_COLORS.inner.stroke}
                  fillColor={RING_COLORS.inner.fill}
                />

                {innerRippleOpacity > 0 && (
                  <Circle
                    center={coords}
                    radius={innerRippleRadius}
                    strokeWidth={2}
                    strokeColor={RING_COLORS.inner.rippleStroke(innerRippleOpacity)}
                    fillColor={RING_COLORS.inner.rippleFill(innerRippleOpacity)}
                  />
                )}

                {showMiddleRing && middleRippleOpacity > 0 && (
                  <Circle
                    center={coords}
                    radius={middleRippleRadius}
                    strokeWidth={2}
                    strokeColor={RING_COLORS.middle.rippleStroke(middleRippleOpacity)}
                    fillColor={RING_COLORS.middle.rippleFill(middleRippleOpacity)}
                  />
                )}

                {showOuterRing && outerRippleOpacity > 0 && (
                  <Circle
                    center={coords}
                    radius={outerRippleRadius}
                    strokeWidth={2}
                    strokeColor={RING_COLORS.outer.rippleStroke(outerRippleOpacity)}
                    fillColor={RING_COLORS.outer.rippleFill(outerRippleOpacity)}
                  />
                )}

                <UserLocationMarker coordinate={coords} />

                {visibleWaitingMechanics.map(({ mechanic, coordinate }) => (
                  <Marker
                    key={mechanic.id}
                    coordinate={coordinate}
                  >
                    <View
                      style={[
                        styles.mechanicMarkerPin,
                        {
                          backgroundColor: mechanic.is_online
                            ? MECHANIC_PIN_ONLINE.bg
                            : MECHANIC_PIN_OFFLINE.bg,
                          borderColor: mechanic.is_online
                            ? MECHANIC_PIN_ONLINE.border
                            : MECHANIC_PIN_OFFLINE.border,
                        },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name="account-hard-hat"
                        size={22}
                        color="#FFFFFF"
                      />
                    </View>
                    <View
                      style={[
                        styles.mechanicMarkerPointer,
                        {
                          borderTopColor: mechanic.is_online
                            ? MECHANIC_PIN_ONLINE.bg
                            : MECHANIC_PIN_OFFLINE.bg,
                        },
                      ]}
                    />
                    <Callout>
                      <View style={styles.calloutContainer}>
                        <Text style={styles.calloutName}>
                          {mechanic.full_name}
                        </Text>
                        <Text style={styles.calloutDistance}>
                          {mechanic.distance_km?.toFixed(1)} km away
                        </Text>
                      </View>
                    </Callout>
                  </Marker>
                ))}
              </MapView>
            ) : (
              <View style={styles.loadingMapContainer}>
                <ActivityIndicator size="large" color="#063F47" />
                <Text style={styles.loadingMapText}>Getting your location…</Text>
              </View>
            )}

            {coords && (
              <View style={styles.radiusLegend}>
                <View style={styles.radiusLegendRow}>
                  <View
                    style={[styles.radiusLegendDot, { backgroundColor: RING_COLORS.inner.solid }]}
                  />
                  <Text style={styles.radiusLegendText}>
                    {MECHANIC_INNER_RING_KM} km
                  </Text>
                </View>
                {showMiddleRing && (
                  <View style={styles.radiusLegendRow}>
                    <View
                      style={[styles.radiusLegendDot, { backgroundColor: RING_COLORS.middle.solid }]}
                    />
                    <Text style={styles.radiusLegendText}>
                      {MECHANIC_MIDDLE_RING_KM} km
                    </Text>
                  </View>
                )}
                {showOuterRing && (
                  <View style={styles.radiusLegendRow}>
                    <View
                      style={[styles.radiusLegendDot, { backgroundColor: RING_COLORS.outer.solid }]}
                    />
                    <Text style={styles.radiusLegendText}>
                      {MECHANIC_OUTER_RING_KM} km
                    </Text>
                  </View>
                )}
              </View>
            )}

            {coords && (
              <TouchableOpacity
                style={styles.waitingRecenterButton}
                onPress={recenterWaitingMap}
                accessibilityLabel="Recenter on my location"
              >
                <Ionicons name="locate" size={18} color="#063F47" />
              </TouchableOpacity>
            )}
          </View>

          <View
            style={[
              styles.waitingStatusCard,
              // ✅ FIX — Math.max guards against a still-zero inset on
              // devices/timings where even the re-mounted provider hasn't
              // measured yet, so there's always a safe minimum gap above
              // the Android nav bar / iOS home indicator. Extra fixed
              // padding on Android accounts for 3-button nav bars, which
              // report a bottom inset of 0 from safe-area-context (they
              // aren't a "notch"), yet still visually cover content.
              {
                paddingBottom:
                  Math.max(16, insets.bottom + 16) +
                  (Platform.OS === "android" ? 24 : 0),
              },
            ]}
          >
            <View style={styles.waitingCardHeaderRow}>
              <View style={styles.waitingHeaderTitleRow}>
                <View style={styles.waitingHeaderIconWrap}>
                  <Ionicons name="search" size={16} color="#063F47" />
                </View>
                <View style={styles.waitingHeaderTextWrap}>
                  <Text style={styles.waitingHeaderTitle}>Finding a Mechanic</Text>
                  <Text style={styles.waitingHeaderSubtitle} numberOfLines={1}>
                    {showOuterRing
                      ? `Searching for available mechanics within ${MECHANIC_OUTER_RING_KM}km`
                      : showMiddleRing
                      ? `Searching for available mechanics within ${MECHANIC_MIDDLE_RING_KM}km`
                      : `Sending request to mechanics within ${MECHANIC_INNER_RING_KM}km first`}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={cancelActiveBooking}
                style={styles.waitingCancelButton}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={22} color="#EF4444" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.waitingScrollArea}
              contentContainerStyle={styles.waitingScrollContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <View style={styles.statIconWrap}>
                    <Ionicons name="people-outline" size={16} color="#063F47" />
                  </View>
                  <Text style={styles.statValue}>{visibleWaitingMechanics.length}</Text>
                  <Text style={styles.statLabel} numberOfLines={1}>
                    Mechanic{visibleWaitingMechanics.length !== 1 ? "s" : ""} nearby
                  </Text>
                </View>

                <View style={styles.statDivider} />

                <View style={styles.statItem}>
                  <View style={styles.statIconWrap}>
                    <Ionicons name="time-outline" size={16} color="#063F47" />
                  </View>
                  <Text style={styles.statValue}>
                    {Math.floor((120 - timeRemaining) / 60)}:
                    {((120 - timeRemaining) % 60).toString().padStart(2, "0")}
                  </Text>
                  <Text style={styles.statLabel} numberOfLines={1}>Elapsed time</Text>
                </View>

                <View style={styles.statDivider} />

                <View style={styles.statItem}>
                  <View style={styles.statIconWrap}>
                    <Ionicons name="radio-outline" size={16} color="#063F47" />
                  </View>
                  <Text style={styles.statValue}>
                    {activeWaitingRadiusKm} km
                  </Text>
                  <Text style={styles.statLabel} numberOfLines={1}>Current radius</Text>
                </View>
              </View>

              <View style={styles.timerProgress}>
                <View
                  style={[
                    styles.timerProgressFill,
                    { width: `${((120 - timeRemaining) / 120) * 100}%` },
                  ]}
                />
              </View>

              <View style={styles.expandNoticeRow}>
                <Ionicons name="information-circle-outline" size={18} color="#64748B" />
                <View style={styles.expandNoticeTextWrap}>
                  <Text style={styles.expandNoticeTitle}>
                    {showOuterRing
                      ? `Searching within ${MECHANIC_OUTER_RING_KM}km radius`
                      : showMiddleRing
                      ? `No mechanic found in ${MECHANIC_MIDDLE_RING_KM}km?`
                      : `No mechanic found in ${MECHANIC_INNER_RING_KM}km?`}
                  </Text>
                  {!showOuterRing && (
                    <Text style={styles.expandNoticeSubtitle}>
                      {showMiddleRing
                        ? `We'll automatically expand to ${MECHANIC_OUTER_RING_KM}km radius.`
                        : `We'll automatically expand to ${MECHANIC_MIDDLE_RING_KM}km radius.`}
                    </Text>
                  )}
                </View>
              </View>

              {selectedService && (
                <View style={styles.serviceInfoBox}>
                  <View style={styles.serviceInfoIconWrap}>
                    <Ionicons name="construct-outline" size={16} color="#063F47" />
                  </View>
                  <View style={styles.serviceInfoTextWrap}>
                    <Text style={styles.serviceInfoTitle} numberOfLines={1}>
                      {selectedService.name}
                    </Text>
                    {issueNote ? (
                      <Text style={styles.serviceInfoNote} numberOfLines={1}>
                        {issueNote}
                      </Text>
                    ) : null}
                  </View>
                  {/* ✅ Price for the service this request was created for */}
                  {selectedServicePrice != null && (
                    <Text style={styles.serviceInfoPrice}>
                      ₹{Math.round(selectedServicePrice)}
                    </Text>
                  )}
                </View>
              )}
            </ScrollView>

            <TouchableOpacity
              style={styles.cancelButtonOutlined}
              onPress={cancelActiveBooking}
              activeOpacity={0.7}
            >
              <Text style={styles.cancelButtonOutlinedText}>Cancel Search</Text>
            </TouchableOpacity>
          </View>
        </ModalSafeArea>
      </SafeAreaProvider>
    </Modal>
  );

  // ---------------------------------------------------------------------
  // ✅ TRACKING SCREEN — redesigned info card.
  // Layout mirrors the reference design: an ETA hero row, a mechanic
  // profile row with a call button, a vehicle/service summary row, and a
  // vertical status timeline with per-step timestamps (requested is
  // always shown as done here since this screen only renders once the
  // booking has passed that stage). The map above still shows the exact
  // same pins as before — service-location pin + mechanic pin (amber) +
  // live route — with two changes:
  //
  //   ✅ FIX — the destination ("Mechanic Assigned" service-location) pin
  //   now uses the SAME <UserLocationMarker /> component used for the
  //   customer's current-location pin on the "Finding a Mechanic" waiting
  //   screen and on the home map, instead of the old one-off blue
  //   location-pin View (styles.serviceLocationMarker). This is the exact
  //   same locator pin everywhere the customer's location is plotted.
  //
  //   ✅ FIX — the mechanic pin on this screen now uses the SAME
  //   hard-hat "pin + pointer" marker (mechanicMarkerPin /
  //   mechanicMarkerPointer, colored with MECHANIC_PIN_ONLINE) as the
  //   "Finding a Mechanic" waiting screen and the home map, instead of
  //   the old plain car-in-a-circle. This one marker style is now used
  //   for every stage — Mechanic Assigned, On The Way, and Arrived —
  //   since they all render through this same function.
  //
  //   ✅ NEW — a Rapido-style dashed straight-line connector
  //   (react-native-maps' <Polyline>) is drawn directly between the
  //   mechanic pin and the destination pin. It renders immediately
  //   (as soon as both coordinates are known), so there's always a
  //   visible link between the two points even before the real
  //   MapViewDirections road route has loaded. Once the actual driving
  //   route comes back, the solid green route line renders on top of
  //   it, giving the same "straight connector + real route overlaid"
  //   look Rapido/Ola/Uber use to show how much distance the vehicle
  //   still has to cover.
  //
  //   ✅ FIX — the ETA hero row and the mechanic profile row have been
  //   merged into ONE single card (`mechanicEtaCard`): the mechanic's
  //   avatar/name/rating/call button sit on top, a thin divider
  //   separates it from an "Arriving in / mechanic has arrived" strip
  //   underneath — one section instead of two separate cards stacked
  //   with a gap between them.
  // ---------------------------------------------------------------------
  const renderTrackingScreen = () => {
    if (
      currentTrackingModal !== "tracking" ||
      !activeBooking ||
      activeBooking.status === "completed"
    ) {
      return null;
    }

    const destination =
      serviceLocation ||
      (coords
        ? { latitude: coords.latitude, longitude: coords.longitude }
        : null);

    const distance =
      mechanicLocation && destination
        ? calculateDistance(
            destination.latitude,
            destination.longitude,
            mechanicLocation.latitude,
            mechanicLocation.longitude,
          )
        : null;

    const hasValidLocations = destination && mechanicLocation;
    const displayMechanicName =
      mechanicName || activeBooking?.mechanic?.full_name || "Mechanic";

    const mechanicPhone =
      activeBooking?.mechanic?.phone_number ||
      activeBooking?.mechanic?.phone ||
      activeBooking?.mechanic?.mobile ||
      null;

    const mechanicRating =
      typeof activeBooking?.mechanic?.rating === "number"
        ? activeBooking.mechanic.rating
        : null;

    const canShowDirections =
      GOOGLE_MAPS_API_KEY &&
      GOOGLE_MAPS_API_KEY !== "your_api_key_here" &&
      GOOGLE_MAPS_API_KEY.length > 10;

    const currentStepIndex = TRACKING_STEPS.findIndex(
      (s) => s.key === activeBooking.status,
    );

    const etaHeadline =
      activeBooking.status === "arrived"
        ? "Mechanic has arrived"
        : "Arriving in";

    const etaValue =
      activeBooking.status === "arrived"
        ? null
        : routeInfo?.durationText ||
          (distance !== null
            ? distance < 1
              ? "2-3 min"
              : `~${Math.round(distance * 2)} min`
            : "Calculating…");

    const vehicleIcon = iconForVehicleCategory(
      selectedVehicle?.category || activeBooking?.vehicle_type,
    );

    return (
      <Modal
        visible={true}
        transparent={false}
        animationType="slide"
        statusBarTranslucent
        onRequestClose={cancelActiveBooking}
      >
        {/* ✅ Same Modal-safe-area fix as the waiting screen above. */}
        <SafeAreaProvider>
          <ModalSafeArea style={styles.trackingContainer} edges={["top", "bottom", "left", "right"]}>
            <View style={styles.trackingHeader}>
              <Text style={styles.trackingTitle}>
                {activeBooking.status === "accepted" && "✓ Mechanic Assigned!"}
                {activeBooking.status === "on_the_way" &&
                  "🚗 Mechanic is Coming!"}
                {activeBooking.status === "arrived" && "📍 Mechanic Has Arrived!"}
              </Text>
              <TouchableOpacity
                onPress={cancelActiveBooking}
                style={styles.trackingCancelButton}
              >
                <Ionicons name="close" size={22} color="#EF4444" />
              </TouchableOpacity>
            </View>

            <View style={[styles.mapContainer, styles.trackingMapContainer]}>
              {hasValidLocations ? (
                <MapView
                  ref={mapRef}
                  style={styles.map}
                  provider={PROVIDER_GOOGLE}
                  initialRegion={{
                    latitude:
                      (destination.latitude + mechanicLocation.latitude) / 2,
                    longitude:
                      (destination.longitude + mechanicLocation.longitude) / 2,
                    latitudeDelta:
                      Math.abs(destination.latitude - mechanicLocation.latitude) *
                        1.5 +
                      0.01,
                    longitudeDelta:
                      Math.abs(
                        destination.longitude - mechanicLocation.longitude,
                      ) *
                        1.5 +
                      0.01,
                  }}
                  showsUserLocation={false}
                  showsMyLocationButton={false}
                  onMapReady={() => {
                    setTimeout(() => {
                      mapRef.current?.fitToCoordinates(
                        [destination, mechanicLocation],
                        {
                          edgePadding: {
                            top: 100,
                            right: 100,
                            bottom: 100,
                            left: 100,
                          },
                          animated: true,
                        },
                      );
                    }, 500);
                  }}
                >
                  {/*
                    ✅ NEW — Rapido-style dashed "as the crow flies"
                    connector between the mechanic and the destination.
                    Drawn UNDER the real route (declared before it, and
                    also visually thinner/lighter), so as soon as
                    MapViewDirections resolves, the solid green route
                    line sits on top of this dashed guide — exactly the
                    "line shows how much ground is covered" look from
                    Rapido. Always visible whenever both points are
                    known, so the connection is never missing while the
                    real route is still loading.
                  */}
                  <Polyline
                    coordinates={[mechanicLocation, destination]}
                    strokeColor="#94A3B8"
                    strokeWidth={2}
                    lineDashPattern={[8, 6]}
                    zIndex={1}
                  />

                  {/*
                    ✅ FIX — same locator pin used for the customer's
                    current location everywhere else in this file
                    (waiting-screen map + home map): <UserLocationMarker />.
                    Previously this was a one-off blue circle
                    (styles.serviceLocationMarker) that didn't match the
                    pin shown anywhere else.
                  */}
                  <UserLocationMarker coordinate={destination} />

                  {/*
                    ✅ FIX — same hard-hat pin + pointer marker used on
                    the "Finding a Mechanic" map and the home map
                    (styles.mechanicMarkerPin / mechanicMarkerPointer),
                    instead of the old plain car-in-a-circle
                    (trackingMechanicMarker). This is the ONE marker
                    style used for Mechanic Assigned, On The Way, and
                    Arrived, since all three statuses render through
                    this same function.
                  */}
                  <Marker coordinate={mechanicLocation}>
                    <View
                      style={[
                        styles.mechanicMarkerPin,
                        {
                          backgroundColor: MECHANIC_PIN_ONLINE.bg,
                          borderColor: MECHANIC_PIN_ONLINE.border,
                        },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name="account-hard-hat"
                        size={22}
                        color="#FFFFFF"
                      />
                    </View>
                    <View
                      style={[
                        styles.mechanicMarkerPointer,
                        { borderTopColor: MECHANIC_PIN_ONLINE.bg },
                      ]}
                    />
                    <Callout>
                      <Text style={styles.calloutText}>
                        {displayMechanicName}
                      </Text>
                      {distance ? (
                        <Text style={styles.calloutDistance}>
                          {distance < 1
                            ? `${Math.round(distance * 1000)}m`
                            : `${distance.toFixed(1)}km`}{" "}
                          away
                        </Text>
                      ) : null}
                    </Callout>
                  </Marker>

                  {canShowDirections && (
                    <MapViewDirections
                      origin={mechanicLocation}
                      destination={destination}
                      apikey={GOOGLE_MAPS_API_KEY}
                      strokeWidth={4}
                      strokeColor="#10B981"
                      mode="DRIVING"
                      optimizeWaypoints={true}
                      resetOnChange={false}
                      timePrecision="now"
                      precision="high"
                      onReady={(result) => {
                        setRouteInfo({
                          distance: result.distance,
                          duration: result.duration,
                          distanceText:
                            result.distance < 1
                              ? `${Math.round(result.distance * 1000)}m`
                              : `${result.distance.toFixed(1)}km`,
                          durationText:
                            result.duration < 1
                              ? "< 1 minute"
                              : `${Math.round(result.duration)} min`,
                        });
                        setRouteError(null);
                        mapRef.current?.fitToCoordinates(
                          [destination, mechanicLocation],
                          {
                            edgePadding: {
                              top: 100,
                              right: 100,
                              bottom: 100,
                              left: 100,
                            },
                            animated: true,
                          },
                        );
                      }}
                      onError={(errorMessage) => {
                        console.error("❌ Route error:", errorMessage);
                        setRouteError(
                          typeof errorMessage === "string"
                            ? errorMessage
                            : "Route unavailable",
                        );
                        if (routeRetryCount.current < 2) {
                          setTimeout(() => {
                            routeRetryCount.current++;
                            setRouteInfo(null);
                          }, 5000);
                        }
                      }}
                    />
                  )}
                </MapView>
              ) : (
                <View style={styles.loadingMapContainer}>
                  <ActivityIndicator size="large" color="#063F47" />
                  <Text style={styles.loadingMapText}>
                    {!destination
                      ? "Loading service location..."
                      : "Waiting for mechanic location..."}
                  </Text>
                  <TouchableOpacity
                    style={styles.refreshLocationButton}
                    onPress={() =>
                      socketService.requestMechanicLocation(activeBooking?.id)
                    }
                  >
                    <Text style={styles.refreshLocationText}>
                      Refresh Location
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            <View style={styles.trackingInfoCard}>
              <ScrollView
                style={styles.trackingInfoScroll}
                contentContainerStyle={[
                  styles.trackingInfoScrollContent,
                  {
                    paddingBottom:
                      Math.max(16, insets.bottom + 16) +
                      (Platform.OS === "android" ? 20 : 0),
                  },
                ]}
                showsVerticalScrollIndicator={false}
              >
                {/*
                  ✅ Mechanic + ETA — merged into a SINGLE section: the
                  mechanic's avatar/name/rating/call button on top, a
                  thin divider, then an "Arriving in ..." /
                  "Mechanic has arrived" strip directly underneath —
                  one card instead of two.
                */}
                <View style={styles.mechanicEtaCard}>
                  <View style={styles.mechanicEtaTopRow}>
                    <View style={styles.mechanicAvatar2}>
                      <Ionicons name="person" size={18} color="#FFF" />
                    </View>
                    <View style={styles.mechanicTextWrap2}>
                      <Text style={styles.mechanicNameText2} numberOfLines={1}>
                        {displayMechanicName}
                      </Text>
                      <View style={styles.mechanicRoleRatingRow}>
                        <Text style={styles.mechanicRoleText2}>
                          Expert Mechanic
                        </Text>
                        {mechanicRating !== null && (
                          <>
                            <Ionicons
                              name="star"
                              size={10}
                              color="#FBBF24"
                              style={styles.mechanicRatingIcon}
                            />
                            <Text style={styles.mechanicRatingText}>
                              {mechanicRating.toFixed(1)}
                            </Text>
                          </>
                        )}
                      </View>
                    </View>
                    {/*
                      ✅ FIX — the call button is now ALWAYS rendered in
                      this corner of the mechanic card (previously it was
                      hidden completely whenever mechanicPhone was
                      missing/not yet loaded, which is why it wasn't
                      showing up next to the name). If a number is
                      available it dials it directly; otherwise it still
                      shows (dimmed) and lets the customer know the
                      number isn't available yet instead of silently
                      disappearing.
                    */}
                    <TouchableOpacity
                      style={[
                        styles.callButton2,
                        !mechanicPhone && styles.callButton2Disabled,
                      ]}
                      onPress={() => {
                        if (mechanicPhone) {
                          Linking.openURL(`tel:${mechanicPhone}`);
                        } else {
                          Alert.alert(
                            "Number unavailable",
                            "Your mechanic's phone number isn't available yet.",
                          );
                        }
                      }}
                      accessibilityLabel="Call mechanic"
                    >
                      <Ionicons
                        name="call"
                        size={16}
                        color={mechanicPhone ? "#063F47" : "#94A3B8"}
                      />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.mechanicEtaDivider} />

                  <View style={styles.mechanicEtaBottomRow}>
                    <View style={styles.etaRing}>
                      <Ionicons
                        name={
                          activeBooking.status === "arrived"
                            ? "location"
                            : "navigate"
                        }
                        size={16}
                        color="#063F47"
                      />
                    </View>
                    <Text style={styles.etaLabel}>{etaHeadline}</Text>
                    {etaValue ? (
                      <Text
                        style={styles.etaValueText}
                        numberOfLines={1}
                      >
                        {etaValue}
                      </Text>
                    ) : null}
                  </View>
                </View>

                {/* Vehicle + service row */}
                {(selectedVehicle || selectedService) && (
                  <View style={styles.vehicleCard2}>
                    <View style={styles.vehicleIconWrap2}>
                      {vehicleIcon.lib === "FontAwesome5" ? (
                        <FontAwesome5
                          name={vehicleIcon.name}
                          size={14}
                          color="#EA580C"
                        />
                      ) : vehicleIcon.lib === "MaterialCommunityIcons" ? (
                        <MaterialCommunityIcons
                          name={vehicleIcon.name as any}
                          size={18}
                          color="#EA580C"
                        />
                      ) : (
                        <Ionicons
                          name={vehicleIcon.name as any}
                          size={18}
                          color="#EA580C"
                        />
                      )}
                    </View>
                    <View style={styles.vehicleTextWrap2}>
                      <Text style={styles.vehicleNameText2} numberOfLines={1}>
                        {selectedVehicle?.name || "Your Vehicle"}
                      </Text>
                      <Text style={styles.vehicleSubText2} numberOfLines={1}>
                        {selectedService?.name || "Service"}
                      </Text>
                    </View>
                    {selectedServicePrice != null && (
                      <Text style={styles.vehiclePriceText2}>
                        ₹{Math.round(selectedServicePrice)}
                      </Text>
                    )}
                  </View>
                )}

                {/* Address */}
                <View style={styles.addressRow2}>
                  <Ionicons name="location-outline" size={14} color="#64748B" />
                  <Text style={styles.addressText2} numberOfLines={2}>
                    {serviceLocation?.address || "Service Location"}
                  </Text>
                </View>

                {routeError && distance !== null ? (
                  <Text style={styles.routeErrorText}>
                    Using estimated ETA (GPS only)
                  </Text>
                ) : null}

                {/*
                  ✅ NEW — while the mechanic is on-site but hasn't yet
                  generated a pin, show a small inline status strip
                  instead of any modal. This keeps the customer informed
                  without popping the "Service Completion" screen — that
                  screen only opens once "otp:generated" actually fires.
                */}
                {activeBooking.status === "arrived" && !customerOtp && (
                  <View style={styles.awaitingOtpStrip}>
                    <ActivityIndicator size="small" color="#D97706" />
                    <Text style={styles.awaitingOtpStripText}>
                      Waiting for your mechanic to share the completion code…
                    </Text>
                  </View>
                )}

                {/* Status timeline */}
                <View style={styles.timelineCard}>
                  {TRACKING_STEPS.map((step, idx) => {
                    const isDone =
                      idx <= currentStepIndex || step.key === "requested";
                    const isLast = idx === TRACKING_STEPS.length - 1;
                    const timestamp = getStepTimestamp(
                      activeBooking,
                      step.key,
                    );

                    return (
                      <View key={step.key} style={styles.timelineRow}>
                        <View style={styles.timelineLeftCol}>
                          <View
                            style={[
                              styles.timelineDot,
                              isDone && styles.timelineDotDone,
                            ]}
                          >
                            {isDone && (
                              <Ionicons
                                name="checkmark"
                                size={10}
                                color="#FFF"
                              />
                            )}
                          </View>
                          {!isLast && (
                            <View
                              style={[
                                styles.timelineLine,
                                idx < currentStepIndex &&
                                  styles.timelineLineDone,
                              ]}
                            />
                          )}
                        </View>
                        <View
                          style={[
                            styles.timelineRightCol,
                            isLast && styles.timelineRightColLast,
                          ]}
                        >
                          <Text
                            style={[
                              styles.timelineLabel,
                              isDone && styles.timelineLabelDone,
                            ]}
                            numberOfLines={1}
                          >
                            {step.label}
                          </Text>
                          <Text style={styles.timelineTime}>
                            {timestamp || (isDone ? "" : "—")}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>

                {/*
                  ✅ FIX — this button is a deliberate, customer-initiated
                  action ("let me check the code myself"), so it's still
                  fine for it to open the modal directly. We route it
                  through fetchBookingOTP(..., true) instead of a bare
                  setShowOTPModal(true) so it always shows accurate
                  waiting/ready state instead of a stale one.
                */}
                {activeBooking.status === "arrived" && (
                  <TouchableOpacity
                    style={styles.completeButton}
                    onPress={() => {
                      setShowOTPModal(true);
                      fetchBookingOTP(activeBooking.id, true);
                    }}
                  >
                    <Text style={styles.completeButtonText}>
                      Complete Service with OTP
                    </Text>
                  </TouchableOpacity>
                )}

                {activeBooking.status !== "arrived" && (
                  <TouchableOpacity
                    style={styles.cancelTrackingButton}
                    onPress={cancelActiveBooking}
                  >
                    <Text style={styles.cancelTrackingButtonText}>
                      Cancel Service
                    </Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            </View>
          </ModalSafeArea>
        </SafeAreaProvider>
      </Modal>
    );
  };

  const renderOTPModal = () => {
    const getRemainingMinutes = () => {
      if (!otpExpiry) return 10;
      const remaining = Math.max(0, Math.floor((otpExpiry.getTime() - Date.now()) / 60000));
      return remaining;
    };

    return (
      <Modal visible={showOTPModal} transparent={true} animationType="slide" statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Ionicons name="shield-checkmark" size={50} color="#10B981" />
              <Text style={styles.modalTitle}>Service Completion</Text>
              <Text style={styles.modalSubtitle}>
                Your mechanic has arrived and is ready to complete the service
              </Text>
            </View>

            {customerOtp ? (
              <View style={styles.customerOtpContainer}>
                <Text style={styles.customerOtpLabel}>
                  Read this code to your mechanic:
                </Text>
                <Text style={styles.customerOtpDisplay}>{customerOtp}</Text>
                <Text style={styles.customerOtpExpiry}>
                  This code expires in {getRemainingMinutes()} minutes
                </Text>
              </View>
            ) : isWaitingForOtp ? (
              <View style={styles.waitingForOtpContainer}>
                <ActivityIndicator size="large" color="#10B981" />
                <Text style={styles.waitingForOtpText}>
                  Waiting for mechanic to generate OTP...
                </Text>
                <Text style={styles.waitingForOtpSubtext}>
                  Please ask your mechanic to click &#34;Generate OTP" in their app
                </Text>
              </View>
            ) : (
              <View style={styles.waitingForOtpContainer}>
                <Ionicons name="alert-circle-outline" size={48} color="#F59E0B" />
                <Text style={styles.waitingForOtpText}>
                  No OTP generated yet
                </Text>
                <Text style={styles.waitingForOtpSubtext}>
                  Please ask your mechanic to generate an OTP code
                </Text>
              </View>
            )}

            <View style={styles.instructionContainer}>
              <Ionicons name="information-circle-outline" size={20} color="#64748B" />
              <Text style={styles.instructionText}>
                Tell your mechanic the 6-digit code above. They will enter it in their app to complete the service.
              </Text>
            </View>

            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => {
                setShowOTPModal(false);
                setCustomerOtp(null);
              }}
            >
              <Text style={styles.modalCloseButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  const renderRatingModal = () => (
   <Modal visible={showRatingModal} transparent={true} animationType="slide" statusBarTranslucent>
      <View style={styles.modalOverlay}>
        <ScrollView contentContainerStyle={styles.modalScrollContent}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Ionicons name="star" size={50} color="#FBBF24" />
              <Text style={styles.modalTitle}>Rate Your Experience</Text>
              <Text style={styles.modalSubtitle}>
                How was your service with{" "}
                {activeBooking?.mechanic?.full_name || "the mechanic"}?
              </Text>
            </View>

            <View style={styles.ratingContainer}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity
                  key={star}
                  onPress={() => setCustomerRating(star)}
                  style={styles.starButton}
                >
                  <Ionicons
                    name={star <= customerRating ? "star" : "star-outline"}
                    size={48}
                    color="#FBBF24"
                  />
                </TouchableOpacity>
              ))}
            </View>

            {customerRating > 0 && (
              <View style={styles.ratingLabel}>
                <Text style={styles.ratingLabelText}>
                  {customerRating === 1 && "Poor"}
                  {customerRating === 2 && "Fair"}
                  {customerRating === 3 && "Good"}
                  {customerRating === 4 && "Very Good"}
                  {customerRating === 5 && "Excellent!"}
                </Text>
              </View>
            )}

            <TextInput
              style={styles.reviewInput}
              placeholder="Share your experience (optional)"
              value={customerReview}
              onChangeText={setCustomerReview}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            <TouchableOpacity
              style={[
                styles.submitRatingButton,
                completingService && styles.disabledButton,
              ]}
              onPress={submitRating}
              disabled={completingService}
            >
              {completingService ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <Text style={styles.submitRatingButtonText}>
                  Submit Feedback
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.skipButton}
              onPress={() => {
                setShowRatingModal(false);
                setCustomerRating(0);
                setCustomerReview("");
                setCompletedBookingId(null);
                setActiveBooking(null);
                setIsTracking(false);
                setCurrentTrackingModal(null);
                loadBookings();
              }}
            >
              <Text style={styles.skipButtonText}>Skip for now</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );

  if (loading) {
    return (
      <ModalSafeArea style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#063F47" />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </ModalSafeArea>
    );
  }

  return (
    <GestureHandlerRootView style={styles.flexFill}>
      <View style={styles.container}>
        {renderWaitingScreen()}
        {renderTrackingScreen()}
        {renderOTPModal()}
        {renderRatingModal()}

        <LocationPicker
          visible={showLocationPicker}
          onClose={() => setShowLocationPicker(false)}
          onSelectLocation={handleLocationSelect}
          currentLocation={
            coords
              ? {
                  latitude: coords.latitude,
                  longitude: coords.longitude,
                  address: "Current Location",
                }
              : null
          }
        />

        <MapView
          ref={homeMapRef}
          style={StyleSheet.absoluteFillObject}
          provider={PROVIDER_GOOGLE}
          initialRegion={
            coords
              ? {
                  ...coords,
                  latitudeDelta: CLOSE_REGION_DELTA,
                  longitudeDelta: CLOSE_REGION_DELTA,
                }
              : DEFAULT_REGION
          }
          onMapReady={() => setHomeMapReady(true)}
          showsUserLocation={false}
          showsMyLocationButton={false}
          showsCompass={false}
        >
          {coords && <UserLocationMarker coordinate={coords} />}

          {mappableMechanics.map(({ mechanic, coordinate }) => (
            <Marker
              key={mechanic.id}
              coordinate={coordinate}
              pinColor={mechanic.is_online ? "#FC6B36" : "#94A3B8"}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 25,
                  backgroundColor: "rgba(252,107,54,0.15)",
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <View style={styles.homeMechanicMarker}>
                  <MaterialCommunityIcons
                    name="account-hard-hat"
                    size={20}
                    color="#FFF"
                  />
                </View>
              </View>
              <Callout>
                <View style={styles.calloutContainer}>
                  <Text style={styles.calloutName}>{mechanic.full_name}</Text>
                  <Text style={styles.calloutDistance}>
                    {mechanic.distance_km?.toFixed(1)} km away
                  </Text>
                </View>
              </Callout>
            </Marker>
          ))}
        </MapView>

        <TouchableOpacity
          style={styles.recenterButton}
          onPress={recenterOnMe}
          accessibilityLabel="Recenter on my location"
        >
          <Ionicons name="locate" size={20} color="#063F47" />
        </TouchableOpacity>

        <View style={[styles.homeHeaderSafeArea, { paddingTop: insets.top }]}>
          <View style={styles.greetingCard}>
            <TouchableOpacity
              style={styles.avatarCircle}
              onPress={() => router.push("/profile")}
              accessibilityLabel="Go to profile"
            >
              <Ionicons name="person" size={20} color="#FFF" />
            </TouchableOpacity>
            <View style={styles.greetingTextWrap}>
              <Text style={styles.greetingText} numberOfLines={1}>
                Hello, {user?.full_name?.split(" ")[0] || "there"}
              </Text>
            </View>

            {weatherLoading ? (
              <View style={styles.weatherPill}>
                <ActivityIndicator size="small" color="#F59E0B" />
              </View>
            ) : weatherTemp !== null && !weatherError ? (
              <View style={styles.weatherPill}>
                <Ionicons
                  name={weatherIconFor(weatherCode)}
                  size={15}
                  color="#F59E0B"
                />
                <Text style={styles.weatherText}>{weatherTemp}°</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={styles.notifBell}
              onPress={() =>
                Alert.alert("Notifications", "You're all caught up.")
              }
            >
              <Ionicons name="notifications-outline" size={20} color="#063F47" />
              <View style={styles.notifDot} />
            </TouchableOpacity>
          </View>
        </View>

        <BottomSheet
          ref={bottomSheetRef}
          index={0}
          snapPoints={sheetSnapPoints}
          topInset={110}
          backgroundStyle={styles.sheetBackground}
          handleIndicatorStyle={styles.sheetHandle}
        >
          <BottomSheetFlatList
            data={[]}
            keyExtractor={(_, index) => String(index)}
            contentContainerStyle={styles.sheetContent}
            refreshing={refreshing}
            onRefresh={onRefresh}
            showsVerticalScrollIndicator={false}
            renderItem={null}
            ListHeaderComponent={
              <View>
                <Text style={styles.searchLabel}>Where do you need help?</Text>
                <TouchableOpacity
                  style={styles.searchBar}
                  activeOpacity={0.7}
                  onPress={() => setShowLocationPicker(true)}
                >
                  <View style={styles.searchBarIconWrap}>
                    <Ionicons name="location" size={16} color="#FFF" />
                  </View>
                  <Text style={styles.searchInput} numberOfLines={1}>
                    {selectedLocation?.address ||
                      (coords ? "Current Location" : "Search a location")}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
                </TouchableOpacity>

                <View style={styles.vehicleHeadingRow}>
                  <Text style={styles.quickAccessHeading}>Choose a Service</Text>
                  <TouchableOpacity
                    onPress={() => setShowServiceListModal(true)}
                    disabled={services.length === 0}
                  >
                    <Text style={styles.viewAllText}>View All</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.serviceQuickAccessGrid}>
                  {quickAccessData.map((qa) => {
                    const isSelected =
                      qa.available && chosenService?.id === qa.service?.id;
                    const isDisabled =
                      !qa.available || creatingBooking || !!activeBooking;
                    const iconColor = !qa.available
                      ? "#94A3B8"
                      : isSelected
                      ? "#FFFFFF"
                      : "#063F47";
                    return (
                      <TouchableOpacity
                        key={qa.key}
                        style={styles.serviceQuickAccessItem}
                        onPress={() => handleQuickAccessPress(qa)}
                        disabled={isDisabled}
                        activeOpacity={qa.available ? 0.7 : 1}
                      >
                        <View
                          style={[
                            styles.serviceQuickAccessIconWrap,
                            isSelected && styles.serviceQuickAccessIconWrapActive,
                            !qa.available &&
                              styles.serviceQuickAccessIconWrapDisabled,
                          ]}
                        >
                          {qa.icon.lib === "FontAwesome5" ? (
                            <FontAwesome5
                              name={qa.icon.name}
                              size={16}
                              color={iconColor}
                            />
                          ) : qa.icon.lib === "MaterialCommunityIcons" ? (
                            <MaterialCommunityIcons
                              name={qa.icon.name as any}
                              size={20}
                              color={iconColor}
                            />
                          ) : (
                            <Ionicons
                              name={qa.icon.name as any}
                              size={20}
                              color={iconColor}
                            />
                          )}
                        </View>
                        <Text
                          style={[
                            styles.serviceQuickAccessLabel,
                            isSelected && styles.serviceQuickAccessLabelActive,
                            !qa.available &&
                              styles.serviceQuickAccessLabelDisabled,
                          ]}
                        >
                          {qa.label}
                        </Text>
                        {!qa.available && (
                          <Text style={styles.serviceQuickAccessUnavailableTag}>
                            Unavailable
                          </Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/*
                  ✅ Vehicle Type row. Hidden until a vehicle has been
                  chosen — the vehicle-type modal now opens automatically
                  the first time a service is selected (see
                  handleQuickAccessPress / handleServiceModalSelect), so
                  there's no need for an always-visible inline grid here
                  anymore. Once a vehicle is selected, this shows it as a
                  compact card; tapping the card or "View All" reopens the
                  same modal to change the selection.

                  ✅ FIX — the delete button inside the selected-vehicle
                  card now shows a dustbin (trash) icon instead of an ×
                  in a circle, so it reads clearly as "remove/delete"
                  rather than "close". Tapping it still clears BOTH the
                  vehicle AND the chosen service via
                  handleRemoveVehicleSelection().
                */}
                {selectedVehicle && (
                  <>
                    <View style={styles.vehicleHeadingRow}>
                      <Text style={styles.quickAccessHeading}>Vehicle Type</Text>
                      <TouchableOpacity
                        onPress={() => setShowVehicleListModal(true)}
                        disabled={vehicleTypesLoading || vehicleTypes.length === 0}
                      >
                        <Text style={styles.viewAllText}>View All</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.selectedVehicleCard}>
                      <TouchableOpacity
                        style={styles.selectedVehicleCardMain}
                        onPress={() => setShowVehicleListModal(true)}
                        activeOpacity={0.7}
                        disabled={creatingBooking || !!activeBooking}
                      >
                        <View
                          style={[
                            styles.quickAccessIconCircle,
                            styles.quickAccessIconCircleActive,
                            styles.selectedVehicleIconWrap,
                          ]}
                        >
                          {(() => {
                            const icon = iconForVehicleCategory(
                              selectedVehicle.category,
                            );
                            return icon.lib === "FontAwesome5" ? (
                              <FontAwesome5
                                name={icon.name}
                                size={20}
                                color="#EA580C"
                              />
                            ) : icon.lib === "MaterialCommunityIcons" ? (
                              <MaterialCommunityIcons
                                name={icon.name as any}
                                size={26}
                                color="#EA580C"
                              />
                            ) : (
                              <Ionicons
                                name={icon.name as any}
                                size={24}
                                color="#EA580C"
                              />
                            );
                          })()}
                        </View>
                        <View style={styles.selectedVehicleTextWrap}>
                          <Text style={styles.selectedVehicleName} numberOfLines={1}>
                            {selectedVehicle.name}
                          </Text>
                          <Text style={styles.selectedVehicleSub}>
                            Tap to change
                          </Text>
                        </View>
                        <Ionicons
                          name="chevron-forward"
                          size={18}
                          color="#94A3B8"
                        />
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.selectedVehicleDeleteButton}
                        onPress={handleRemoveVehicleSelection}
                        disabled={creatingBooking || !!activeBooking}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        accessibilityLabel="Remove selected vehicle and service"
                      >
                        <Ionicons name="trash-outline" size={20} color="#EF4444" />
                      </TouchableOpacity>
                    </View>
                  </>
                )}

                {recentBooking ? (
                  <View style={styles.recentBookingCard}>
                    <View style={styles.recentBookingIconWrap}>
                      <Ionicons name="time-outline" size={20} color="#10B981" />
                    </View>
                    <View style={styles.recentBookingTextWrap}>
                      <Text style={styles.recentBookingTitle} numberOfLines={1}>
                        {recentBookingServiceName} •{" "}
                        {formatTimeAgo(recentBooking.updated_at)}
                      </Text>
                      <Text style={styles.recentBookingSubtitle} numberOfLines={1}>
                        {recentBooking.mechanic?.full_name || "Mechanic"} • ₹
                        {recentBooking.amount ?? "-"}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.rebookButton}
                      onPress={() => handleRebook(recentBooking)}
                    >
                      <Text style={styles.rebookButtonText}>Rebook</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.noBookingCard}>
                    <View style={styles.noBookingIconWrap}>
                      <Ionicons name="shield-outline" size={20} color="#64748B" />
                    </View>
                    <View style={styles.noBookingTextWrap}>
                      <Text style={styles.noBookingTitle}>No active booking</Text>
                      <Text style={styles.noBookingSubtitle}>
                        Your recent bookings will appear here.
                      </Text>
                    </View>
                  </View>
                )}
              </View>
            }
          />
        </BottomSheet>

        <Modal
          visible={showServiceListModal}
          animationType="slide"
          transparent
          onRequestClose={() => setShowServiceListModal(false)}
        >
          <View style={styles.vehicleModalOverlay}>
            <View
              style={[
                styles.serviceModalContent,
                { paddingBottom: 16 + insets.bottom },
              ]}
            >
              <View style={styles.serviceModalHeader}>
                <Text style={styles.modalTitle}>Select a Service</Text>
              </View>

              <ScrollView
                style={styles.serviceModalScroll}
                contentContainerStyle={styles.serviceModalScrollContent}
                showsVerticalScrollIndicator={false}
              >
                {services.map((service) => {
                  const available = isServiceAvailable(service.name);
                  const isSelected = chosenService?.id === service.id;
                  const price =
                    servicePrices.get(service.name) ?? service.base_price;
                  const icon = iconForService(service.name);
                  const iconColor = !available
                    ? "#94A3B8"
                    : isSelected
                    ? "#FFFFFF"
                    : "#063F47";

                  return (
                    <TouchableOpacity
                      key={service.id}
                      style={[
                        styles.serviceListRow,
                        isSelected && styles.serviceListRowSelected,
                        !available && styles.serviceListRowDisabled,
                      ]}
                      onPress={() => handleServiceModalSelect(service)}
                      activeOpacity={available ? 0.7 : 1}
                    >
                      <View
                        style={[
                          styles.serviceListIconWrap,
                          isSelected && styles.serviceListIconWrapActive,
                          !available && styles.serviceListIconWrapDisabled,
                        ]}
                      >
                        {icon.lib === "FontAwesome5" ? (
                          <FontAwesome5
                            name={icon.name}
                            size={17}
                            color={iconColor}
                          />
                        ) : icon.lib === "MaterialCommunityIcons" ? (
                          <MaterialCommunityIcons
                            name={icon.name as any}
                            size={22}
                            color={iconColor}
                          />
                        ) : (
                          <Ionicons
                            name={icon.name as any}
                            size={20}
                            color={iconColor}
                          />
                        )}
                      </View>

                      <View style={styles.serviceListRowMiddle}>
                        <Text
                          style={[
                            styles.serviceListRowName,
                            !available && styles.serviceListRowNameDisabled,
                          ]}
                          numberOfLines={1}
                        >
                          {service.name}
                        </Text>
                        {!available && (
                          <Text style={styles.serviceQuickAccessUnavailableTag}>
                            Unavailable
                          </Text>
                        )}
                      </View>

                      {available && (
                        <Text style={styles.serviceListRowPrice}>
                          ₹{Math.round(price)}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
                {services.length === 0 && (
                  <Text style={styles.emptyServicesText}>
                    No services available right now.
                  </Text>
                )}
              </ScrollView>

              <TouchableOpacity
                style={styles.serviceModalCloseButton}
                onPress={() => setShowServiceListModal(false)}
              >
                <Text style={styles.modalCloseButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <Modal
          visible={showVehicleListModal}
          animationType="slide"
          transparent
          onRequestClose={() => setShowVehicleListModal(false)}
        >
          <View style={styles.vehicleModalOverlay}>
            <View style={[styles.vehicleModalContent, { maxHeight: "65%" }]}>
              <View style={[styles.modalHeader, { marginBottom: 16 }]}>
                <Text style={styles.modalTitle}>Select Vehicle Type</Text>
              </View>
              <ScrollView
                style={styles.vehicleModalScroll}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.vehicleModalGrid}>
                  {vehicleTypes.map((vt) => {
                    const isSelected = selectedVehicle?.id === vt.id;
                    const icon = iconForVehicleCategory(vt.category);
                    return (
                      <TouchableOpacity
                        key={vt.id}
                        style={styles.vehicleModalItem}
                        onPress={() => {
                          setShowVehicleListModal(false);
                          handleVehicleSelect(vt);
                        }}
                        disabled={creatingBooking || !!activeBooking}
                      >
                        <View
                          style={[
                            styles.quickAccessIconCircle,
                            isSelected && styles.quickAccessIconCircleActive,
                          ]}
                        >
                          {icon.lib === "FontAwesome5" ? (
                            <FontAwesome5
                              name={icon.name}
                              size={20}
                              color={isSelected ? "#EA580C" : "#063F47"}
                            />
                          ) : icon.lib === "MaterialCommunityIcons" ? (
                            <MaterialCommunityIcons
                              name={icon.name as any}
                              size={26}
                              color={isSelected ? "#EA580C" : "#063F47"}
                            />
                          ) : (
                            <Ionicons
                              name={icon.name as any}
                              size={24}
                              color={isSelected ? "#EA580C" : "#063F47"}
                            />
                          )}
                        </View>
                        <Text style={styles.quickAccessLabel} numberOfLines={2}>
                          {vt.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
              <TouchableOpacity
                style={[styles.modalCloseButton, { marginTop: 12 }]}
                onPress={() => setShowVehicleListModal(false)}
              >
                <Text style={styles.modalCloseButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flexFill: { flex: 1 },
  container: { flex: 1, backgroundColor: "#E2E8F0" },
  centerContent: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { marginTop: 12, fontSize: 14, color: "#64748B" },
  content: { padding: 16 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginTop: 10,
  },
  title: { fontSize: 28, fontWeight: "800", color: "#063F47" },
  subtitle: { fontSize: 14, color: "#475569", marginTop: 8, marginBottom: 4 },
  userInfo: { fontSize: 12, color: "#64748B", marginTop: 4 },
  logoutButton: { padding: 8 },
  logoutText: { color: "#EF4444", fontSize: 14, fontWeight: "600" },
  locationSelector: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  locationSelectorText: { flex: 1, marginLeft: 12 },
  locationSelectorLabel: { fontSize: 12, color: "#64748B", marginBottom: 2 },
  locationSelectorAddress: {
    fontSize: 14,
    color: "#063F47",
    fontWeight: "500",
  },
  input: {
    backgroundColor: "#FFF",
    borderRadius: 14,
    padding: 14,
    marginBottom: 18,
    minHeight: 80,
    textAlignVertical: "top",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#063F47",
    marginBottom: 12,
    marginTop: 8,
  },
  // ✅ FIX — column layout: map (flex:1, grows/shrinks to fill leftover
  // space) + card (auto height, capped by maxHeight below).
  waitingContainer: { flex: 1, backgroundColor: "#F8FAFC" },
  waitingHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#FFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  waitingCardHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  waitingHeaderTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
  },
  waitingHeaderTextWrap: {
    flexShrink: 1,
  },
  waitingHeaderIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#E7F1F2",
    borderWidth: 1,
    borderColor: "#BFDBDD",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  waitingHeaderTitle: { fontSize: 18, fontWeight: "700", color: "#063F47" },
  waitingHeaderSubtitle: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },
  waitingCancelButton: { padding: 8 },
  mapContainer: { height: height * 0.5, backgroundColor: "#E2E8F0" },
  // ✅ FIX — the waiting-screen map now flexes to fill whatever space the
  // (auto-sized) card below doesn't use, instead of a fixed height that
  // fought the card for room and either left a gap or caused overlap.
  mapContainerFull: { flex: 1 },
  // ✅ FIX — reduced from 0.38 → 0.30 of screen height. The info card
  // below (mechanic+call+ETA, vehicle, address, timeline, action button)
  // needs more room than the map now, so the map gives up space instead
  // of forcing the card to scroll to show everything.
  trackingMapContainer: { height: height * 0.3 },
  map: { flex: 1 },
  waitingRecenterButton: {
    position: "absolute",
    right: 12,
    bottom: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFF",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  userMarker: {
    backgroundColor: "#3B82F6",
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    borderColor: "#FFF",
  },
  mechanicMarker: {
    backgroundColor: "#10B981",
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#FFF",
  },
  mechanicMarkerPin: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 4,
  },
  mechanicMarkerPointer: {
    alignSelf: "center",
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 7,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    marginTop: -1,
  },
  radiusLegend: {
    position: "absolute",
    left: 12,
    bottom: 12,
    backgroundColor: "#FFF",
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
    gap: 6,
  },
  radiusLegendRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  radiusLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  radiusLegendText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#334155",
  },
  customerMarker: {
    backgroundColor: "#3B82F6",
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    borderColor: "#FFF",
  },
  calloutContainer: { padding: 8, minWidth: 120 },
  calloutName: { fontSize: 14, fontWeight: "700", color: "#063F47" },
  calloutDistance: { fontSize: 12, color: "#64748B", marginTop: 2 },
  calloutText: { fontSize: 12, fontWeight: "600", color: "#063F47" },
  // ✅ FIX — no longer `flex: 1`. The card now sizes itself to its content
  // (header + stats + notice + price row + button), so there's no empty
  // gap between the price row and the Cancel Search button. `maxHeight`
  // is a safety cap for small screens / long content — if content ever
  // exceeds it, the inner ScrollView (below) will scroll instead of
  // pushing the Cancel button off-screen.
  waitingStatusCard: {
    backgroundColor: "#FFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    marginTop: -20,
    maxHeight: height * 0.62,
  },
  // ✅ FIX — back to content-sized (flexGrow: 0 / flexShrink: 1) instead
  // of flex: 1, so it doesn't stretch to fill the card and leave a blank
  // gap above the Cancel Search button. It will only scroll internally
  // if its content is taller than the card's maxHeight allows.
  waitingScrollArea: {
    flexGrow: 0,
    flexShrink: 1,
  },
  waitingScrollContent: {
    paddingBottom: 4,
  },
  timerContainer: { alignItems: "center", marginBottom: 24 },
  timerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
  },
  timerRightCol: {
    flex: 1,
    marginLeft: 16,
    justifyContent: "center",
  },
  timerCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#F8FAFC",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2.5,
    borderColor: "#BFDBDD",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  timerText: {
    fontSize: 24,
    fontWeight: "800",
    color: "#063F47",
    fontFamily: "monospace",
  },
  timerSubLabel: {
    fontSize: 10,
    color: "#94A3B8",
    marginTop: -2,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  timerLabel: { fontSize: 14, color: "#64748B" },
  timerProgress: {
    width: "100%",
    height: 4,
    backgroundColor: "#E2E8F0",
    borderRadius: 2,
    marginTop: 12,
    overflow: "hidden",
  },
  noBookingCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginTop: 4,
    marginBottom: 16,
  },
  noBookingIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#E2E8F0",
    justifyContent: "center",
    alignItems: "center",
  },
  noBookingTextWrap: {
    flex: 1,
    marginLeft: 12,
  },
  noBookingTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#063F47",
  },
  noBookingSubtitle: {
    fontSize: 13,
    color: "#64748B",
    marginTop: 2,
    lineHeight: 18,
  },
  timerProgressFill: {
    height: "100%",
    backgroundColor: "#063F47",
    borderRadius: 2,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
  },
  statDivider: {
    width: 1,
    height: 36,
    backgroundColor: "#E2E8F0",
  },
  statIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#E7F1F2",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 6,
  },
  statValue: {
    fontSize: 16,
    fontWeight: "800",
    color: "#063F47",
  },
  statLabel: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
    fontWeight: "600",
  },
  expandNoticeRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#F8FAFC",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 12,
    marginTop: 4,
    marginBottom: 16,
    gap: 10,
  },
  expandNoticeTextWrap: { flex: 1 },
  expandNoticeTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#334155",
  },
  expandNoticeSubtitle: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
    lineHeight: 16,
  },
  cancelButtonOutlined: {
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderWidth: 1.5,
    borderColor: "#EF4444",
    paddingVertical: 14,
    borderRadius: 16,
    marginTop: 12,
  },
  cancelButtonOutlinedText: {
    color: "#EF4444",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  searchingContainer: { alignItems: "center", marginBottom: 24 },
  searchingCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E7F1F2",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#BFDBDD",
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  searchingText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#063F47",
    marginLeft: 8,
    flexShrink: 1,
  },
  searchingSubtext: { fontSize: 14, color: "#64748B", marginTop: 4 },
  serviceInfoBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E7F1F2",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#BFDBDD",
    padding: 12,
    marginBottom: 4,
  },
  serviceInfoIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#BFDBDD",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  serviceInfoTextWrap: { flex: 1 },
  serviceInfoTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#063F47",
  },
  serviceInfoNote: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },
  serviceInfoText: { fontSize: 13, color: "#64748B", marginTop: 4 },
  serviceInfoPrice: {
    fontSize: 15,
    fontWeight: "800",
    color: "#EA580C",
    marginLeft: 8,
    flexShrink: 0,
  },
  priceValue: {
    color: "#EA580C",
    fontWeight: "700",
  },
  cancelButton: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#EF4444",
    paddingVertical: 16,
    borderRadius: 16,
    shadowColor: "#EF4444",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 4,
  },
  cancelButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  trackingContainer: { flex: 1, backgroundColor: "#F8FAFC" },
  trackingHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 9,
    paddingHorizontal: 16,
    backgroundColor: "#FFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  trackingTitle: { fontSize: 15, fontWeight: "700", color: "#063F47" },
  trackingCancelButton: { padding: 6 },
  vehicleSelector: { marginBottom: 16 },
  // ✅ FIX — now flex:1 so it fills the remaining space below the fixed
  // header + map, with an internal ScrollView handling overflow instead
  // of the card growing past the screen.
  trackingInfoCard: {
    flex: 1,
    backgroundColor: "#FFF",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    marginTop: -18,
  },
  trackingInfoScroll: {
    flex: 1,
  },
  trackingInfoScrollContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  // ✅ Single merged "Mechanic + ETA" card. Top row = mechanic
  // avatar/name/rating/call button (same content/styles as before).
  // A thin divider separates it from the bottom "Arriving in ..." strip,
  // so both pieces of info live in ONE section instead of two stacked
  // cards.
  mechanicEtaCard: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  mechanicEtaTopRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  mechanicEtaDivider: {
    height: 1,
    backgroundColor: "#E2E8F0",
    marginVertical: 8,
  },
  mechanicEtaBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E7F1F2",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#BFDBDD",
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  etaTextWrap: { flexShrink: 1 },
  etaLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    color: "#3F7176",
  },
  etaValueText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#063F47",
    flexShrink: 0,
  },
  etaRing: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: "#063F47",
    borderRightColor: "#BFDBDD",
    borderBottomColor: "#BFDBDD",
    backgroundColor: "#FFF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  // ✅ Mechanic avatar / name / role / rating — shared by the merged
  // mechanicEtaCard above.
  mechanicAvatar2: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#063F47",
    justifyContent: "center",
    alignItems: "center",
  },
  mechanicTextWrap2: {
    flex: 1,
    marginLeft: 10,
  },
  mechanicNameText2: {
    fontSize: 13,
    fontWeight: "700",
    color: "#063F47",
  },
  mechanicRoleRatingRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  mechanicRoleText2: {
    fontSize: 11,
    color: "#64748B",
    fontWeight: "600",
  },
  mechanicRatingIcon: {
    marginLeft: 8,
    marginRight: 2,
  },
  mechanicRatingText: {
    fontSize: 11,
    color: "#334155",
    fontWeight: "700",
  },
  callButton2: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#E7F1F2",
    borderWidth: 1,
    borderColor: "#BFDBDD",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  // ✅ Dimmed state for the call button when no mechanic phone number is
  // available yet — button stays visible (never disappears) but reads
  // as inactive.
  callButton2Disabled: {
    backgroundColor: "#F1F5F9",
    borderColor: "#E2E8F0",
  },
  // ✅ Vehicle + service summary row.
  vehicleCard2: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF7ED",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#FDE1C2",
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  vehicleIconWrap2: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#FDE1C2",
    justifyContent: "center",
    alignItems: "center",
  },
  vehicleTextWrap2: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8,
  },
  vehicleNameText2: {
    fontSize: 13,
    fontWeight: "700",
    color: "#063F47",
  },
  vehicleSubText2: {
    fontSize: 11,
    color: "#94734B",
    marginTop: 1,
  },
  vehiclePriceText2: {
    fontSize: 14,
    fontWeight: "800",
    color: "#EA580C",
    flexShrink: 0,
  },
  addressRow2: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8,
    paddingHorizontal: 2,
    gap: 6,
  },
  addressText2: {
    flex: 1,
    fontSize: 12,
    color: "#64748B",
    lineHeight: 16,
  },
  // ✅ NEW — small inline "waiting for pin" strip shown on the tracking
  // screen while status is "arrived" but no OTP has been generated yet.
  // Replaces forcing the OTP modal open on arrival.
  awaitingOtpStrip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFBEB",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#FDE68A",
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
    gap: 10,
  },
  awaitingOtpStripText: {
    flex: 1,
    fontSize: 12,
    color: "#92400E",
    fontWeight: "600",
    lineHeight: 16,
  },
  // ✅ Vertical status timeline — dot + connecting line per step, with a
  // right-aligned timestamp column, matching the reference design's
  // "Request Confirmed / Expert Assigned / On the Way / ..." list.
  // Redesigned so label + timestamp sit on the SAME row as the dot
  // (timelineRightCol is a row, not a column with a big marginBottom),
  // which removes the large empty gaps between steps seen previously —
  // spacing between rows now comes only from timelineRightCol's
  // paddingBottom, so it can never disagree with the connecting line's
  // height.
  timelineCard: {
    backgroundColor: "#F8FAFC",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  timelineRow: {
    flexDirection: "row",
  },
  timelineLeftCol: {
    alignItems: "center",
    width: 22,
  },
  timelineDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#FFF",
    borderWidth: 2,
    borderColor: "#CBD5E1",
    justifyContent: "center",
    alignItems: "center",
  },
  timelineDotDone: {
    backgroundColor: "#10B981",
    borderColor: "#10B981",
  },
  timelineLine: {
    width: 2,
    flex: 1,
    minHeight: 16,
    backgroundColor: "#E2E8F0",
    marginVertical: 2,
  },
  timelineLineDone: {
    backgroundColor: "#10B981",
  },
  timelineRightCol: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginLeft: 10,
    paddingBottom: 10,
  },
  timelineRightColLast: {
    paddingBottom: 0,
  },
  timelineLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    color: "#94A3B8",
    marginRight: 8,
  },
  timelineLabelDone: {
    color: "#063F47",
    fontWeight: "700",
  },
  timelineTime: {
    fontSize: 11,
    color: "#94A3B8",
    fontWeight: "600",
    flexShrink: 0,
  },
  trackingInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  pricingInfoBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  pricingInfoText: { fontSize: 13, color: "#1E40AF", marginLeft: 8, flex: 1 },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEF3C7",
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  warningText: { fontSize: 13, color: "#92400E", marginLeft: 8, flex: 1 },
  trackingInfoLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#64748B",
    width: 80,
    marginLeft: 8,
  },
  trackingInfoValue: {
    fontSize: 14,
    fontWeight: "500",
    color: "#063F47",
    flex: 1,
  },
  statusValue: { color: "#10B981", fontWeight: "700" },
  etaValue: { color: "#F59E0B", fontWeight: "700" },
  routeErrorText: {
    fontSize: 11,
    color: "#EF4444",
    textAlign: "center",
    marginBottom: 10,
  },
  completeButton: {
    backgroundColor: "#10B981",
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
    marginBottom: 4,
  },
  completeButtonText: { color: "#FFF", fontSize: 14, fontWeight: "700" },
  cancelTrackingButton: {
    backgroundColor: "#FFF",
    borderWidth: 1.5,
    borderColor: "#EF4444",
    paddingVertical: 11,
    borderRadius: 14,
    alignItems: "center",
    marginBottom: 4,
  },
  cancelTrackingButtonText: { color: "#EF4444", fontSize: 13, fontWeight: "700" },
  loadingMapContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
  },
  loadingMapText: { marginTop: 12, fontSize: 14, color: "#64748B" },
  refreshLocationButton: {
    marginTop: 16,
    padding: 10,
    backgroundColor: "#063F47",
    borderRadius: 8,
  },
  refreshLocationText: { color: "#FFF", fontSize: 14, fontWeight: "600" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalScrollContent: { flexGrow: 1, justifyContent: "center", padding: 20 },
  modalContent: {
    backgroundColor: "#FFF",
    borderRadius: 20,
    padding: 24,
    width: "100%",
    maxWidth: 400,
    alignSelf: "center",
  },
  vehicleModalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  vehicleModalContent: {
    backgroundColor: "#FFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingTop: 24,
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === "ios" ? 34 : 20,
    width: "100%",
  },
  vehicleModalScroll: {
    flexGrow: 0,
  },
  serviceModalContent: {
    backgroundColor: "#FFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 24,
    paddingHorizontal: 20,
    width: "100%",
    height: "85%",
  },
  serviceModalHeader: {
    alignItems: "center",
    marginBottom: 16,
  },
  serviceModalScroll: {
    flex: 1,
  },
  serviceModalScrollContent: {
    paddingBottom: 12,
  },
  serviceModalCloseButton: {
    backgroundColor: "#063F47",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 12,
  },
  modalHeader: { alignItems: "center", marginBottom: 24 },
  modalTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#063F47",
    marginTop: 12,
    textAlign: "center",
  },
  modalSubtitle: {
    fontSize: 14,
    color: "#64748B",
    textAlign: "center",
    marginTop: 8,
  },
  otpInput: {
    backgroundColor: "#F1F5F9",
    borderRadius: 12,
    padding: 16,
    fontSize: 24,
    fontWeight: "600",
    letterSpacing: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 24,
  },
  ratingContainer: {
    flexDirection: "row",
    justifyContent: "center",
    marginBottom: 16,
  },
  starButton: { padding: 8 },
  ratingLabel: { alignItems: "center", marginBottom: 20 },
  ratingLabelText: { fontSize: 16, fontWeight: "600", color: "#063F47" },
  reviewInput: {
    backgroundColor: "#F1F5F9",
    borderRadius: 12,
    padding: 16,
    minHeight: 100,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    fontSize: 14,
  },
  modalButtons: { flexDirection: "row", gap: 12 },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  cancelModalButton: { backgroundColor: "#F1F5F9" },
  cancelModalButtonText: { color: "#64748B", fontSize: 16, fontWeight: "600" },
  verifyModalButton: { backgroundColor: "#10B981" },
  verifyModalButtonText: { color: "#FFF", fontSize: 16, fontWeight: "600" },
  submitRatingButton: {
    backgroundColor: "#063F47",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  serviceLocationMarker: {
    backgroundColor: "#3B82F6",
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    borderColor: "#FFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  calloutAddress: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
    maxWidth: 150,
  },
  customerOtpContainer: {
    backgroundColor: "#F0FDF4",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    marginBottom: 20,
  },
  customerOtpLabel: {
    fontSize: 14,
    color: "#047857",
    marginBottom: 12,
  },
  customerOtpDisplay: {
    fontSize: 48,
    fontWeight: "800",
    fontFamily: "monospace",
    letterSpacing: 8,
    color: "#10B981",
    marginBottom: 12,
  },
  customerOtpExpiry: {
    fontSize: 12,
    color: "#EF4444",
  },
  waitingForOtpContainer: {
    alignItems: "center",
    padding: 24,
    backgroundColor: "#F1F5F9",
    borderRadius: 16,
    marginBottom: 20,
  },
  waitingForOtpText: {
    fontSize: 14,
    color: "#64748B",
    marginTop: 12,
  },
  instructionContainer: {
    flexDirection: "row",
    backgroundColor: "#EFF6FF",
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    gap: 12,
  },
  instructionText: {
    fontSize: 13,
    color: "#1E40AF",
    flex: 1,
    lineHeight: 18,
  },
  modalCloseButton: {
    backgroundColor: "#063F47",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  modalCloseButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "600",
  },
  waitingForOtpSubtext: {
    fontSize: 12,
    color: "#94A3B8",
    marginTop: 8,
    textAlign: "center",
  },
  submitRatingButtonText: { color: "#FFF", fontSize: 16, fontWeight: "600" },
  skipButton: { paddingVertical: 12, alignItems: "center" },
  skipButtonText: { color: "#64748B", fontSize: 14 },
  disabledButton: { opacity: 0.6 },

  homeHeaderSafeArea: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  recenterButton: {
    position: "absolute",
    right: 16,
    bottom: "18%",
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FFF",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
  },
  greetingCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  avatarCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#063F47",
    justifyContent: "center",
    alignItems: "center",
  },
  greetingTextWrap: { flex: 1, marginLeft: 10 },
  greetingText: { fontSize: 15, fontWeight: "700", color: "#063F47" },
  weatherPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF7ED",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginRight: 8,
  },
  weatherText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#063F47",
    marginLeft: 4,
  },
  notifBell: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#F1F5F9",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 6,
  },
  notifDot: {
    position: "absolute",
    top: 7,
    right: 8,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#EA580C",
  },
homeMechanicMarker: {
  width: 40,
  height: 40,
  borderRadius: 20,

  backgroundColor: "#FC6B36",

  justifyContent: "center",
  alignItems: "center",

  borderWidth: 3,
  borderColor: "#FFFFFF",

  shadowColor: "#000",
  shadowOpacity: 0.2,
  shadowRadius: 8,
  shadowOffset: {
    width: 0,
    height: 4,
  },
  elevation: 8,
},

  sheetBackground: {
    backgroundColor: "#F8FAFC",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  sheetHandle: { backgroundColor: "#CBD5E1", width: 40 },
  sheetContent: { paddingHorizontal: 16, paddingBottom: 32 },
  searchLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748B",
    marginTop: 6,
    marginBottom: 8,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#EA580C",
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 20,
  },
  searchBarIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#EA580C",
    justifyContent: "center",
    alignItems: "center",
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 14,
    fontWeight: "600",
    color: "#063F47",
  },
  vehicleHeadingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
    marginBottom: 16,
  },
  viewAllText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#EA580C",
  },
  quickAccessHeading: {
    fontSize: 18,
    fontWeight: "800",
    color: "#063F47",
    marginTop: 4,
    marginBottom: 0,
  },
  quickAccessGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  quickAccessItem: {
    width: "23%",
    alignItems: "center",
    marginBottom: 20,
  },
  vehicleModalGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
  },
  vehicleModalItem: {
    width: "25%",
    alignItems: "center",
    marginBottom: 20,
  },
  quickAccessIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#F1F5F9",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  quickAccessIconCircleActive: {
    backgroundColor: "#FFF7ED",
    borderWidth: 1.5,
    borderColor: "#EA580C",
  },
  quickAccessLabel: {
    fontSize: 11,
    color: "#334155",
    textAlign: "center",
    fontWeight: "600",
  },
  serviceQuickAccessGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  serviceQuickAccessItem: {
    width: "23%",
    alignItems: "center",
    marginBottom: 20,
  },
  serviceQuickAccessIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 6,
    backgroundColor: "transparent",
  },
  serviceQuickAccessIconWrapActive: {
    backgroundColor: "#063F47",
  },
  serviceQuickAccessIconWrapDisabled: {
    backgroundColor: "#F1F5F9",
  },
  serviceQuickAccessLabel: {
    fontSize: 10,
    color: "#334155",
    textAlign: "center",
    fontWeight: "600",
    lineHeight: 13,
    minHeight: 13 * 3,
  },
  serviceQuickAccessLabelActive: {
    color: "#063F47",
    fontWeight: "800",
  },
  serviceQuickAccessLabelDisabled: {
    color: "#94A3B8",
  },
  serviceQuickAccessUnavailableTag: {
    fontSize: 9,
    fontWeight: "700",
    color: "#EF4444",
    marginTop: 3,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  serviceListRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  serviceListRowSelected: {
    backgroundColor: "#FFF7ED",
    borderColor: "#EA580C",
  },
  serviceListRowDisabled: {
    backgroundColor: "#F1F5F9",
    borderColor: "#E2E8F0",
  },
  serviceListIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "#EFF6F6",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  serviceListIconWrapActive: {
    backgroundColor: "#063F47",
  },
  serviceListIconWrapDisabled: {
    backgroundColor: "#E2E8F0",
  },
  serviceListRowMiddle: {
    flex: 1,
    justifyContent: "center",
    marginRight: 10,
  },
  serviceListRowName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#063F47",
  },
  serviceListRowNameDisabled: {
    color: "#94A3B8",
  },
  serviceListRowPrice: {
    fontSize: 15,
    fontWeight: "800",
    color: "#EA580C",
    flexShrink: 0,
  },
  emptyServicesText: {
    textAlign: "center",
    color: "#94A3B8",
    marginTop: 24,
    marginBottom: 8,
  },
  recentBookingCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginTop: 4,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  recentBookingIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#D1FAE5",
    justifyContent: "center",
    alignItems: "center",
  },
  recentBookingTextWrap: {
    flex: 1,
    marginLeft: 12,
    marginRight: 10,
  },
  recentBookingTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#063F47",
  },
  recentBookingSubtitle: {
    fontSize: 13,
    color: "#64748B",
    marginTop: 2,
  },
  rebookButton: {
    backgroundColor: "#FFEDD5",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  rebookButtonText: {
    color: "#EA580C",
    fontSize: 13,
    fontWeight: "700",
  },
  // ✅ Compact card shown under "Vehicle Type" once a vehicle has been
  // selected — tapping the main row (or "View All" above) reopens the
  // vehicle picker modal to change the selection. Now a row containing
  // the tappable "main" content plus a separate delete (dustbin) button,
  // so the two touch targets don't fight each other.
  selectedVehicleCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  // ✅ wraps the icon + name/subtitle + chevron; this is the part
  // that opens the vehicle picker modal on tap. Kept as its own flex
  // row so the delete button can sit outside it, at the end of the card.
  selectedVehicleCardMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  selectedVehicleIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginBottom: 0,
  },
  selectedVehicleTextWrap: {
    flex: 1,
    marginLeft: 12,
  },
  selectedVehicleName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#063F47",
  },
  selectedVehicleSub: {
    fontSize: 12,
    color: "#94A3B8",
    marginTop: 2,
  },
  // ✅ FIX — the delete/remove button on the selected-vehicle card. Now
  // rendered as a plain dustbin (trash) icon instead of a filled ×
  // circle, matching the "remove" affordance more clearly. Tapping it
  // calls handleRemoveVehicleSelection(), clearing both the vehicle and
  // the chosen service. Sits outside selectedVehicleCardMain so it has
  // its own touch target, separate from "tap to change".
  selectedVehicleDeleteButton: {
    marginLeft: 10,
    paddingLeft: 6,
    paddingVertical: 4,
    paddingRight: 2,
  },
});