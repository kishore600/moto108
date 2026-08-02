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
import MapView, { Marker, Callout, Circle, PROVIDER_GOOGLE } from "react-native-maps";
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
  category: string,
): { lib: "Ionicons" | "FontAwesome5" | "MaterialCommunityIcons"; name: string } {
  switch (category?.toLowerCase()) {
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

const MECHANIC_SEARCH_RADIUS_KM = 5;
const MECHANIC_INNER_RING_KM = 2;

const KM_PER_DEGREE_LAT = 111;
const WAITING_REGION_PADDING = 1.3;
const WAITING_REGION_DELTA =
  (MECHANIC_SEARCH_RADIUS_KM * 2 * WAITING_REGION_PADDING) / KM_PER_DEGREE_LAT;

const WAITING_REGION_DELTA_INNER =
  (MECHANIC_INNER_RING_KM * 2 * WAITING_REGION_PADDING) / KM_PER_DEGREE_LAT;

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

const { width, height } = Dimensions.get("window");
const GOOGLE_MAPS_API_KEY = process.env
  .EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string;

if (!GOOGLE_MAPS_API_KEY) {
  console.error("❌ GOOGLE_MAPS_API_KEY is missing! Check your .env file");
}

const OUTER_RIPPLE_DELAY_SEC = 45;
const INNER_RIPPLE_DURATION_MS = 2000;
const OUTER_RIPPLE_DURATION_MS = 2600;

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

  const innerRippleAnim = useRef(new Animated.Value(0)).current;
  const outerRippleAnim = useRef(new Animated.Value(0)).current;
  const [innerRippleRadius, setInnerRippleRadius] = useState(0);
  const [innerRippleOpacity, setInnerRippleOpacity] = useState(0);
  const [outerRippleRadius, setOuterRippleRadius] = useState(0);
  const [outerRippleOpacity, setOuterRippleOpacity] = useState(0);
  const [showOuterRipple, setShowOuterRipple] = useState(false);

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

  const sheetSnapPoints = useMemo(() => ["43%", "70%", "80%"], []);
  const locationUpdateInterval = useRef<any>(null);
  const routeRetryCount = useRef(0);

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

  const fetchBookingOTP = async (bookingId: string) => {
    try {
      const response = await api.get(`/bookings/${bookingId}`);
      if (response.data) {
        if (response.data.completion_otp) {
          setCustomerOtp(response.data.completion_otp);
          setOtpExpiry(response.data.otp_expires_at ? new Date(response.data.otp_expires_at) : null);
          setIsWaitingForOtp(false);
        } else {
          setIsWaitingForOtp(true);
          setCustomerOtp(null);
          setTimeout(() => fetchBookingOTP(bookingId), 5000);
        }
      }
    } catch (error) {
      console.error("Failed to fetch booking OTP:", error);
    }
  };

  const showRatingFlow = useCallback((bookingId: string) => {
    setCompletedBookingId(bookingId);
    setShowRatingModal(true);
    setActiveBooking(null);
    setIsTracking(false);
    setCurrentTrackingModal(null);
  }, []);

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

      Alert.alert(
        "✓ Request Accepted!",
        `${data.mechanic.full_name} has accepted your request. Tracking their location now.`,
        [{ text: "OK" }],
      );

      startTrackingMechanic(data.booking);
    };

    const handleStatusUpdated = (updatedBooking: Booking) => {
      console.log("Booking status updated:", updatedBooking);
      const current = activeBookingRef.current;
      if (!current || updatedBooking?.id !== current.id) return;

      setActiveBooking(updatedBooking);

      if (updatedBooking.mechanic?.full_name) {
        setMechanicName(updatedBooking.mechanic.full_name);
      }

      if (updatedBooking.status === "on_the_way") {
        Alert.alert("🚗 Mechanic On The Way!");
        setCurrentTrackingModal("tracking");
        setIsTracking(true);
        socketService.requestMechanicLocation(updatedBooking.id);
      } else if (updatedBooking.status === "arrived") {
        Alert.alert(
          "📍 Mechanic Arrived",
          "Your mechanic has arrived. Please ask them for the OTP code to complete the service.",
        );
        setShowOTPModal(true);
        setCurrentTrackingModal("tracking");
      } else if (updatedBooking.status === "completed") {
        Alert.alert(
          "✅ Service Completed",
          "Thank you for using our service! Please rate your experience.",
        );
        setCompletedBookingId(updatedBooking?.id);
        setShowRatingModal(true);
        setIsTracking(false);
        setCurrentTrackingModal(null);
      } else if (updatedBooking.status === "cancelled") {
        Alert.alert("❌ Request Cancelled", "Your request has been cancelled.");
        setActiveBooking(null);
        setWaitingForMechanic(false);
        setIsTracking(false);
        setCurrentTrackingModal(null);
        loadBookings();
      }
    };

    const handleServiceCompleted = (data: { bookingId: string }) => {
      const current = activeBookingRef.current;
      if (!current || data.bookingId !== current.id) return;

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
              setActiveBooking(null);
              setIsTracking(false);
              setCurrentTrackingModal(null);
            },
          },
        ],
      );
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
    socketService.on("mechanic:location:update", handleMechanicLocationUpdate);

    return () => {
      socketService.off("booking:accepted", handleBookingAccepted);
      socketService.off("booking:status:updated", handleStatusUpdated);
      socketService.off("service:completed", handleServiceCompleted);
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
  }, []);

  useEffect(() => {
    if (activeBooking?.id) {
      socketService.joinBookingRoom(activeBooking.id);
      socketService.requestMechanicLocation(activeBooking.id);
    }
  }, [activeBooking?.id]);

  useEffect(() => {
    if (activeBooking?.status === "arrived" && activeBooking?.id) {
      fetchBookingOTP(activeBooking.id);
      setShowOTPModal(true);
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
        }
      },
    );
    return () => subscription.remove();
  }, []);

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

  useEffect(() => {
    if (currentTrackingModal !== "waiting") {
      setShowOuterRipple(false);
      return;
    }
    if (timeRemaining <= 120 - OUTER_RIPPLE_DELAY_SEC) {
      setShowOuterRipple(true);
    }
  }, [timeRemaining, currentTrackingModal]);

  useEffect(() => {
    if (!showOuterRipple) return;

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
      setOuterRippleRadius(MECHANIC_SEARCH_RADIUS_KM * 1000 * value);
      setOuterRippleOpacity(1 - value);
    });

    return () => {
      loop.stop();
      outerRippleAnim.removeListener(listenerId);
      setOuterRippleRadius(0);
      setOuterRippleOpacity(0);
    };
  }, [showOuterRipple]);

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
    const delta = showOuterRipple ? WAITING_REGION_DELTA : WAITING_REGION_DELTA_INNER;
    waitingMapRef.current?.animateToRegion(
      {
        ...coords,
        latitudeDelta: delta,
        longitudeDelta: delta,
      },
      400,
    );
  }, [
    coords?.latitude,
    coords?.longitude,
    waitingMapReady,
    currentTrackingModal,
    nearbyMechanics.length,
    showOuterRipple,
  ]);

  const recenterOnMe = useCallback(async () => {
    await fetchCurrentLocation();
  }, []);

  const recenterWaitingMap = useCallback(() => {
    if (!coords) return;
    const delta = showOuterRipple ? WAITING_REGION_DELTA : WAITING_REGION_DELTA_INNER;
    waitingMapRef.current?.animateToRegion(
      {
        ...coords,
        latitudeDelta: delta,
        longitudeDelta: delta,
      },
      400,
    );
  }, [coords, showOuterRipple]);

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

  const visibleWaitingMechanics = useMemo(() => {
    if (showOuterRipple || !coords) return mappableMechanics;
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
      return distanceKm <= MECHANIC_INNER_RING_KM;
    });
  }, [mappableMechanics, showOuterRipple, coords]);

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
      setChosenService((prev) =>
        prev?.id === qa.service!.id ? null : qa.service!,
      );
    },
    [],
  );

  const handleServiceModalSelect = useCallback((service: ServiceItem) => {
    if (!isServiceAvailable(service.name)) {
      Alert.alert(
        "Service Unavailable",
        `${service.name} isn't available for booking right now.`,
      );
      return;
    }
    setChosenService((prev) => (prev?.id === service.id ? null : service));
    setShowServiceListModal(false);
  }, []);

  // ---------------------------------------------------------------------
  // ✅ FIX — vehicle selection now TOGGLES. Tapping the already-selected
  // vehicle again deselects it (sets selectedVehicle back to null), same
  // pattern as service selection (handleQuickAccessPress /
  // handleServiceModalSelect above). Tapping a different vehicle still
  // requires a location first, same as before.
  // ---------------------------------------------------------------------
  const handleVehicleSelect = useCallback(
    (vt: VehicleType) => {
      // Tapping the already-selected vehicle again unselects it.
      if (selectedVehicle?.id === vt.id) {
        setSelectedVehicle(null);
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

          if (active.status === "arrived") {
            setShowOTPModal(true);
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
        socketService.emitOtpVerified(activeBookingRef.current?.id);
        setShowOTPModal(false);
        setOtpCode("");

        Alert.alert(
          "✓ Service Completed!",
          "Thank you for using our service! Please rate your experience.",
          [
            {
              text: "Rate Now",
              onPress: () => showRatingFlow(activeBookingRef.current?.id),
            },
            {
              text: "Skip",
              style: "cancel",
              onPress: () => {
                setCompletedBookingId(null);
                setShowRatingModal(false);
                setActiveBooking(null);
                setIsTracking(false);
                setCurrentTrackingModal(null);
              },
            },
          ],
        );

        setActiveBooking((prev: any) => ({ ...prev, status: "completed" }));
        setIsTracking(false);
        setCurrentTrackingModal(null);
        await loadBookings();
      }
    } catch (error: any) {
      console.error("OTP verification error:", error);
      Alert.alert(
        "Verification Failed",
        error.response?.data?.error || "Invalid OTP. Please try again.",
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
        error.response?.data?.error || "Failed to submit rating",
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
          const delta = showOuterRipple
            ? WAITING_REGION_DELTA
            : WAITING_REGION_DELTA_INNER;
          waitingMapRef.current?.animateToRegion(
            {
              ...coords,
              latitudeDelta: delta,
              longitudeDelta: delta,
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
                {showOuterRipple && (
                  <Circle
                    center={coords}
                    radius={MECHANIC_SEARCH_RADIUS_KM * 1000}
                    strokeWidth={1.5}
                    strokeColor="rgba(217, 119, 6, 0.55)"
                    fillColor="rgba(251, 191, 36, 0.08)"
                  />
                )}
                <Circle
                  center={coords}
                  radius={MECHANIC_INNER_RING_KM * 1000}
                  strokeWidth={1.5}
                  strokeColor="rgba(6, 63, 71, 0.6)"
                  fillColor="rgba(6, 63, 71, 0.12)"
                />

                {innerRippleOpacity > 0 && (
                  <Circle
                    center={coords}
                    radius={innerRippleRadius}
                    strokeWidth={2}
                    strokeColor={`rgba(6, 63, 71, ${innerRippleOpacity * 0.8})`}
                    fillColor={`rgba(6, 63, 71, ${innerRippleOpacity * 0.18})`}
                  />
                )}

                {showOuterRipple && outerRippleOpacity > 0 && (
                  <Circle
                    center={coords}
                    radius={outerRippleRadius}
                    strokeWidth={2}
                    strokeColor={`rgba(217, 119, 6, ${outerRippleOpacity * 0.8})`}
                    fillColor={`rgba(217, 119, 6, ${outerRippleOpacity * 0.15})`}
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
                            ? "#FC6B36"
                            : "#94A3B8",
                          borderColor: mechanic.is_online
                            ? "#FFD9C7"
                            : "#E2E8F0",
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
                            ? "#FC6B36"
                            : "#94A3B8",
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
                    style={[styles.radiusLegendDot, { backgroundColor: "#063F47" }]}
                  />
                  <Text style={styles.radiusLegendText}>
                    {MECHANIC_INNER_RING_KM} km
                  </Text>
                </View>
                {showOuterRipple && (
                  <View style={styles.radiusLegendRow}>
                    <View
                      style={[styles.radiusLegendDot, { backgroundColor: "#D97706" }]}
                    />
                    <Text style={styles.radiusLegendText}>
                      {MECHANIC_SEARCH_RADIUS_KM} km
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
                    {showOuterRipple
                      ? `Searching for available mechanics within ${MECHANIC_SEARCH_RADIUS_KM}km`
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
                    {showOuterRipple ? MECHANIC_SEARCH_RADIUS_KM : MECHANIC_INNER_RING_KM} km
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
                    {showOuterRipple
                      ? `Searching within ${MECHANIC_SEARCH_RADIUS_KM}km radius`
                      : `No mechanic found in ${MECHANIC_INNER_RING_KM}km?`}
                  </Text>
                  {!showOuterRipple && (
                    <Text style={styles.expandNoticeSubtitle}>
                      We'll automatically expand to {MECHANIC_SEARCH_RADIUS_KM}km radius.
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

    const canShowDirections =
      GOOGLE_MAPS_API_KEY &&
      GOOGLE_MAPS_API_KEY !== "your_api_key_here" &&
      GOOGLE_MAPS_API_KEY.length > 10;

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
                <Ionicons name="close" size={24} color="#EF4444" />
              </TouchableOpacity>
            </View>

            <View style={styles.mapContainer}>
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
                  <Marker coordinate={destination} pinColor="#3B82F6">
                    <View style={styles.serviceLocationMarker}>
                      <Ionicons name="location" size={20} color="#FFF" />
                    </View>
                    <Callout>
                      <Text style={styles.calloutText}>Service Location</Text>
                      {serviceLocation?.address ? (
                        <Text style={styles.calloutAddress}>
                          {serviceLocation.address}
                        </Text>
                      ) : null}
                    </Callout>
                  </Marker>

                  <Marker coordinate={mechanicLocation} pinColor="#F59E0B">
                    <View style={styles.trackingMechanicMarker}>
                      <Ionicons name="car" size={20} color="#FFF" />
                    </View>
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

            <View
              style={[
                styles.trackingInfoCard,
                {
                  paddingBottom:
                    Math.max(20, insets.bottom + 20) +
                    (Platform.OS === "android" ? 24 : 0),
                },
              ]}
            >
              <View style={styles.trackingInfoRow}>
                <Ionicons name="location" size={20} color="#64748B" />
                <Text style={styles.trackingInfoLabel}>Service Location:</Text>
                <Text style={styles.trackingInfoValue} numberOfLines={1}>
                  {serviceLocation?.address || "Service Location"}
                </Text>
              </View>

              <View style={styles.trackingInfoRow}>
                <Ionicons name="person" size={20} color="#64748B" />
                <Text style={styles.trackingInfoLabel}>Mechanic:</Text>
                <Text style={styles.trackingInfoValue}>
                  {displayMechanicName}
                </Text>
              </View>

              <View style={styles.trackingInfoRow}>
                <Ionicons name="time" size={20} color="#64748B" />
                <Text style={styles.trackingInfoLabel}>Status:</Text>
                <Text style={[styles.trackingInfoValue, styles.statusValue]}>
                  {activeBooking.status?.replace("_", " ").toUpperCase()}
                </Text>
              </View>

              {routeInfo && routeInfo.duration > 0 ? (
                <>
                  <View style={styles.trackingInfoRow}>
                    <Ionicons name="car" size={20} color="#64748B" />
                    <Text style={styles.trackingInfoLabel}>ETA:</Text>
                    <Text style={[styles.trackingInfoValue, styles.etaValue]}>
                      {routeInfo.durationText}
                    </Text>
                  </View>
                  <View style={styles.trackingInfoRow}>
                    <Ionicons name="navigate" size={20} color="#64748B" />
                    <Text style={styles.trackingInfoLabel}>Distance:</Text>
                    <Text style={styles.trackingInfoValue}>
                      {routeInfo.distanceText}
                    </Text>
                  </View>
                </>
              ) : distance !== null && distance > 0 ? (
                <>
                  <View style={styles.trackingInfoRow}>
                    <Ionicons name="location" size={20} color="#64748B" />
                    <Text style={styles.trackingInfoLabel}>Distance:</Text>
                    <Text style={styles.trackingInfoValue}>
                      {distance < 1
                        ? `${Math.round(distance * 1000)}m`
                        : `${distance.toFixed(1)}km`}
                    </Text>
                  </View>
                  <View style={styles.trackingInfoRow}>
                    <Ionicons name="car" size={20} color="#64748B" />
                    <Text style={styles.trackingInfoLabel}>Est. ETA:</Text>
                    <Text style={styles.trackingInfoValue}>
                      {distance < 1
                        ? "2-3 min"
                        : `~${Math.round(distance * 2)} min`}
                    </Text>
                  </View>
                  {routeError ? (
                    <Text style={styles.routeErrorText}>
                      Using estimated ETA (GPS only)
                    </Text>
                  ) : null}
                </>
              ) : (
                <View style={styles.trackingInfoRow}>
                  <ActivityIndicator size="small" color="#64748B" />
                  <Text style={styles.trackingInfoLabel}>
                    Calculating route...
                  </Text>
                </View>
              )}

              {/* ✅ Price of the service being tracked */}
              {selectedServicePrice != null && (
                <View style={styles.trackingInfoRow}>
                  <Ionicons name="pricetag" size={20} color="#64748B" />
                  <Text style={styles.trackingInfoLabel}>Price:</Text>
                  <Text style={[styles.trackingInfoValue, styles.priceValue]}>
                    ₹{Math.round(selectedServicePrice)}
                  </Text>
                </View>
              )}

              {activeBooking.status === "arrived" && (
                <TouchableOpacity
                  style={styles.completeButton}
                  onPress={() => setShowOTPModal(true)}
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
                  <Text style={styles.quickAccessHeading}>Quick Access</Text>
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

                <View style={styles.vehicleHeadingRow}>
                  <Text style={styles.quickAccessHeading}>Vehicle Type</Text>
                  <TouchableOpacity
                    onPress={() => setShowVehicleListModal(true)}
                    disabled={vehicleTypesLoading || vehicleTypes.length === 0}
                  >
                    <Text style={styles.viewAllText}>View All</Text>
                  </TouchableOpacity>
                </View>

                {vehicleTypesLoading ? (
                  <ActivityIndicator
                    size="small"
                    color="#063F47"
                    style={{ marginBottom: 16 }}
                  />
                ) : (
                  <View style={styles.quickAccessGrid}>
                    {vehicleTypes.slice(0, 4).map((vt) => {
                      const isSelected = selectedVehicle?.id === vt.id;
                      const icon = iconForVehicleCategory(vt.category);
                      return (
                        <TouchableOpacity
                          key={vt.id}
                          style={styles.quickAccessItem}
                          onPress={() => handleVehicleSelect(vt)}
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
  trackingMechanicMarker: {
    backgroundColor: "#F59E0B",
    width: 44,
    height: 44,
    borderRadius: 22,
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
    padding: 16,
    backgroundColor: "#FFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  trackingTitle: { fontSize: 18, fontWeight: "700", color: "#063F47" },
  trackingCancelButton: { padding: 8 },
  vehicleSelector: { marginBottom: 16 },
  trackingInfoCard: {
    backgroundColor: "#FFF",
    padding: 20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -20,
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
    fontSize: 12,
    color: "#EF4444",
    textAlign: "center",
    marginTop: 8,
  },
  completeButton: {
    backgroundColor: "#10B981",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 16,
  },
  completeButtonText: { color: "#FFF", fontSize: 16, fontWeight: "700" },
  cancelTrackingButton: {
    backgroundColor: "#EF4444",
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 12,
  },
  cancelTrackingButtonText: { color: "#FFF", fontSize: 14, fontWeight: "600" },
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
});