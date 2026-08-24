/* eslint-disable react/no-unescaped-entities */
import { useEffect, useState, useCallback, useRef } from "react";
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  ScrollView,
  Platform,
  Linking,
  Vibration,
  Switch,
  StatusBar,
  Dimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";
import MapView, { Marker, Callout, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import MapViewDirections from "react-native-maps-directions";
import { api } from "@/lib/api";
import { Booking } from "@/types";
import { useAuth } from "@/context/AuthContext";
import { router } from "expo-router";
import { socket, socketService } from "@/lib/socket";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import { UserLocationMarker } from "@/app/Userlocationpin";

// ==========================================================================
// Palette (use ONLY these five colors throughout the screen)
// ==========================================================================
const COLORS = {
  dark: "#063F47",   // primary text, headers, dark surfaces
  muted: "#64748B",  // secondary text, muted icons, inactive states
  accent: "#EA580C", // CTAs, active states, highlights, ratings
  tint: "#FFEDD5",   // light chip/badge/card backgrounds, subtle borders
  white: "#FFFFFF",
};

// ==========================================================================
// Google Directions / map constants — mirrors tabs/customer.tsx so the
// "On The Way" tracking screen here uses the EXACT same marker styles,
// route-drawing logic, and API key handling as the customer app.
// ==========================================================================
const { height } = Dimensions.get("window");
const GOOGLE_MAPS_API_KEY = process.env
  .EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string;

// ✅ Same mechanic pin colors used in tabs/customer.tsx — the hard-hat
// marker on THIS mechanic's own tracking map now matches the hard-hat
// marker the customer sees for this same mechanic elsewhere in the app.
const MECHANIC_PIN_ONLINE = { bg: "#FC6B36", border: "#FFD9C7" };
const MECHANIC_PIN_OFFLINE = { bg: "#94A3B8", border: "#E2E8F0" };

// ==========================================================================
// Types
// ==========================================================================
interface Service {
  id: string;
  name: string;
  description: string;
  base_price: number;
  category: string;
  estimated_duration: number;
}

interface MechanicProfile {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  avatar_url?: string;
  vehicle_type: string;
  license_number: string;
  experience_years: number;
  bio: string;
  services_offered: string[];
  custom_prices: Record<string, number>;
  is_verified: boolean;
  rating: number;
  total_jobs: number;
  completion_rate: number;
}

interface ServiceStats {
  service_id: string;
  service_name: string;
  total_completed: number;
  total_earnings: number;
  avg_rating: number;
}

type MainTab = "home" | "bookings" | "earnings" | "profile";
type BookingsSubTab = "available" | "myJobs" | "completed";

const ACTIVE_STATUSES = ["accepted", "on_the_way", "arrived"];
const INCOMING_REQUEST_TIMEOUT = 30; // seconds, mirrors Ola/Rapido style auto-expiry

// ==========================================================================
// Helpers
// ==========================================================================
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

function greetingForNow(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function MechanicDashboard() {
  // ------------------------------------------------------------------
  // Safe area (handles iOS notch AND Android's on-screen nav bar so our
  // custom bottom tab bar never sits underneath the system buttons)
  // ------------------------------------------------------------------
  const insets = useSafeAreaInsets();

  // ------------------------------------------------------------------
  // Core job / status state
  // ------------------------------------------------------------------
  const [jobs, setJobs] = useState<Booking[]>([]);
  const [myJobs, setMyJobs] = useState<Booking[]>([]);
  const [online, setOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [activeTab, setActiveTab] = useState<MainTab>("home");
  const [bookingsSubTab, setBookingsSubTab] = useState<BookingsSubTab>("available");

  const [currentLocation, setCurrentLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<any | null>(null);
  const [showAcceptModal, setShowAcceptModal] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const { user, logout } = useAuth();

  // ------------------------------------------------------------------
  // Ola/Rapido-style incoming request popup
  // ------------------------------------------------------------------
  const [incomingRequest, setIncomingRequest] = useState<any | null>(null);
  const [incomingCountdown, setIncomingCountdown] = useState(INCOMING_REQUEST_TIMEOUT);
  const incomingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ------------------------------------------------------------------
  // OTP / completion flow
  // ------------------------------------------------------------------
  const [showOTPModal, setShowOTPModal] = useState(false);
  const [generatedOTP, setGeneratedOTP] = useState("");
  const [otpBookingId, setOtpBookingId] = useState<string | null>(null);
  const [otpGenerating, setOtpGenerating] = useState(false);
  const [enteredOTP, setEnteredOTP] = useState("");
  const [verifyingOTP, setVerifyingOTP] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [customerRating, setCustomerRating] = useState(0);
  const [customerReview, setCustomerReview] = useState("");
  const [selectedCompletedBooking, setSelectedCompletedBooking] = useState<any>(null);
  const [showRatingsDetailModal, setShowRatingsDetailModal] = useState(false);
  const [selectedRatingsBooking, setSelectedRatingsBooking] = useState<any>(null);

  // ------------------------------------------------------------------
  // "On The Way" in-app tracking screen (map + ETA + Reached Location)
  // ------------------------------------------------------------------
  const [showTrackingModal, setShowTrackingModal] = useState(false);
  const [trackingBooking, setTrackingBooking] = useState<any | null>(null);
  const [routeInfo, setRouteInfo] = useState<{
    distance: number;
    duration: number;
    distanceText: string;
    durationText: string;
  } | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [markingArrived, setMarkingArrived] = useState(false);
  const trackingMapRef = useRef<MapView>(null);
  const routeRetryCount = useRef(0);

  // ------------------------------------------------------------------
  // Earnings / analytics
  // ------------------------------------------------------------------
  const [todayEarnings, setTodayEarnings] = useState(0);
  const [todaysJobsCount, setTodaysJobsCount] = useState(0);
  const [weeklyEarnings, setWeeklyEarnings] = useState(0);
  const [monthlyEarnings, setMonthlyEarnings] = useState(0);
  const [totalJobsCompleted, setTotalJobsCompleted] = useState(0);
  const [serviceStats, setServiceStats] = useState<ServiceStats[]>([]);
  const [activeBooking, setActiveBooking] = useState<any | null>(null);

  // Last-7-days earnings, used to draw the real "Today's Earnings" bar graph
  // on the Home tab (one bar per day, scaled to that day's actual amount).
  const [weeklyTrend, setWeeklyTrend] = useState<
    { label: string; amount: number; isToday: boolean }[]
  >([]);
  const [trendLoading, setTrendLoading] = useState(true);

  // ------------------------------------------------------------------
  // Profile
  // ------------------------------------------------------------------
  const [mechanicProfile, setMechanicProfile] = useState<MechanicProfile | null>(null);
  const [availableServices, setAvailableServices] = useState<Service[]>([]);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [customPrices, setCustomPrices] = useState<Record<string, string>>({});
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({
    full_name: "",
    phone: "",
    vehicle_type: "",
    license_number: "",
    experience_years: "",
    bio: "",
  });

  // Sound related state
  const soundRef = useRef<Audio.Sound | null>(null);

  // ==========================================================================
  // Sound
  // ==========================================================================
  const playBeepSound = async () => {
    try {
      if (soundRef.current) {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }

      if (Platform.OS === "web") {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = 800;
        gainNode.gain.value = 0.3;

        oscillator.start();
        gainNode.gain.exponentialRampToValueAtTime(0.00001, audioContext.currentTime + 0.5);
        oscillator.stop(audioContext.currentTime + 0.5);
      } else {
        try {
          const { sound } = await Audio.Sound.createAsync(
            require("@/assets/ring.mp3"),
            { shouldPlay: true, volume: 1.0, isLooping: false },
          );
          soundRef.current = sound;
          await sound.playAsync();

          sound.setOnPlaybackStatusUpdate(async (status) => {
            if (status.isLoaded && status.didJustFinish) {
              await sound.unloadAsync();
              soundRef.current = null;
            }
          });
        } catch (fileError) {
          console.log("Sound file not found, using vibration fallback");
          Vibration.vibrate([500, 300, 500, 300, 1000]);

          await Audio.setAudioModeAsync({
            playsInSilentModeIOS: true,
            staysActiveInBackground: true,
            shouldDuckAndroid: true,
          });
        }
      }

      Vibration.vibrate([500, 300, 500]);
    } catch (error) {
      console.error("Failed to play beep sound:", error);
      Vibration.vibrate([500, 300, 500]);
    }
  };

  const stopBeepSound = async () => {
    try {
      if (soundRef.current) {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      Vibration.cancel();
    } catch (error) {
      console.error("Failed to stop sound:", error);
    }
  };

  useEffect(() => {
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
      Vibration.cancel();
    };
  }, []);

  // ==========================================================================
  // Distance / ETA
  // ==========================================================================
  function calculateETA(
    mechanicLat: number,
    mechanicLng: number,
    customerLat: number,
    customerLng: number,
  ): number {
    const distance = calculateDistance(mechanicLat, mechanicLng, customerLat, customerLng);
    const etaMinutes = Math.ceil((distance / 30) * 60);
    return Math.min(etaMinutes, 30);
  }

  // ==========================================================================
  // Earnings / analytics fetchers
  // ==========================================================================
  async function fetchTodayEarnings() {
    try {
      const today = new Date().toISOString().split("T")[0];
      const { data } = await api.get(`/bookings/mechanic/${user?.id}/earnings`, {
        params: { date: today },
      });
      setTodayEarnings(data.total || 0);
      setTodaysJobsCount(data.count || 0);
    } catch (error) {
      console.error("Failed to fetch today's earnings:", error);
    }
  }

  async function fetchAnalytics() {
    try {
      const { data } = await api.get(`/mechanics/${user?.id}/analytics`);
      setWeeklyEarnings(data.weekly_earnings || 0);
      setMonthlyEarnings(data.monthly_earnings || 0);
      setTotalJobsCompleted(data.total_jobs || 0);
      setServiceStats(data.service_stats || []);
    } catch (error) {
      console.error("Failed to fetch analytics:", error);
    }
  }

  // Pulls the mechanic's real per-day earnings for the last 7 days (today
  // included) so the "Today's Earnings" bar graph on Home reflects actual
  // data instead of a static placeholder shape. Reuses the same
  // `/bookings/mechanic/:id/earnings?date=YYYY-MM-DD` endpoint that
  // fetchTodayEarnings() already calls, just once per day in the window.
  async function fetchWeeklyEarningsTrend() {
    if (!user?.id) return;
    setTrendLoading(true);
    try {
      const dayLabels = ["S", "M", "T", "W", "T", "F", "S"];
      const today = new Date();

      const results = await Promise.all(
        Array.from({ length: 7 }).map((_, i) => {
          const d = new Date(today);
          d.setDate(today.getDate() - (6 - i));
          const dateStr = d.toISOString().split("T")[0];
          return api
            .get(`/bookings/mechanic/${user.id}/earnings`, { params: { date: dateStr } })
            .then((res) => ({ date: d, total: res.data?.total || 0 }))
            .catch(() => ({ date: d, total: 0 }));
        }),
      );

      const trend = results.map(({ date, total }) => ({
        label: dayLabels[date.getDay()],
        amount: total,
        isToday: date.toDateString() === today.toDateString(),
      }));

      setWeeklyTrend(trend);
    } catch (error) {
      console.error("Failed to fetch weekly earnings trend:", error);
      setWeeklyTrend([]);
    } finally {
      setTrendLoading(false);
    }
  }

  // ==========================================================================
  // OTP flow
  // ==========================================================================
  async function generateOTPForCompletion(bookingId: string) {
    setOtpGenerating(true);
    try {
      const response = await api.post(`/bookings/${bookingId}/generate-otp`, {});
      if (response.data.success) {
        // The OTP itself is stored on the booking (for the customer's app to
        // read via GET /bookings/:id) and texted to their phone — it's no
        // longer returned here. devOtp only appears outside production.
        setGeneratedOTP(response.data.devOtp || "sent");
        setOtpBookingId(bookingId);
        setShowOTPModal(true);

        socketService.emitOtpGenerated(bookingId, user?.id);

        Alert.alert(
          "🔐 OTP Sent",
          response.data.devOtp
            ? `${response.data.message}\n\nDev OTP: ${response.data.devOtp}`
            : response.data.message,
          [{ text: "OK" }],
        );
      }
    } catch (error: any) {
Alert.alert(
  "Error",
  error.response?.data?.error ||
    error?.message ||
    "Failed to generate OTP",
);
    } finally {
      setOtpGenerating(false);
    }
  }

  async function startCompleteService(booking: any) {
    setActiveBooking(booking);
    setEnteredOTP("");

    if (generatedOTP && otpBookingId === booking.id) {
      setShowOTPModal(true);
      return;
    }

    await generateOTPForCompletion(booking.id);
  }

  async function verifyMechanicOTP(bookingId: string, otp: string) {
    if (!otp || otp.length !== 6) {
      Alert.alert("Error", "Please enter a valid 6-digit OTP");
      return;
    }

    setVerifyingOTP(true);
    try {
      const response = await api.post(`/bookings/${bookingId}/verify-otp`, {
        otp: otp,
      });

      if (response.data.success) {
        Alert.alert(
          "✅ Service Completed!",
          "The service has been completed successfully.",
          [
            {
              text: "OK",
              onPress: () => {
                setShowOTPModal(false);
                setEnteredOTP("");
                setGeneratedOTP("");
                setOtpBookingId(null);
                loadMyJobs();
                fetchTodayEarnings();
                fetchAnalytics();
              },
            },
          ],
        );
      }
    } catch (error: any) {
Alert.alert(
  "Verification Failed",
  error.response?.data?.error ||
    error?.message ||
    "Invalid OTP. Please try again.",
);
    } finally {
      setVerifyingOTP(false);
    }
  }

  async function rateCustomer(booking: any) {
    setSelectedCompletedBooking(booking);
    setShowRatingModal(true);
  }

  async function submitCustomerRating() {
    if (customerRating === 0) {
      Alert.alert("Error", "Please rate the customer");
      return;
    }

    try {
      await api.post(`/bookings/${selectedCompletedBooking.id}/mechanic-rating`, {
        rating: customerRating,
        review: customerReview.trim() || undefined,
      });

      Alert.alert("Thank You!", "Your feedback has been submitted.");
      setShowRatingModal(false);
      setCustomerRating(0);
      setCustomerReview("");
      loadMyJobs();
      fetchTodayEarnings();
      fetchAnalytics();
    } catch (error: any) {
Alert.alert(
  "Error",
  error.response?.data?.error ||
    error?.message ||
    "Failed to submit rating",
);
    }
  }

  async function updateStatus(bookingId: string, status: "on_the_way" | "arrived" | "completed") {
    try {
      const response = await api.patch(`/bookings/${bookingId}/status`, { status });
      const updatedBooking = response.data;
      console.log(`Booking ${bookingId} status updated to ${status}:`, updatedBooking);

      socketService.updateBookingStatus(bookingId, status);

      if (status === "completed") {
        await fetchTodayEarnings();
        await fetchAnalytics();
        await fetchWeeklyEarningsTrend();
      }

      await loadMyJobs();
      return updatedBooking;
    } catch (error) {
      console.error("Failed to update status:", error);
      Alert.alert("Error", "Failed to update status");
      return null;
    }
  }

  const viewRatingsDetails = (booking: Booking) => {
    setSelectedRatingsBooking(booking);
    setShowRatingsDetailModal(true);
  };

  const renderStars = (rating: number | null | undefined) => {
    if (!rating) return null;

    const stars = [];
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <Ionicons key={i} name={i <= rating ? "star" : "star-outline"} size={14} color={COLORS.accent} />,
      );
    }
    return <View style={{ flexDirection: "row", gap: 2 }}>{stars}</View>;
  };

  // ==========================================================================
  // Location tracking
  // ==========================================================================
  const sendLocationUpdate = async (bookingId: string) => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") return;

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const newLocation = {
        lat: location.coords.latitude,
        lng: location.coords.longitude,
      };

      setCurrentLocation(newLocation);

      const activeJob = myJobs.find((job) => job.id === bookingId);

      if (activeJob && activeJob.customer_lat && activeJob.customer_lng) {
        const eta = calculateETA(newLocation.lat, newLocation.lng, activeJob.customer_lat, activeJob.customer_lng);

        socketService.sendMechanicLocation(bookingId, newLocation, eta, user?.id);
        await api.patch(`/mechanics/${user?.id}/location`, newLocation);
      }
    } catch (error) {
      console.error("Failed to send location update:", error);
    }
  };

  useEffect(() => {
    const activeJob = myJobs.find((job) => ACTIVE_STATUSES.includes(job.status));

    setActiveBooking(activeJob);

    if (activeJob && online) {
      console.log("Starting location tracking for active job:", activeJob.id);
      sendLocationUpdate(activeJob.id);

      const interval = setInterval(() => {
        sendLocationUpdate(activeJob.id);
      }, 5000);

      return () => {
        console.log("Cleaning up location tracking interval");
        clearInterval(interval);
      };
    }
  }, [myJobs, online]);

  // ------------------------------------------------------------------
  // Keep the "On The Way" tracking screen's booking in sync with the
  // live myJobs list (so distance/status/etc. never go stale while the
  // map is open), and auto-close it if the job leaves the "on_the_way"
  // state some other way (e.g. cancelled by the customer).
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!trackingBooking) return;
    const latest = myJobs.find((job) => job.id === trackingBooking.id);
    if (!latest) return;
    setTrackingBooking(latest);
    if (latest.status !== "on_the_way") {
      setShowTrackingModal(false);
    }
  }, [myJobs]);

  // ==========================================================================
  // Incoming request countdown (Ola/Rapido style auto-expiry)
  // ==========================================================================
  useEffect(() => {
    if (!incomingRequest) {
      if (incomingTimerRef.current) {
        clearInterval(incomingTimerRef.current);
        incomingTimerRef.current = null;
      }
      return;
    }

    setIncomingCountdown(INCOMING_REQUEST_TIMEOUT);
    incomingTimerRef.current = setInterval(() => {
      setIncomingCountdown((prev) => {
        if (prev <= 1) {
          if (incomingTimerRef.current) clearInterval(incomingTimerRef.current);
          stopBeepSound();
          setIncomingRequest(null);
          return INCOMING_REQUEST_TIMEOUT;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (incomingTimerRef.current) {
        clearInterval(incomingTimerRef.current);
        incomingTimerRef.current = null;
      }
    };
  }, [incomingRequest]);

  // ==========================================================================
  // Socket wiring
  // ==========================================================================
  useEffect(() => {
    if (user) {
      loadData();
      getCurrentLocation();
      fetchTodayEarnings();
      fetchAnalytics();
      fetchWeeklyEarningsTrend();
      loadMechanicProfile();
      loadAvailableServices();
    }

    socket.on("booking:new", async (booking: any) => {
      console.log("New booking available:", booking);

      if (booking.auto_cancelled || booking.status === "cancelled") {
        console.log("Booking was auto-cancelled:", booking);
        loadOpenJobs();
        return;
      }

      await playBeepSound();

      setIncomingRequest(booking);
      loadOpenJobs();
    });

    return () => {
      socket.off("booking:new");
      stopBeepSound();
    };
  }, [user]);

  useEffect(() => {
    if (online) {
      const refreshInterval = setInterval(() => {
        if (activeTab === "bookings" && bookingsSubTab === "available") {
          loadOpenJobs();
        }
      }, 10000);

      return () => clearInterval(refreshInterval);
    }
  }, [online, activeTab, bookingsSubTab]);

  // ==========================================================================
  // Data loaders
  // ==========================================================================
  async function loadData() {
    await Promise.all([loadOpenJobs(), loadMyJobs(), loadAvailability()]);
    setLoading(false);
  }

  async function getCurrentLocation() {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") return;

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      setCurrentLocation({
        lat: location.coords.latitude,
        lng: location.coords.longitude,
      });
    } catch (error) {
      console.error("Failed to get location:", error);
    }
  }

  async function loadOpenJobs() {
    try {
      const { data } = await api.get("/bookings/open");
      setJobs(data || []);
    } catch (error) {
      console.error("Failed to load jobs:", error);
    }
  }

  async function loadMyJobs() {
    try {
      const { data } = await api.get(`/bookings/mechanic/${user?.id}`);
      setMyJobs(data || []);
    } catch (error) {
      console.error("Failed to load my jobs:", error);
    }
  }

  async function loadMechanicProfile() {
    try {
      const { data } = await api.get(`/mechanics/${user?.id}/profile`);
      setMechanicProfile(data);
      setSelectedServices(data.services_offered || []);

      const prices: Record<string, string> = {};
      if (data.custom_prices) {
        Object.entries(data.custom_prices).forEach(([key, value]: any) => {
          prices[key] = value.toString();
        });
      }
      setCustomPrices(prices);

      setProfileForm({
        full_name: data.full_name || "",
        phone: data.phone || "",
        vehicle_type: data.vehicle_type || "",
        license_number: data.license_number || "",
        experience_years: data.experience_years?.toString() || "",
        bio: data.bio || "",
      });
    } catch (error) {
      console.error("Failed to load mechanic profile:", error);
    }
  }

  async function loadAvailableServices() {
    try {
      const { data } = await api.get("/services");
      setAvailableServices(data);
    } catch (error) {
      console.error("Failed to load services:", error);
    }
  }

  async function updateMechanicProfile() {
    try {
      const servicesWithPrices = selectedServices.reduce((acc, serviceId) => {
        if (customPrices[serviceId]) {
          acc[serviceId] = parseFloat(customPrices[serviceId]);
        }
        return acc;
      }, {} as Record<string, number>);

      await api.put(`/mechanics/${user?.id}/profile`, {
        ...profileForm,
        experience_years: parseInt(profileForm.experience_years) || 0,
        services_offered: selectedServices,
        custom_prices: servicesWithPrices,
      });

      Alert.alert("Success", "Profile updated successfully!");
      setEditingProfile(false);
      loadMechanicProfile();
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to update profile");
    }
  }

  async function loadAvailability() {
    try {
      const { data } = await api.get(`/mechanics/${user?.id}/availability`);
      setOnline(data?.is_online || false);
    } catch (error) {
      console.error("Failed to load availability:", error);
    }
  }

  async function toggleAvailability() {
    const nextState = !online;

    if (nextState) {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== "granted") {
          Alert.alert("Location Required", "Please enable location permissions to go online.");
          return;
        }

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        const lat = location.coords.latitude;
        const lng = location.coords.longitude;

        setCurrentLocation({ lat, lng });

        await api.patch(`/mechanics/${user?.id}/availability`, {
          isOnline: nextState,
          currentLat: lat,
          currentLng: lng,
        });

        setOnline(nextState);
      } catch (error) {
        console.error("Failed to get location:", error);
        Alert.alert("Error", "Unable to get your current location.");
        return;
      }
    } else {
      try {
        await api.patch(`/mechanics/${user?.id}/availability`, {
          isOnline: nextState,
          currentLat: currentLocation?.lat || 0,
          currentLng: currentLocation?.lng || 0,
        });
        setOnline(nextState);
      } catch (error) {
        Alert.alert("Error", "Failed to update availability");
      }
    }
  }

  // ==========================================================================
  // Accept flow (from the Available list — confirm modal)
  // ==========================================================================
  async function acceptJob(booking: Booking) {
    setSelectedBooking(booking);
    setShowAcceptModal(true);
  }

  async function confirmAcceptJob() {
    if (!selectedBooking) return;

    setAccepting(true);
    try {
      await api.patch(`/bookings/${selectedBooking.id}/assign`, {
        mechanicId: user?.id,
        etaMinutes: 15,
        status: "accepted",
      });

      socketService.acceptBooking(
        selectedBooking.id,
        { id: user?.id, full_name: user?.full_name, phone: user?.phone },
        15,
      );

      socketService.joinBookingRoom(selectedBooking.id);

      Alert.alert("✓ Accepted!", "You have accepted the job. Navigate to the customer's location now.");

      setShowAcceptModal(false);
      await Promise.all([loadOpenJobs(), loadMyJobs()]);

      setJobs((prevJobs) => prevJobs.filter((job) => job.id !== selectedBooking.id));
      setActiveTab("bookings");
      setBookingsSubTab("myJobs");
    } catch (error: any) {
      console.error("Failed to accept job:", error);

      if (error.response?.status === 409) {
        Alert.alert("Already Accepted", "This service request has already been accepted by another mechanic.");
        await loadOpenJobs();
      } else {
        Alert.alert("Error", error?.message || "Failed to accept job");
      }
    } finally {
      setAccepting(false);
      setSelectedBooking(null);
    }
  }

  // ==========================================================================
  // Accept flow (from the incoming-request popup — Ola/Rapido style)
  // ==========================================================================
  async function acceptIncomingRequest() {
    if (!incomingRequest) return;

    setAccepting(true);
    try {
      await api.patch(`/bookings/${incomingRequest.id}/assign`, {
        mechanicId: user?.id,
        etaMinutes: 15,
        status: "accepted",
      });

      socketService.acceptBooking(
        incomingRequest.id,
        { id: user?.id, full_name: user?.full_name, phone: user?.phone },
        15,
      );

      socketService.joinBookingRoom(incomingRequest.id);

      await stopBeepSound();
      setIncomingRequest(null);

      await Promise.all([loadOpenJobs(), loadMyJobs()]);
      setJobs((prevJobs) => prevJobs.filter((job) => job.id !== incomingRequest.id));

      setActiveTab("bookings");
      setBookingsSubTab("myJobs");
    } catch (error: any) {
      console.error("Failed to accept incoming request:", error);

      if (error.response?.status === 409) {
        Alert.alert("Already Accepted", "This service request has already been accepted by another mechanic.");
        await stopBeepSound();
        setIncomingRequest(null);
        await loadOpenJobs();
      } else {
        Alert.alert("Error", error.response?.data?.error || "Failed to accept job");
      }
    } finally {
      setAccepting(false);
    }
  }

  async function declineIncomingRequest() {
    if (incomingRequest) {
      setJobs((prevJobs) => prevJobs.filter((job) => job.id !== incomingRequest.id));
    }
    await stopBeepSound();
    setIncomingRequest(null);
  }

  // --------------------------------------------------------------------
  // NEW: Tapping the incoming-request notification/card itself (not the
  // Accept/Decline buttons) closes the popup and takes the mechanic
  // straight to the "Available" jobs list, where the request (and any
  // others) can be reviewed and accepted from there.
  // --------------------------------------------------------------------
  const goToAvailableJobs = async () => {
    if (incomingTimerRef.current) {
      clearInterval(incomingTimerRef.current);
      incomingTimerRef.current = null;
    }
    await stopBeepSound();
    // Don't remove the job from `jobs` — it's still available, we're just
    // closing the popup and routing the mechanic to the full list.
    setIncomingRequest(null);
    setActiveTab("bookings");
    setBookingsSubTab("available");
  };

  useEffect(() => {
    const handleBookingTaken = (data: { bookingId: string; mechanicId: string; message: string }) => {
      console.log("Booking taken by another mechanic:", data);

      setJobs((prevJobs) => prevJobs.filter((job) => job.id !== data.bookingId));

      if (incomingRequest?.id === data.bookingId) {
        stopBeepSound();
        setIncomingRequest(null);
      }

      if (selectedBooking?.id === data.bookingId) {
        Alert.alert("Booking Taken", "This service request has been accepted by another mechanic.", [
          {
            text: "OK",
            onPress: () => {
              setShowAcceptModal(false);
              setSelectedBooking(null);
            },
          },
        ]);
      }
    };

    const handleBookingAcceptError = (data: { bookingId: string; error: string; alreadyAssigned?: boolean }) => {
      if (data.alreadyAssigned) {
        Alert.alert("Already Accepted", data.error || "This service request has already been accepted by another mechanic.");
        loadOpenJobs();
      }
    };

    socketService.onBookingTaken(handleBookingTaken);
    socketService.onBookingAcceptError(handleBookingAcceptError);

    return () => {
      socketService.off("booking:taken");
      socketService.off("booking:accept:error");
    };
  }, [selectedBooking, incomingRequest]);

  async function handleLogout() {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      { text: "Logout", onPress: () => logout() },
    ]);
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await getCurrentLocation();
    await loadData();
    await fetchTodayEarnings();
    await fetchAnalytics();
    await fetchWeeklyEarningsTrend();
    await loadMechanicProfile();
    setRefreshing(false);
  }, []);

  const toggleServiceSelection = (serviceId: string) => {
    if (selectedServices.includes(serviceId)) {
      setSelectedServices(selectedServices.filter((id) => id !== serviceId));
      const newPrices = { ...customPrices };
      delete newPrices[serviceId];
      setCustomPrices(newPrices);
    } else {
      setSelectedServices([...selectedServices, serviceId]);
    }
  };

  // ==========================================================================
  // "On The Way" in-app tracking flow
  // ==========================================================================
  // ✅ NEW — replaces the old "updateStatus + open external Maps app"
  // behaviour on "Start & Navigate". Now the mechanic gets the SAME kind
  // of in-app tracking screen the customer sees on their side: a map with
  // this mechanic's own hard-hat marker, the customer's locator pin, a
  // live route line, an ETA card, and a "Reached Location" button that
  // advances the job to "arrived" without ever leaving the app.
  async function startNavigationTracking(booking: any) {
    setRouteInfo(null);
    setRouteError(null);
    routeRetryCount.current = 0;
    setTrackingBooking(booking);

    const updated = await updateStatus(booking.id, "on_the_way");
    setTrackingBooking(updated || booking);
    setShowTrackingModal(true);
  }

  // Reopen the tracking screen for a job that is already "on_the_way"
  // (e.g. the mechanic closed it and wants to see the map again).
  function reopenNavigationTracking(booking: any) {
    setRouteInfo(null);
    setRouteError(null);
    routeRetryCount.current = 0;
    setTrackingBooking(booking);
    setShowTrackingModal(true);
  }

  // "Reached Location" button on the tracking screen — marks the job
  // "arrived" and closes the map, handing off to the existing
  // Generate OTP / Complete Service flow on the job card.
  async function markReachedLocation() {
    if (!trackingBooking) return;
    setMarkingArrived(true);
    try {
      await updateStatus(trackingBooking.id, "arrived");
      setShowTrackingModal(false);
      setTrackingBooking(null);
      setRouteInfo(null);
      setRouteError(null);
      Alert.alert("📍 Arrived", "You've been marked as arrived at the customer's location.");
    } finally {
      setMarkingArrived(false);
    }
  }

  // ==========================================================================
  // Navigation helpers
  // ==========================================================================
  const openGoogleMapsNavigation = async (customerLat: number, customerLng: number, customerAddress: string) => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission Denied", "Please enable location permissions to use navigation.");
        return;
      }

      const currentLoc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });

      const originLat = currentLoc.coords.latitude;
      const originLng = currentLoc.coords.longitude;

      const url = Platform.select({
        ios: `maps://maps.apple.com/?daddr=${customerLat},${customerLng}&dirflg=d`,
        android: `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${customerLat},${customerLng}&travelmode=driving`,
      });

      const fallbackUrl = `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${customerLat},${customerLng}&travelmode=driving`;

      const finalUrl = url || fallbackUrl;
      const canOpen = await Linking.canOpenURL(finalUrl);

      if (canOpen) {
        await Linking.openURL(finalUrl);
      } else {
        await Linking.openURL(fallbackUrl);
      }
    } catch (error) {
      console.error("Failed to open maps:", error);
      Alert.alert("Error", "Could not open maps. Please try again.");
    }
  };

  const showNavigationOptions = (job: any) => {
    Alert.alert(
      "Navigate to Customer",
      `Choose navigation app for: ${job.customer?.full_name || "Customer"}`,
      [
        {
          text: "Google Maps",
          onPress: () => openGoogleMapsNavigation(job.customer_lat, job.customer_lng, job.customer_address),
        },
        {
          text: "Apple Maps",
          onPress: () => {
            if (Platform.OS === "ios") {
              openGoogleMapsNavigation(job.customer_lat, job.customer_lng, job.customer_address);
            } else {
              Alert.alert("Not Available", "Apple Maps is only available on iOS.");
            }
          },
        },
        {
          text: "View Address",
          onPress: () => {
            Alert.alert("Customer Address", job.customer_address || "Address not provided");
          },
        },
        { text: "Cancel", style: "cancel" },
      ],
      { cancelable: true },
    );
  };

  // ==========================================================================
  // Derived values
  // ==========================================================================
  const ongoingJobsCount = myJobs.filter((job) => ACTIVE_STATUSES.includes(job.status)).length;
  const firstName = (mechanicProfile?.full_name || user?.full_name || "there").split(" ")[0];

  // ==========================================================================
  // Job card (shared by Available + My Jobs lists)
  // ==========================================================================
  const renderJobCard = ({ item }: { item: any }) => {
    const isMyJob =
      activeTab === "bookings" && (bookingsSubTab === "myJobs" || bookingsSubTab === "completed");
    const hasCustomerRating = item.customer_rating;
    const hasMechanicRating = item.mechanic_rating;
    const servicePrice = item.service_price || item.service?.base_price || 0;
    const distanceKm =
      item.customer_lat && item.customer_lng && currentLocation
        ? calculateDistance(currentLocation.lat, currentLocation.lng, item.customer_lat, item.customer_lng)
        : null;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Service Request #{item.id.slice(0, 8)}</Text>
          <View
            style={[
              styles.statusBadge,
              item.status === "completed" && styles.completedBadge,
              item.status === "cancelled" && styles.cancelledBadge,
              item.status === "accepted" && styles.acceptedBadge,
              item.status === "on_the_way" && styles.onWayBadge,
              item.status === "arrived" && styles.arrivedBadge,
            ]}
          >
            <Text
              style={[
                styles.statusBadgeText,
                (item.status === "on_the_way" || item.status === "arrived" || item.status === "cancelled") &&
                  styles.statusBadgeTextLight,
              ]}
            >
              {item.status?.replaceAll("_", " ").toUpperCase()}
            </Text>
          </View>
        </View>

        {!isMyJob && (
          <View style={styles.requestTopRow}>
            <View style={styles.requestPriceChip}>
              <Text style={styles.requestPriceChipText}>₹{servicePrice}</Text>
            </View>
            {distanceKm !== null && (
              <View style={styles.requestDistanceChip}>
                <Ionicons name="navigate" size={12} color={COLORS.accent} />
                <Text style={styles.requestDistanceChipText}>{distanceKm.toFixed(1)} km away</Text>
              </View>
            )}
          </View>
        )}

        <Text style={styles.cardMeta}>Service: {item.service?.name || "Road assistance needed"}</Text>
        {isMyJob && <Text style={styles.cardMeta}>Price: ₹{servicePrice}</Text>}
        <Text style={styles.cardMeta}>Issue: {item.issue_note || "Road assistance needed"}</Text>

        {item.customer && <Text style={styles.cardMeta}>Customer: {item.customer.full_name}</Text>}
        {item.customer_address && <Text style={styles.cardMeta}>📍 {item.customer_address}</Text>}
        {item.vehicle_type && <Text style={styles.cardMeta}>🚗 {item.vehicle_type}</Text>}
        {item.vehicle_model && <Text style={styles.cardMeta}>🔧 {item.vehicle_model}</Text>}

        {isMyJob && distanceKm !== null && (
          <Text style={styles.distanceText}>📍 Distance: {distanceKm.toFixed(1)} km away</Text>
        )}

        {hasCustomerRating && (
          <TouchableOpacity style={styles.ratingSummary} onPress={() => viewRatingsDetails(item)} activeOpacity={0.7}>
            <View style={styles.ratingSummaryLeft}>
              <View style={styles.ratingSummaryStarWrap}>
                <Ionicons name="star" size={14} color={COLORS.accent} />
              </View>
              <Text style={styles.ratingSummaryText}>{item.customer_rating?.toFixed(1)} Rating</Text>
            </View>
            <View style={styles.ratingSummaryRight}>
              {hasMechanicRating && (
                <View style={styles.mechanicRatingBadge}>
                  <Ionicons name="person-outline" size={12} color={COLORS.accent} />
                  <Text style={styles.mechanicRatingText}>{item.mechanic_rating?.toFixed(1)} ★</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={16} color={COLORS.muted} />
            </View>
          </TouchableOpacity>
        )}

        {!isMyJob && item.status === "requested" && (
          <TouchableOpacity style={styles.acceptButton} onPress={() => acceptJob(item)}>
            <Text style={styles.acceptButtonText}>Accept Job</Text>
          </TouchableOpacity>
        )}

        {isMyJob && item.status !== "completed" && item.status !== "cancelled" && (
          <View style={styles.row}>
            {item.status === "accepted" && (
              <TouchableOpacity
                style={[styles.smallBtn, styles.primaryBtn, { flex: 1 }]}
                onPress={() => startNavigationTracking(item)}
              >
                <Ionicons name="car-outline" size={16} color={COLORS.white} />
                <Text style={styles.smallBtnText}>Start & Navigate</Text>
              </TouchableOpacity>
            )}
            {item.status === "on_the_way" && (
              <TouchableOpacity
                style={[styles.smallBtn, styles.primaryBtn, { flex: 1 }]}
                onPress={() => reopenNavigationTracking(item)}
              >
                <Ionicons name="navigate-outline" size={16} color={COLORS.white} />
                <Text style={styles.smallBtnText}>View Route</Text>
              </TouchableOpacity>
            )}
            {item.status === "arrived" && (
              <>
                <TouchableOpacity
                  style={[styles.smallBtn, styles.otpBtn]}
                  onPress={() => {
                    setActiveBooking(item);
                    generateOTPForCompletion(item.id);
                  }}
                >
                  <Ionicons name="key-outline" size={16} color={COLORS.white} />
                  <Text style={[styles.smallBtnText, { color: COLORS.white }]}>Generate OTP</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.smallBtn, styles.completeBtn]} onPress={() => startCompleteService(item)}>
                  <Text style={[styles.smallBtnText, { color: COLORS.white }]}>Complete Service</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

       
      </View>
    );
  };

  // ==========================================================================
  // Home tab — Ola/Rapido style dashboard
  // ==========================================================================
  const renderHome = () => {
    const rating = mechanicProfile?.rating || 0;
    const maxTrendAmount = Math.max(...weeklyTrend.map((d) => d.amount), 1);

    return (
      <ScrollView
        style={styles.homeContainer}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.dark]} tintColor={COLORS.dark} />}
      >
        <View style={styles.homeHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.homeGreeting} numberOfLines={1}>
              {greetingForNow()}, {firstName} 👋
            </Text>
            <Text style={styles.homeHeadline}>
              Ready to <Text style={styles.homeHeadlineAccent}>help</Text>{"\n"}someone today?
            </Text>
          </View>
          <TouchableOpacity onPress={handleLogout} style={styles.homeBellButton}>
            <Ionicons name="log-out-outline" size={20} color={COLORS.dark} />
          </TouchableOpacity>
        </View>

        {/* Online status card */}
        <View style={styles.onlineStatusCard}>
          <View style={styles.onlineStatusLeft}>
            <View style={[styles.onlineStatusDot, { backgroundColor: online ? COLORS.accent : COLORS.muted }]} />
            <View>
              <Text style={styles.onlineStatusTitle}>Online Status</Text>
              <Text style={styles.onlineStatusSubtitle}>{online ? "You are online" : "You are offline"}</Text>
            </View>
          </View>
          <Switch
            value={online}
            onValueChange={toggleAvailability}
            trackColor={{ false: COLORS.tint, true: COLORS.dark }}
            thumbColor={COLORS.white}
          />
        </View>

        {/* New requests banner — tapping this also routes to Available Jobs */}
        {online && jobs.length > 0 && (
          <TouchableOpacity
            style={styles.newRequestsBanner}
            onPress={() => {
              setActiveTab("bookings");
              setBookingsSubTab("available");
            }}
          >
            <View style={styles.newRequestsLeft}>
              <View style={styles.newRequestsIconWrap}>
                <Ionicons name="megaphone" size={18} color={COLORS.white} />
              </View>
              <Text style={styles.newRequestsText} numberOfLines={1}>
                {jobs.length} new service {jobs.length === 1 ? "request" : "requests"} waiting
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.white} />
          </TouchableOpacity>
        )}

        {/* Today's overview */}
        <Text style={styles.homeSectionLabel}>Today's Overview</Text>
        <View style={styles.overviewGrid}>
          <View style={styles.overviewCard}>
            <Text style={styles.overviewValue}>{String(todaysJobsCount).padStart(2, "0")}</Text>
            <Text style={styles.overviewLabel}>Jobs Completed</Text>
          </View>
          <View style={styles.overviewCard}>
            <Text style={styles.overviewValue}>{String(ongoingJobsCount).padStart(2, "0")}</Text>
            <Text style={styles.overviewLabel}>Ongoing Jobs</Text>
          </View>
          <View style={styles.overviewCard}>
            <Text style={styles.overviewValue}>₹{todayEarnings}</Text>
            <Text style={styles.overviewLabel}>Today's Earnings</Text>
          </View>
          <View style={styles.overviewCard}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Text style={styles.overviewValue}>{rating.toFixed(1)}</Text>
              <Ionicons name="star" size={16} color={COLORS.accent} />
            </View>
            <Text style={styles.overviewLabel}>Your Rating</Text>
          </View>
        </View>

        {/* Earnings trend card — real last-7-days earnings, one bar per day */}
        <View style={styles.trendCard}>
          <View style={styles.trendCardHeader}>
            <Text style={styles.homeSectionLabel}>Today's Earnings</Text>
          </View>
          <Text style={styles.trendAmount}>₹{todayEarnings}</Text>

          {trendLoading ? (
            <View style={styles.trendLoadingBox}>
              <ActivityIndicator size="small" color={COLORS.dark} />
            </View>
          ) : weeklyTrend.length > 0 ? (
            <>
              <View style={styles.trendBarsRow}>
                {weeklyTrend.map((day, idx) => {
                  const barHeight = day.amount > 0 ? Math.max(8, (day.amount / maxTrendAmount) * 46) : 4;
                  return (
                    <TouchableOpacity
                      key={idx}
                      style={styles.trendBarWrap}
                      activeOpacity={0.7}
                      onPress={() =>
                        Alert.alert(day.isToday ? "Today" : "Earnings", `₹${day.amount} earned`)
                      }
                    >
                      <View
                        style={[styles.trendBar, { height: barHeight }, day.isToday && styles.trendBarActive]}
                      />
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={styles.trendLabelsRow}>
                {weeklyTrend.map((day, idx) => (
                  <Text
                    key={idx}
                    style={[styles.trendBarLabel, day.isToday && styles.trendBarLabelActive]}
                  >
                    {day.label}
                  </Text>
                ))}
              </View>
            </>
          ) : (
            <Text style={styles.trendEmptyText}>No earnings data for this week yet</Text>
          )}
        </View>

        {/* Quick links */}
        <View style={styles.quickLinksRow}>
          <TouchableOpacity style={styles.quickLinkCard} onPress={() => setActiveTab("bookings")}>
            <Ionicons name="construct-outline" size={22} color={COLORS.dark} />
            <Text style={styles.quickLinkText}>My Jobs</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickLinkCard} onPress={() => setActiveTab("earnings")}>
            <Ionicons name="stats-chart-outline" size={22} color={COLORS.dark} />
            <Text style={styles.quickLinkText}>Earnings</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickLinkCard} onPress={() => setActiveTab("profile")}>
            <Ionicons name="person-outline" size={22} color={COLORS.dark} />
            <Text style={styles.quickLinkText}>Profile</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  };

  // ==========================================================================
  // Bookings tab — dedicated Available / My Jobs (active only) / Completed lists
  // ==========================================================================
  const renderBookings = () => {
    // "My Jobs" now only holds jobs that are still in progress (accepted,
    // on the way, or arrived). Completed and cancelled jobs move to their
    // own "Completed" sub-tab instead of cluttering the active list.
    const activeMyJobs = myJobs.filter((job) => ACTIVE_STATUSES.includes(job.status));
    const completedJobs = myJobs.filter((job) => job.status === "completed");

    const data =
      bookingsSubTab === "available" ? jobs : bookingsSubTab === "myJobs" ? activeMyJobs : completedJobs;

    return (
      <View style={{ flex: 1 }}>
        <View style={styles.subTabBar}>
          <TouchableOpacity
            style={[styles.subTab, bookingsSubTab === "available" && styles.subTabActive]}
            onPress={() => setBookingsSubTab("available")}
          >
            <Text
              style={[styles.subTabText, bookingsSubTab === "available" && styles.subTabTextActive]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              Available ({jobs.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.subTab, bookingsSubTab === "myJobs" && styles.subTabActive]}
            onPress={() => setBookingsSubTab("myJobs")}
          >
            <Text
              style={[styles.subTabText, bookingsSubTab === "myJobs" && styles.subTabTextActive]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              My Jobs ({activeMyJobs.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.subTab, bookingsSubTab === "completed" && styles.subTabActive]}
            onPress={() => setBookingsSubTab("completed")}
          >
            <Text
              style={[styles.subTabText, bookingsSubTab === "completed" && styles.subTabTextActive]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              Completed ({completedJobs.length})
            </Text>
          </TouchableOpacity>
        </View>


        {!online && bookingsSubTab === "available" && (
          <View style={styles.offlineNotice}>
            <Ionicons name="power-outline" size={16} color={COLORS.accent} />
            <Text style={styles.offlineNoticeText}>You're offline — go online from Home to receive requests.</Text>
          </View>
        )}

        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 96 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.dark]} tintColor={COLORS.dark} />}
          renderItem={renderJobCard}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="construct-outline" size={64} color={COLORS.muted} />
              <Text style={styles.emptyStateText}>
                {bookingsSubTab === "available"
                  ? "No available jobs at the moment"
                  : bookingsSubTab === "myJobs"
                  ? "You have no active jobs"
                  : "No completed jobs yet"}
              </Text>
              {bookingsSubTab === "available" && online && (
                <Text style={styles.emptyStateSubtext}>New requests will appear here automatically</Text>
              )}
            </View>
          }
        />
      </View>
    );
  };

  // ==========================================================================
  // Profile tab
  // ==========================================================================
  const renderProfile = () => {
    return (
      <ScrollView style={styles.profileContainer} contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}>
        <View style={styles.profileHeader}>
          <View style={styles.profileAvatar}>
            <Ionicons name="person" size={60} color={COLORS.white} />
          </View>
          <Text style={styles.profileName}>{mechanicProfile?.full_name || user?.full_name}</Text>
          <Text style={styles.profileEmail}>{user?.email}</Text>
          {mechanicProfile?.is_verified && (
            <View style={styles.verifiedBadge}>
              <Ionicons name="checkmark-circle" size={16} color={COLORS.accent} />
              <Text style={styles.verifiedText}>Verified Mechanic</Text>
            </View>
          )}
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Ionicons name="star" size={24} color={COLORS.accent} />
            <Text style={styles.statValue}>{mechanicProfile?.rating?.toFixed(1) || "0.0"}</Text>
            <Text style={styles.statLabel}>Rating</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="briefcase" size={24} color={COLORS.accent} />
            <Text style={styles.statValue}>{mechanicProfile?.total_jobs || 0}</Text>
            <Text style={styles.statLabel}>Total Jobs</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="checkmark-done" size={24} color={COLORS.accent} />
            <Text style={styles.statValue}>{mechanicProfile?.completion_rate || 0}%</Text>
            <Text style={styles.statLabel}>Completion</Text>
          </View>
        </View>

        <View style={styles.infoSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Profile Information</Text>
            <TouchableOpacity onPress={() => setEditingProfile(true)}>
              <Ionicons name="create-outline" size={20} color={COLORS.accent} />
            </TouchableOpacity>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="call-outline" size={18} color={COLORS.muted} />
            <Text style={styles.infoText}>{mechanicProfile?.phone || "Not provided"}</Text>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="car-outline" size={18} color={COLORS.muted} />
            <Text style={styles.infoText}>{mechanicProfile?.vehicle_type || "Not specified"}</Text>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="card-outline" size={18} color={COLORS.muted} />
            <Text style={styles.infoText}>License: {mechanicProfile?.license_number || "Not provided"}</Text>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="time-outline" size={18} color={COLORS.muted} />
            <Text style={styles.infoText}>Experience: {mechanicProfile?.experience_years || 0} years</Text>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="document-text-outline" size={18} color={COLORS.muted} />
            <Text style={styles.infoText}>Bio: {mechanicProfile?.bio || "No bio provided"}</Text>
          </View>
        </View>

        <View style={styles.infoSection}>
          <Text style={styles.sectionTitle}>Services Offered</Text>
          {selectedServices.length > 0 ? (
            selectedServices.map((serviceId) => {
              const service = availableServices.find((s) => s.id === serviceId);
              const customPrice = customPrices[serviceId];
              return service ? (
                <View key={serviceId} style={styles.serviceCard}>
                  <View style={styles.serviceInfo}>
                    <Text style={styles.serviceName}>{service.name}</Text>
                    <Text style={styles.serviceDescription}>{service.description}</Text>
                  </View>
                  <View style={styles.servicePrice}>
                    <Text style={styles.priceText}>₹{customPrice || service.base_price}</Text>
                    {customPrice && <Text style={styles.customPriceBadge}>Custom</Text>}
                  </View>
                </View>
              ) : null;
            })
          ) : (
            <Text style={styles.noServicesText}>No services selected yet</Text>
          )}
        </View>

        {/* Edit Profile Modal */}
        <Modal visible={editingProfile} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <ScrollView contentContainerStyle={styles.modalScrollContent}>
              <View style={[styles.modalContent, { width: "95%", maxWidth: 500 }]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Edit Profile</Text>
                  <TouchableOpacity onPress={() => setEditingProfile(false)}>
                    <Ionicons name="close" size={24} color={COLORS.muted} />
                  </TouchableOpacity>
                </View>

                <ScrollView style={{ maxHeight: 500 }}>
                  <TextInput
                    style={styles.input}
                    placeholder="Full Name"
                    placeholderTextColor={COLORS.muted}
                    value={profileForm.full_name}
                    onChangeText={(text) => setProfileForm({ ...profileForm, full_name: text })}
                  />

                  <TextInput
                    style={styles.input}
                    placeholder="Phone Number"
                    placeholderTextColor={COLORS.muted}
                    value={profileForm.phone}
                    onChangeText={(text) => setProfileForm({ ...profileForm, phone: text })}
                    keyboardType="phone-pad"
                  />

                  <TextInput
                    style={styles.input}
                    placeholder="Vehicle Type (e.g., Car, Motorcycle)"
                    placeholderTextColor={COLORS.muted}
                    value={profileForm.vehicle_type}
                    onChangeText={(text) => setProfileForm({ ...profileForm, vehicle_type: text })}
                  />

                  <TextInput
                    style={styles.input}
                    placeholder="License Number"
                    placeholderTextColor={COLORS.muted}
                    value={profileForm.license_number}
                    onChangeText={(text) => setProfileForm({ ...profileForm, license_number: text })}
                  />

                  <TextInput
                    style={styles.input}
                    placeholder="Years of Experience"
                    placeholderTextColor={COLORS.muted}
                    value={profileForm.experience_years}
                    onChangeText={(text) => setProfileForm({ ...profileForm, experience_years: text })}
                    keyboardType="numeric"
                  />

                  <TextInput
                    style={[styles.input, styles.textArea]}
                    placeholder="Bio / About You"
                    placeholderTextColor={COLORS.muted}
                    value={profileForm.bio}
                    onChangeText={(text) => setProfileForm({ ...profileForm, bio: text })}
                    multiline
                    numberOfLines={3}
                  />

                  <Text style={styles.sectionTitle}>Select Services & Set Prices</Text>

                  {availableServices.map((service) => (
                    <View key={service.id} style={styles.serviceSelectionCard}>
                      <TouchableOpacity style={styles.serviceCheckbox} onPress={() => toggleServiceSelection(service.id)}>
                        <Ionicons
                          name={selectedServices.includes(service.id) ? "checkbox" : "square-outline"}
                          size={24}
                          color={selectedServices.includes(service.id) ? COLORS.accent : COLORS.muted}
                        />
                        <View style={styles.serviceCheckboxInfo}>
                          <Text style={styles.serviceCheckboxName}>{service.name}</Text>
                          <Text style={styles.serviceCheckboxDesc}>{service.description}</Text>
                          <Text style={styles.defaultPrice}>Default: ₹{service.base_price}</Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                  ))}

                  <TouchableOpacity style={styles.saveButton} onPress={updateMechanicProfile}>
                    <Text style={styles.saveButtonText}>Save Changes</Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>
            </ScrollView>
          </View>
        </Modal>
      </ScrollView>
    );
  };

  // ==========================================================================
  // Analytics / earnings tab — redesigned
  // ==========================================================================
  const renderAnalytics = () => {
    const maxServiceEarning =
      serviceStats.length > 0 ? Math.max(...serviceStats.map((s) => s.total_earnings)) : 0;

    return (
      <ScrollView style={styles.analyticsContainer} contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}>
        {/* Header */}
        <View style={styles.analyticsHeaderRow}>
          <Text style={styles.analyticsHeaderTitle}>Earnings</Text>
          <Text style={styles.analyticsHeaderSubtitle}>Track your income and performance</Text>
        </View>

        {/* Hero card — this month's total */}
        <View style={styles.earningsHeroCard}>
          <Text style={styles.earningsHeroLabel}>This Month</Text>
          <Text style={styles.earningsHeroAmount}>₹{monthlyEarnings}</Text>
          <View style={styles.earningsHeroFooterRow}>
            <View style={styles.earningsHeroFooterItem}>
              <Ionicons name="briefcase-outline" size={14} color={COLORS.tint} />
              <Text style={styles.earningsHeroFooterText}>{totalJobsCompleted} jobs completed</Text>
            </View>
            <View style={styles.earningsHeroFooterItem}>
              <Ionicons name="star" size={14} color={COLORS.tint} />
              <Text style={styles.earningsHeroFooterText}>
                {mechanicProfile?.rating?.toFixed(1) || "0.0"} rating
              </Text>
            </View>
          </View>
        </View>

        {/* Today / This Week split */}
        <View style={styles.earningsSplitRow}>
          <View style={styles.earningsSplitCard}>
            <View style={styles.earningsSplitIconWrap}>
              <Ionicons name="today-outline" size={16} color={COLORS.accent} />
            </View>
            <Text style={styles.earningsSplitLabel}>Today</Text>
            <Text style={styles.earningsSplitAmount}>₹{todayEarnings}</Text>
            <Text style={styles.earningsSplitSub}>
              {todaysJobsCount} {todaysJobsCount === 1 ? "job" : "jobs"}
            </Text>
          </View>

          <View style={styles.earningsSplitCard}>
            <View style={styles.earningsSplitIconWrap}>
              <Ionicons name="calendar-outline" size={16} color={COLORS.accent} />
            </View>
            <Text style={styles.earningsSplitLabel}>This Week</Text>
            <Text style={styles.earningsSplitAmount}>₹{weeklyEarnings}</Text>
            <Text style={styles.earningsSplitSub}> </Text>
          </View>
        </View>

        {/* Service performance */}
        <View style={styles.statsSection}>
          <Text style={styles.sectionTitle}>Service Performance</Text>
          {serviceStats.length > 0 ? (
            serviceStats.map((stat: any) => {
              const progress =
                maxServiceEarning > 0 ? Math.max(6, (stat.total_earnings / maxServiceEarning) * 100) : 6;
              return (
                <View key={stat.service_id} style={styles.serviceStatCard}>
                  <View style={styles.serviceStatHeader}>
                    <Text style={styles.serviceStatName} numberOfLines={1}>
                      {stat.service_name}
                    </Text>
                    <View style={styles.serviceStatRatingPill}>
                      <Ionicons name="star" size={12} color={COLORS.accent} />
                      <Text style={styles.ratingText}>{stat.avg_rating.toFixed(1)}</Text>
                    </View>
                  </View>

                  <View style={styles.serviceStatProgressTrack}>
                    <View style={[styles.serviceStatProgressFill, { width: `${progress}%` }]} />
                  </View>

                  <View style={styles.serviceStatDetails}>
                    <View style={styles.serviceStatItem}>
                      <Ionicons name="checkmark-circle" size={14} color={COLORS.muted} />
                      <Text style={styles.serviceStatValue}>{stat.total_completed} completed</Text>
                    </View>
                    <View style={styles.serviceStatItem}>
                      <Ionicons name="cash-outline" size={14} color={COLORS.muted} />
                      <Text style={styles.serviceStatValue}>₹{stat.total_earnings} earned</Text>
                    </View>
                  </View>
                </View>
              );
            })
          ) : (
            <View style={styles.emptyStatsBox}>
              <Ionicons name="bar-chart-outline" size={36} color={COLORS.muted} />
              <Text style={styles.noStatsText}>No service data available yet</Text>
            </View>
          )}
        </View>

        {/* Quick stats */}
        <View style={styles.statsSection}>
          <Text style={styles.sectionTitle}>Quick Stats</Text>
          <View style={styles.quickStatsGrid}>
            <View style={styles.quickStat}>
              <View style={styles.quickStatIconWrap}>
                <Ionicons name="happy" size={22} color={COLORS.accent} />
              </View>
              <Text style={styles.quickStatValue}>{mechanicProfile?.rating?.toFixed(1) || "0.0"}</Text>
              <Text style={styles.quickStatLabel}>Rating</Text>
            </View>
            <View style={styles.quickStat}>
              <View style={styles.quickStatIconWrap}>
                <Ionicons name="briefcase" size={22} color={COLORS.accent} />
              </View>
              <Text style={styles.quickStatValue}>{totalJobsCompleted}</Text>
              <Text style={styles.quickStatLabel}>Total Jobs</Text>
            </View>
            <View style={styles.quickStat}>
              <View style={styles.quickStatIconWrap}>
                <Ionicons name="checkmark-done" size={22} color={COLORS.accent} />
              </View>
              <Text style={styles.quickStatValue}>{mechanicProfile?.completion_rate || 0}%</Text>
              <Text style={styles.quickStatLabel}>Completion</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    );
  };

  // ==========================================================================
  // "On The Way" — in-app tracking screen (mirrors the "4. On The Way"
  // design and the map implementation used on the customer's tracking
  // screen in tabs/customer.tsx: hard-hat mechanic marker, the shared
  // <UserLocationMarker /> locator pin for the customer's destination,
  // a dashed "as the crow flies" connector, and the real driving route
  // from MapViewDirections once it resolves).
  // ==========================================================================
  const renderTrackingScreen = () => {
    if (!trackingBooking) return null;

    const destination =
      trackingBooking.customer_lat && trackingBooking.customer_lng
        ? {
            latitude: Number(trackingBooking.customer_lat),
            longitude: Number(trackingBooking.customer_lng),
          }
        : null;

    const mechanicCoord = currentLocation
      ? { latitude: currentLocation.lat, longitude: currentLocation.lng }
      : null;

    const hasValidLocations = !!(destination && mechanicCoord);

    const distanceKm =
      destination && mechanicCoord
        ? calculateDistance(
            mechanicCoord.latitude,
            mechanicCoord.longitude,
            destination.latitude,
            destination.longitude,
          )
        : null;

    const etaMinutesFallback =
      destination && mechanicCoord
        ? calculateETA(
            mechanicCoord.latitude,
            mechanicCoord.longitude,
            destination.latitude,
            destination.longitude,
          )
        : null;

    const etaText =
      routeInfo?.durationText ||
      (etaMinutesFallback !== null ? `${etaMinutesFallback} min` : "Calculating…");

    const canShowDirections =
      GOOGLE_MAPS_API_KEY &&
      GOOGLE_MAPS_API_KEY !== "your_api_key_here" &&
      GOOGLE_MAPS_API_KEY.length > 10;

    const servicePrice =
      trackingBooking.service_price || trackingBooking.service?.base_price || 0;

    return (
      <Modal
        visible={showTrackingModal}
        transparent={false}
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setShowTrackingModal(false)}
      >
        <SafeAreaView style={styles.otwContainer} edges={["top", "bottom"]}>
          <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

          {/* Header — matches the "On The Way" screen title bar */}
          <View style={styles.otwHeader}>
            <TouchableOpacity
              onPress={() => setShowTrackingModal(false)}
              style={styles.otwHeaderIconButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="arrow-back" size={22} color={COLORS.dark} />
            </TouchableOpacity>
            <Text style={styles.otwHeaderTitle}>On The Way</Text>
            <TouchableOpacity
              onPress={() => showNavigationOptions(trackingBooking)}
              style={styles.otwHeaderIconButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="navigate-outline" size={20} color={COLORS.dark} />
            </TouchableOpacity>
          </View>

          {/* ETA hero card — "Arriving in X min" with a ring badge, same
              beat as the mockup's circular countdown next to the map. */}
          <View style={styles.otwEtaCard}>
            <View style={styles.otwEtaTextWrap}>
              <Text style={styles.otwEtaLabel}>Arriving in</Text>
              <Text style={styles.otwEtaValue}>{etaText}</Text>
              {distanceKm !== null && (
                <Text style={styles.otwEtaDistance}>{distanceKm.toFixed(1)} km to go</Text>
              )}
            </View>
            <View style={styles.otwEtaRing}>
              <MaterialCommunityIcons name="motorbike" size={26} color={COLORS.dark} />
            </View>
          </View>

          {/* Map */}
          <View style={styles.otwMapContainer}>
            {hasValidLocations ? (
              <MapView
                ref={trackingMapRef}
                style={styles.otwMap}
                provider={PROVIDER_GOOGLE}
                initialRegion={{
                  latitude: (destination.latitude + mechanicCoord.latitude) / 2,
                  longitude: (destination.longitude + mechanicCoord.longitude) / 2,
                  latitudeDelta:
                    Math.abs(destination.latitude - mechanicCoord.latitude) * 1.5 + 0.01,
                  longitudeDelta:
                    Math.abs(destination.longitude - mechanicCoord.longitude) * 1.5 + 0.01,
                }}
                showsUserLocation={false}
                showsMyLocationButton={false}
                onMapReady={() => {
                  setTimeout(() => {
                    trackingMapRef.current?.fitToCoordinates([destination, mechanicCoord], {
                      edgePadding: { top: 80, right: 80, bottom: 80, left: 80 },
                      animated: true,
                    });
                  }, 400);
                }}
              >
                {/* Dashed "as the crow flies" connector — drawn first so the
                    real route (once resolved) renders on top of it. */}
                <Polyline
                  coordinates={[mechanicCoord, destination]}
                  strokeColor="#94A3B8"
                  strokeWidth={2}
                  lineDashPattern={[8, 6]}
                  zIndex={1}
                />

                {/* ✅ Customer locator pin — the SAME <UserLocationMarker />
                    component tabs/customer.tsx uses for the customer's own
                    current-location pin, now marking the customer's
                    destination on the mechanic's map. */}
                <UserLocationMarker coordinate={destination} />

                {/* ✅ Mechanic icon — the SAME hard-hat pin + pointer style
                    (mechanicMarkerPin / mechanicMarkerPointer) used for this
                    mechanic's marker everywhere on the customer's side of
                    the app, now showing THIS mechanic's own live position. */}
                <Marker coordinate={mechanicCoord}>
                  <View
                    style={[
                      styles.otwMechanicMarkerPin,
                      {
                        backgroundColor: MECHANIC_PIN_ONLINE.bg,
                        borderColor: MECHANIC_PIN_ONLINE.border,
                      },
                    ]}
                  >
                    <MaterialCommunityIcons name="account-hard-hat" size={22} color="#FFFFFF" />
                  </View>
                  <View
                    style={[
                      styles.otwMechanicMarkerPointer,
                      { borderTopColor: MECHANIC_PIN_ONLINE.bg },
                    ]}
                  />
                  <Callout>
                    <Text style={styles.otwCalloutText}>You</Text>
                  </Callout>
                </Marker>

                {canShowDirections && (
                  <MapViewDirections
                    origin={mechanicCoord}
                    destination={destination}
                    apikey={GOOGLE_MAPS_API_KEY}
                    strokeWidth={4}
                    strokeColor="#10B981"
                    mode="DRIVING"
                    optimizeWaypoints
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
                          result.duration < 1 ? "< 1 minute" : `${Math.round(result.duration)} min`,
                      });
                      setRouteError(null);
                      trackingMapRef.current?.fitToCoordinates([destination, mechanicCoord], {
                        edgePadding: { top: 80, right: 80, bottom: 80, left: 80 },
                        animated: true,
                      });
                    }}
                    onError={(errorMessage) => {
                      console.error("❌ Mechanic route error:", errorMessage);
                      setRouteError(
                        typeof errorMessage === "string" ? errorMessage : "Route unavailable",
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
              <View style={styles.otwLoadingMap}>
                <ActivityIndicator size="large" color={COLORS.dark} />
                <Text style={styles.otwLoadingMapText}>
                  {!destination ? "Loading customer location…" : "Getting your live location…"}
                </Text>
              </View>
            )}
          </View>

          {/* Bottom info card — customer details + Reached Location */}
          <View
            style={[
              styles.otwInfoCard,
              { paddingBottom: Math.max(16, insets.bottom + 12) },
            ]}
          >
            <View style={styles.otwCustomerRow}>
              <View style={styles.otwCustomerAvatar}>
                <Ionicons name="person" size={20} color={COLORS.white} />
              </View>
              <View style={styles.otwCustomerTextWrap}>
                <Text style={styles.otwCustomerName} numberOfLines={1}>
                  {trackingBooking.customer?.full_name || "Customer"}
                </Text>
                <Text style={styles.otwCustomerAddress} numberOfLines={2}>
                  {trackingBooking.customer_address || "Address not provided"}
                </Text>
              </View>
              {trackingBooking.customer?.phone && (
                <TouchableOpacity
                  style={styles.otwCallButton}
                  onPress={() => Linking.openURL(`tel:${trackingBooking.customer.phone}`)}
                  accessibilityLabel="Call customer"
                >
                  <Ionicons name="call" size={16} color={COLORS.dark} />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.otwServiceRow}>
              <View style={styles.otwServiceIconWrap}>
                <Ionicons name="construct-outline" size={16} color={COLORS.accent} />
              </View>
              <View style={styles.otwServiceTextWrap}>
                <Text style={styles.otwServiceName} numberOfLines={1}>
                  {trackingBooking.service?.name || "Roadside Assistance"}
                </Text>
                <Text style={styles.otwServiceSub} numberOfLines={1}>
                  {trackingBooking.vehicle_type || "Vehicle"}
                  {trackingBooking.vehicle_model ? ` · ${trackingBooking.vehicle_model}` : ""}
                </Text>
              </View>
              <Text style={styles.otwServicePrice}>₹{servicePrice}</Text>
            </View>

            {routeError && distanceKm !== null && (
              <Text style={styles.otwRouteErrorText}>Using estimated ETA (GPS only)</Text>
            )}

            <TouchableOpacity
              style={[styles.otwReachedButton, markingArrived && styles.disabledButton]}
              onPress={markReachedLocation}
              disabled={markingArrived}
            >
              {markingArrived ? (
                <ActivityIndicator color={COLORS.white} size="small" />
              ) : (
                <>
                  <Ionicons name="flag" size={18} color={COLORS.white} />
                  <Text style={styles.otwReachedButtonText}>Reached Location</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    );
  };

  // ==========================================================================
  // Render
  // ==========================================================================
  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={COLORS.dark} />
          <Text style={styles.loadingText}>Loading dashboard...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const incomingDistanceKm =
    incomingRequest?.customer_lat && incomingRequest?.customer_lng && currentLocation
      ? calculateDistance(currentLocation.lat, currentLocation.lng, incomingRequest.customer_lat, incomingRequest.customer_lng)
      : null;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      {/* ================================================================
          Ola/Rapido-style incoming request popup.
          Tapping anywhere on the request details (price/service/issue/
          meta) closes this popup and takes the mechanic to the
          Available Jobs list. Accept/Decline remain separate, explicit
          actions below.
      ================================================================= */}
      <Modal visible={!!incomingRequest} transparent animationType="slide">
        <View style={styles.incomingOverlay}>
          <View style={[styles.incomingCard, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.incomingCountdownRow}>
              <Text style={styles.incomingCountdownLabel}>New Request</Text>
              <View style={styles.incomingCountdownPill}>
                <Text style={styles.incomingCountdownText}>{incomingCountdown}s</Text>
              </View>
            </View>

            <View style={styles.incomingProgressTrack}>
              <View
                style={[
                  styles.incomingProgressFill,
                  { width: `${(incomingCountdown / INCOMING_REQUEST_TIMEOUT) * 100}%` },
                ]}
              />
            </View>

            <TouchableOpacity activeOpacity={0.7} onPress={goToAvailableJobs}>
              <View style={styles.incomingPriceRow}>
                <Text style={styles.incomingPrice}>₹{incomingRequest?.service?.base_price ?? incomingRequest?.service_price ?? 0}</Text>
                {incomingDistanceKm !== null && (
                  <View style={styles.incomingDistanceChip}>
                    <Ionicons name="navigate" size={12} color={COLORS.accent} />
                    <Text style={styles.incomingDistanceText}>{incomingDistanceKm.toFixed(1)} km away</Text>
                  </View>
                )}
              </View>

              <Text style={styles.incomingService}>{incomingRequest?.service?.name || "Road assistance needed"}</Text>
              <Text style={styles.incomingIssue}>{incomingRequest?.issue_note || "Road assistance needed"}</Text>

              {incomingRequest?.vehicle_type && (
                <Text style={styles.incomingMeta}>
                  🚗 {incomingRequest.vehicle_type} {incomingRequest?.vehicle_model ? `· ${incomingRequest.vehicle_model}` : ""}
                </Text>
              )}
              {incomingRequest?.customer_address && (
                <Text style={styles.incomingMeta}>📍 {incomingRequest.customer_address}</Text>
              )}

              <View style={styles.incomingTapHint}>
                <Ionicons name="list-outline" size={14} color={COLORS.muted} />
                <Text style={styles.incomingTapHintText}>Tap to view in Available Jobs</Text>
                <Ionicons name="chevron-forward" size={14} color={COLORS.muted} />
              </View>
            </TouchableOpacity>

            <View style={styles.incomingButtonsRow}>
              <TouchableOpacity style={styles.incomingDeclineButton} onPress={declineIncomingRequest} disabled={accepting}>
                <Text style={styles.incomingDeclineText}>Decline</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.incomingAcceptButton} onPress={acceptIncomingRequest} disabled={accepting}>
                <Text style={styles.incomingAcceptText}>{accepting ? "Accepting..." : "Accept"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Accept Job Modal (from Available list) */}
      <Modal visible={showAcceptModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Accept Job?</Text>
            <Text style={styles.modalText}>You are about to accept a service request from a customer.</Text>
            {selectedBooking && (
              <View style={styles.modalDetails}>
                <Text style={styles.modalDetailText}>Service: {selectedBooking.service?.name || "Roadside Assistance"}</Text>
                <Text style={styles.modalDetailText}>Price: ₹{selectedBooking.service?.base_price || 0}</Text>
                <Text style={styles.modalDetailText}>Issue: {selectedBooking.issue_note || "Not specified"}</Text>
              </View>
            )}
            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.modalButton, styles.modalCancelButton]} onPress={() => setShowAcceptModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalButton, styles.modalAcceptButton]} onPress={confirmAcceptJob} disabled={accepting}>
                <Text style={styles.modalAcceptText}>{accepting ? "Accepting..." : "Accept"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* "On The Way" in-app tracking screen (map, ETA, Reached Location) */}
      {renderTrackingScreen()}

      {/* OTP Modal — mechanic enters OTP */}
      <Modal visible={showOTPModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { width: "90%", maxWidth: 400 }]}>
            <View style={styles.otpHeader}>
              <Ionicons name="key" size={50} color={COLORS.accent} />
              <Text style={styles.modalTitle}>Complete Service</Text>
            </View>

            <View style={styles.otpDivider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>ENTER CODE FROM CUSTOMER</Text>
              <View style={styles.dividerLine} />
            </View>

            {otpGenerating ? (
              <View style={styles.otpGeneratingBox}>
                <ActivityIndicator size="small" color={COLORS.accent} />
                <Text style={styles.otpGeneratingText}>Generating pin for the customer…</Text>
              </View>
            ) : (
              <>
                <Text style={styles.otpInstruction}>Ask the customer for the 6-digit code and enter it below:</Text>

                <TextInput
                  style={styles.otpInputField}
                  placeholder="Enter 6-digit OTP"
                  placeholderTextColor={COLORS.muted}
                  value={enteredOTP}
                  onChangeText={setEnteredOTP}
                  keyboardType="number-pad"
                  maxLength={6}
                  textAlign="center"
                  autoFocus
                />
              </>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalCancelButton]}
                onPress={() => {
                  setShowOTPModal(false);
                  setEnteredOTP("");
                  setGeneratedOTP("");
                  setOtpBookingId(null);
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.modalButton,
                  styles.modalAcceptButton,
                  (otpGenerating || !enteredOTP || enteredOTP.length !== 6) && styles.disabledButton,
                ]}
                onPress={() => verifyMechanicOTP(activeBooking?.id, enteredOTP)}
                disabled={otpGenerating || !enteredOTP || enteredOTP.length !== 6 || verifyingOTP}
              >
                <Text style={styles.modalAcceptText}>{verifyingOTP ? "Verifying..." : "Verify & Complete"}</Text>
              </TouchableOpacity>
            </View>

            {!otpGenerating && !generatedOTP && activeBooking?.status === "arrived" && (
              <TouchableOpacity style={styles.refreshOtpButton} onPress={() => generateOTPForCompletion(activeBooking?.id)}>
                <Ionicons name="refresh-outline" size={16} color={COLORS.accent} />
                <Text style={styles.refreshOtpText}>Generate OTP First</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* Rate Customer Modal */}
      <Modal visible={showRatingModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { width: "90%" }]}>
            <Text style={styles.modalTitle}>Rate Customer</Text>
            <Text style={styles.modalText}>How was your experience with this customer?</Text>

            <View style={styles.ratingContainer}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity key={star} onPress={() => setCustomerRating(star)} style={styles.starButton}>
                  <Ionicons name={star <= customerRating ? "star" : "star-outline"} size={40} color={COLORS.accent} />
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={styles.reviewInput}
              placeholder="Share your experience (optional)"
              placeholderTextColor={COLORS.muted}
              value={customerReview}
              onChangeText={setCustomerReview}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalCancelButton]}
                onPress={() => {
                  setShowRatingModal(false);
                  setCustomerRating(0);
                  setCustomerReview("");
                }}
              >
                <Text style={styles.modalCancelText}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalButton, styles.modalAcceptButton]} onPress={submitCustomerRating}>
                <Text style={styles.modalAcceptText}>Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Ratings Detail Modal — only ever opened for a booking that has a
          customer_rating (see the ratingSummary gate on the job card), so
          this always has a rating to show; no "No rating yet" state needed. */}
      <Modal visible={showRatingsDetailModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalScrollContent}>
            <View style={[styles.modalContent, styles.ratingsModalContent]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Ratings & Reviews</Text>
                <TouchableOpacity
                  onPress={() => setShowRatingsDetailModal(false)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="close" size={22} color={COLORS.muted} />
                </TouchableOpacity>
              </View>

              {selectedRatingsBooking && selectedRatingsBooking.customer_rating && (
                <View style={styles.ratingsBody}>
                  <View style={styles.bookingInfo}>
                    <View>
                      <Text style={styles.bookingInfoLabel}>Booking</Text>
                      <Text style={styles.bookingInfoText}>#{selectedRatingsBooking.id.slice(0, 8)}</Text>
                    </View>
                    <Text style={styles.bookingInfoDate}>
                      {new Date(selectedRatingsBooking.created_at).toLocaleDateString(undefined, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </Text>
                  </View>

                  <View style={styles.ratingSection}>
                    <View style={styles.ratingSectionHeaderRow}>
                      <Ionicons name="person-circle-outline" size={18} color={COLORS.dark} />
                      <Text style={styles.ratingSectionHeaderText}>Customer's rating of you</Text>
                    </View>

                    <View style={styles.ratingScoreRow}>
                      {renderStars(selectedRatingsBooking.customer_rating)}
                      <Text style={styles.ratingScoreValue}>
                        {selectedRatingsBooking.customer_rating.toFixed(1)}
                      </Text>
                    </View>

                    {selectedRatingsBooking.customer_review ? (
                      <View style={styles.reviewContainer}>
                        <Ionicons name="chatbox-ellipses-outline" size={16} color={COLORS.muted} />
                        <Text style={styles.reviewText}>{selectedRatingsBooking.customer_review}</Text>
                      </View>
                    ) : (
                      <Text style={styles.noReviewText}>No written review left for this booking.</Text>
                    )}
                  </View>

                  <TouchableOpacity style={styles.closeRatingsButton} onPress={() => setShowRatingsDetailModal(false)}>
                    <Text style={styles.closeRatingsButtonText}>Close</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ================================================================
          Main content
      ================================================================= */}
      <View style={{ flex: 1 }}>
        {activeTab === "home" && renderHome()}
        {activeTab === "bookings" && renderBookings()}
        {activeTab === "earnings" && renderAnalytics()}
        {activeTab === "profile" && renderProfile()}
      </View>

      {/* Bottom nav — Home / Bookings / Earnings / Profile
          paddingBottom includes the device's safe-area inset so this bar
          always sits above Android's gesture/3-button nav and iOS's home
          indicator instead of being covered by them. */}
      <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
        <TouchableOpacity style={styles.bottomNavItem} onPress={() => setActiveTab("home")}>
          <View style={styles.bottomNavIconWrap}>
            <Ionicons name={activeTab === "home" ? "home" : "home-outline"} size={22} color={activeTab === "home" ? COLORS.dark : COLORS.muted} />
          </View>
          <Text style={[styles.bottomNavText, activeTab === "home" && styles.bottomNavTextActive]}>Home</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.bottomNavItem} onPress={() => setActiveTab("bookings")}>
          <View style={styles.bottomNavIconWrap}>
            <Ionicons
              name={activeTab === "bookings" ? "calendar" : "calendar-outline"}
              size={22}
              color={activeTab === "bookings" ? COLORS.dark : COLORS.muted}
            />
            {online && jobs.length > 0 && <View style={styles.bottomNavBadge} />}
          </View>
          <Text style={[styles.bottomNavText, activeTab === "bookings" && styles.bottomNavTextActive]}>Bookings</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.bottomNavItem} onPress={() => setActiveTab("earnings")}>
          <View style={styles.bottomNavIconWrap}>
            <Ionicons
              name={activeTab === "earnings" ? "flash" : "flash-outline"}
              size={22}
              color={activeTab === "earnings" ? COLORS.dark : COLORS.muted}
            />
          </View>
          <Text style={[styles.bottomNavText, activeTab === "earnings" && styles.bottomNavTextActive]}>Earnings</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.bottomNavItem} onPress={() => setActiveTab("profile")}>
          <View style={styles.bottomNavIconWrap}>
            <Ionicons
              name={activeTab === "profile" ? "person" : "person-outline"}
              size={22}
              color={activeTab === "profile" ? COLORS.dark : COLORS.muted}
            />
          </View>
          <Text style={[styles.bottomNavText, activeTab === "profile" && styles.bottomNavTextActive]}>Profile</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ==========================================================================
// Styles
// ==========================================================================
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.white },
  centerContent: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { marginTop: 12, fontSize: 14, color: COLORS.muted },
  content: { padding: 16 },

  // ---- Home ----
  homeContainer: { flex: 1, backgroundColor: COLORS.white, paddingHorizontal: 20 },
  homeHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginTop: 12,
    marginBottom: 20,
  },
  homeGreeting: { fontSize: 14, color: COLORS.muted, marginBottom: 6 },
  homeHeadline: { fontSize: 26, fontWeight: "800", color: COLORS.dark, lineHeight: 32 },
  homeHeadlineAccent: { color: COLORS.accent },
  homeBellButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.tint,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },

  onlineStatusCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.tint,
  },
  onlineStatusLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  onlineStatusDot: { width: 12, height: 12, borderRadius: 6 },
  onlineStatusTitle: { fontSize: 15, fontWeight: "700", color: COLORS.dark },
  onlineStatusSubtitle: { fontSize: 12, color: COLORS.muted, marginTop: 2 },

  newRequestsBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.dark,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  newRequestsLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  newRequestsIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  newRequestsText: { color: COLORS.white, fontWeight: "700", fontSize: 13, flexShrink: 1 },

  homeSectionLabel: { fontSize: 14, fontWeight: "700", color: COLORS.dark, marginBottom: 12 },

  overviewGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 20 },
  overviewCard: {
    width: "47%",
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.tint,
  },
  overviewValue: { fontSize: 22, fontWeight: "800", color: COLORS.dark },
  overviewLabel: { fontSize: 12, color: COLORS.muted, marginTop: 6 },

  trendCard: {
    backgroundColor: COLORS.white,
    borderRadius: 18,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: COLORS.tint,
  },
  trendCardHeader: { marginBottom: 4 },
  trendAmount: { fontSize: 24, fontWeight: "800", color: COLORS.dark, marginBottom: 12 },
  trendBarsRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, height: 50 },
  trendBarWrap: { flex: 1, height: 50, alignItems: "center", justifyContent: "flex-end" },
  trendBar: { width: "100%", backgroundColor: COLORS.tint, borderRadius: 6 },
  trendBarActive: { backgroundColor: COLORS.accent },
  trendLabelsRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  trendBarLabel: { flex: 1, textAlign: "center", fontSize: 10, fontWeight: "600", color: COLORS.muted },
  trendBarLabelActive: { color: COLORS.accent },
  trendLoadingBox: { height: 50, alignItems: "center", justifyContent: "center" },
  trendEmptyText: { fontSize: 12, color: COLORS.muted, textAlign: "center", paddingVertical: 14 },

  quickLinksRow: { flexDirection: "row", gap: 12, marginBottom: 12 },
  quickLinkCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.tint,
  },
  quickLinkText: { fontSize: 12, fontWeight: "600", color: COLORS.dark },

  // ---- Bookings sub-tabs ----
  subTabBar: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    backgroundColor: COLORS.white,
  },
  subTab: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 6,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.tint,
    alignItems: "center",
    justifyContent: "center",
  },
  subTabActive: { backgroundColor: COLORS.dark, borderColor: COLORS.dark },
  subTabText: { fontSize: 13, fontWeight: "600", color: COLORS.muted, textAlign: "center" },
  subTabTextActive: { color: COLORS.white },

  offlineNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.tint,
    marginHorizontal: 16,
    marginTop: 4,
    padding: 10,
    borderRadius: 10,
  },
  offlineNoticeText: { fontSize: 12, color: COLORS.accent, flexShrink: 1 },

  requestTopRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  requestPriceChip: { backgroundColor: COLORS.dark, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  requestPriceChipText: { color: COLORS.white, fontWeight: "700", fontSize: 13 },
  requestDistanceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.tint,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  requestDistanceChipText: { color: COLORS.accent, fontWeight: "600", fontSize: 12 },

  // ---- Bottom nav ----
  bottomNav: {
    flexDirection: "row",
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: COLORS.tint,
    paddingTop: 10,
    alignItems: "flex-start",
  },
  bottomNavItem: { flex: 1, alignItems: "center", gap: 4 },
  bottomNavIconWrap: { position: "relative", alignItems: "center", justifyContent: "center" },
  bottomNavText: { fontSize: 11, color: COLORS.muted, fontWeight: "600" },
  bottomNavTextActive: { color: COLORS.dark },
  bottomNavBadge: {
    position: "absolute",
    top: -2,
    right: -6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.accent,
  },

  // ---- Incoming request popup (Ola/Rapido style) ----
  incomingOverlay: { flex: 1, backgroundColor: "rgba(6,63,71,0.55)", justifyContent: "flex-end" },
  incomingCard: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
  },
  incomingCountdownRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  incomingCountdownLabel: { fontSize: 12, fontWeight: "700", color: COLORS.muted, letterSpacing: 1 },
  incomingCountdownPill: { backgroundColor: COLORS.tint, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  incomingCountdownText: { color: COLORS.accent, fontWeight: "800", fontSize: 13 },
  incomingProgressTrack: { height: 4, backgroundColor: COLORS.tint, borderRadius: 2, marginBottom: 20, overflow: "hidden" },
  incomingProgressFill: { height: 4, backgroundColor: COLORS.accent, borderRadius: 2 },
  incomingPriceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  incomingPrice: { fontSize: 32, fontWeight: "800", color: COLORS.dark },
  incomingDistanceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.tint,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  incomingDistanceText: { color: COLORS.accent, fontWeight: "700", fontSize: 12 },
  incomingService: { fontSize: 16, fontWeight: "700", color: COLORS.dark, marginBottom: 4 },
  incomingIssue: { fontSize: 13, color: COLORS.muted, marginBottom: 8 },
  incomingMeta: { fontSize: 13, color: COLORS.muted, marginTop: 4 },
  incomingTapHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.tint,
  },
  incomingTapHintText: { fontSize: 12, color: COLORS.muted, fontWeight: "600" },
  incomingButtonsRow: { flexDirection: "row", gap: 12, marginTop: 20 },
  incomingDeclineButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    backgroundColor: COLORS.tint,
  },
  incomingDeclineText: { color: COLORS.muted, fontWeight: "700", fontSize: 15 },
  incomingAcceptButton: {
    flex: 1.4,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    backgroundColor: COLORS.accent,
  },
  incomingAcceptText: { color: COLORS.white, fontWeight: "800", fontSize: 15 },

  card: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.tint,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: "800", color: COLORS.dark, flex: 1 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: COLORS.tint },
  completedBadge: { backgroundColor: COLORS.tint },
  cancelledBadge: { backgroundColor: COLORS.muted },
  acceptedBadge: { backgroundColor: COLORS.tint },
  onWayBadge: { backgroundColor: COLORS.dark },
  arrivedBadge: { backgroundColor: COLORS.accent },
  statusBadgeText: { fontSize: 10, fontWeight: "700", color: COLORS.dark },
  statusBadgeTextLight: { color: COLORS.white },

  cardMeta: { fontSize: 13, color: COLORS.muted, marginTop: 6 },
  distanceText: { fontSize: 12, color: COLORS.accent, marginTop: 6, fontWeight: "500" },

  ratingSummary: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: COLORS.white,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.tint,
  },
  ratingSummaryLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  ratingSummaryStarWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.tint,
    alignItems: "center",
    justifyContent: "center",
  },
  ratingSummaryText: { fontSize: 13, fontWeight: "600", color: COLORS.dark },
  ratingSummaryRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  mechanicRatingBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.tint,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  mechanicRatingText: { fontSize: 11, fontWeight: "600", color: COLORS.accent },

  acceptButton: {
    backgroundColor: COLORS.dark,
    padding: 14,
    borderRadius: 12,
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  acceptButtonText: { color: COLORS.white, fontWeight: "700", textAlign: "center" },

  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  smallBtn: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
  },
  primaryBtn: { backgroundColor: COLORS.dark },
  otpBtn: { backgroundColor: COLORS.accent },
  completeBtn: { backgroundColor: COLORS.dark },
  disabledButton: { opacity: 0.5, backgroundColor: COLORS.muted },
  smallBtnText: { fontWeight: "700", fontSize: 12, color: COLORS.white },

  emptyState: { padding: 48, alignItems: "center" },
  emptyStateText: { fontSize: 16, fontWeight: "600", color: COLORS.muted, marginTop: 12 },
  emptyStateSubtext: { fontSize: 14, color: COLORS.muted, textAlign: "center", marginTop: 8 },

  modalOverlay: { flex: 1, backgroundColor: "rgba(6,63,71,0.55)", justifyContent: "center", alignItems: "center" },
  modalScrollContent: { flexGrow: 1, justifyContent: "center", padding: 20 },
  modalContent: { backgroundColor: COLORS.white, borderRadius: 20, padding: 24, width: "85%", maxWidth: 400 },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.tint,
    marginBottom: 16,
  },
  modalTitle: { fontSize: 20, fontWeight: "700", color: COLORS.dark, textAlign: "center" },
  modalText: { fontSize: 14, color: COLORS.muted, marginBottom: 16, textAlign: "center" },
  modalDetails: { backgroundColor: COLORS.tint, padding: 12, borderRadius: 8, marginBottom: 20 },
  modalDetailText: { fontSize: 13, color: COLORS.dark, marginBottom: 4 },
  modalButtons: { flexDirection: "row", gap: 12, marginTop: 16 },
  modalButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  modalCancelButton: { backgroundColor: COLORS.tint },
  modalCancelText: { color: COLORS.muted, fontWeight: "600" },
  modalAcceptButton: { backgroundColor: COLORS.dark },
  modalAcceptText: { color: COLORS.white, fontWeight: "600" },

  otpHeader: { alignItems: "center", marginBottom: 16 },
  otpDivider: { flexDirection: "row", alignItems: "center", marginVertical: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: COLORS.tint },
  dividerText: { marginHorizontal: 12, fontSize: 11, color: COLORS.muted, fontWeight: "600" },
  otpInstruction: { fontSize: 14, color: COLORS.muted, textAlign: "center", marginBottom: 12 },
  otpGeneratingBox: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.tint,
    borderRadius: 12,
    paddingVertical: 24,
    marginBottom: 16,
    gap: 10,
  },
  otpGeneratingText: { fontSize: 13, color: COLORS.accent, fontWeight: "600" },
  otpInputField: {
    backgroundColor: COLORS.tint,
    borderRadius: 12,
    padding: 16,
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: 8,
    textAlign: "center",
    marginVertical: 16,
    borderWidth: 1,
    borderColor: COLORS.tint,
    color: COLORS.dark,
  },
  refreshOtpButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 16, padding: 8 },
  refreshOtpText: { fontSize: 13, color: COLORS.accent, fontWeight: "500" },

  ratingContainer: { flexDirection: "row", justifyContent: "center", marginVertical: 20 },
  starButton: { padding: 8 },
  reviewInput: { backgroundColor: COLORS.tint, borderRadius: 8, padding: 12, minHeight: 80, marginBottom: 20, fontSize: 14, color: COLORS.dark },

  ratingsModalContent: { width: "90%", maxWidth: 460, padding: 20 },
  ratingsBody: { paddingTop: 4 },
  bookingInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: COLORS.tint,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  bookingInfoLabel: { fontSize: 11, color: COLORS.muted, fontWeight: "600", marginBottom: 2 },
  bookingInfoText: { fontSize: 14, fontWeight: "700", color: COLORS.dark },
  bookingInfoDate: { fontSize: 12, color: COLORS.muted, fontWeight: "500" },
  ratingSection: {
    borderWidth: 1,
    borderColor: COLORS.tint,
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
  },
  ratingSectionHeaderRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  ratingSectionHeaderText: { fontSize: 13, fontWeight: "700", color: COLORS.dark },
  ratingScoreRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  ratingScoreValue: { fontSize: 16, fontWeight: "800", color: COLORS.dark },
  ratingText: { fontSize: 12, fontWeight: "700", color: COLORS.accent, marginLeft: 4 },
  reviewContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: COLORS.tint,
    borderRadius: 10,
    padding: 12,
  },
  reviewText: { flex: 1, fontSize: 13, color: COLORS.dark, lineHeight: 19 },
  noReviewText: { fontSize: 12, color: COLORS.muted, fontStyle: "italic" },
  closeRatingsButton: { backgroundColor: COLORS.dark, paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  closeRatingsButtonText: { color: COLORS.white, fontSize: 15, fontWeight: "700" },
  navigateBtn: { backgroundColor: COLORS.dark },
  locationCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.white,
    padding: 12,
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.tint,
  },
  locationCardLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  locationIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.tint,
    justifyContent: "center",
    alignItems: "center",
  },
  locationCardTitle: { fontSize: 13, fontWeight: "600", color: COLORS.dark },
  locationCardAddress: { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  locationCardRight: { paddingLeft: 8 },
  navigateText: { fontSize: 12, fontWeight: "600", color: COLORS.accent },

  // ---- Profile ----
  profileContainer: { flex: 1, backgroundColor: COLORS.white },
  profileHeader: { alignItems: "center", backgroundColor: COLORS.white, paddingVertical: 24, borderBottomWidth: 1, borderBottomColor: COLORS.tint },
  profileAvatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.dark,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  profileName: { fontSize: 22, fontWeight: "700", color: COLORS.dark, marginBottom: 4 },
  profileEmail: { fontSize: 14, color: COLORS.muted, marginBottom: 8 },
  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.tint,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 16,
    gap: 4,
  },
  verifiedText: { fontSize: 12, color: COLORS.accent, fontWeight: "600" },
  statsGrid: { flexDirection: "row", justifyContent: "space-around", paddingVertical: 20, backgroundColor: COLORS.white, marginTop: 8 },
  statCard: { alignItems: "center" },
  statValue: { fontSize: 20, fontWeight: "800", color: COLORS.dark, marginTop: 8 },
  statLabel: { fontSize: 12, color: COLORS.muted, marginTop: 4 },
  infoSection: { backgroundColor: COLORS.white, marginTop: 12, padding: 20 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: COLORS.dark, marginBottom: 16 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  infoText: { fontSize: 14, color: COLORS.muted, flex: 1 },
  serviceCard: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.tint },
  serviceInfo: { flex: 1 },
  serviceName: { fontSize: 16, fontWeight: "600", color: COLORS.dark, marginBottom: 4 },
  serviceDescription: { fontSize: 12, color: COLORS.muted },
  servicePrice: { alignItems: "flex-end" },
  priceText: { fontSize: 16, fontWeight: "700", color: COLORS.accent },
  customPriceBadge: { fontSize: 10, color: COLORS.accent, marginTop: 2 },
  noServicesText: { fontSize: 14, color: COLORS.muted, textAlign: "center", paddingVertical: 20 },

  input: { backgroundColor: COLORS.tint, borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 14, color: COLORS.dark },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  serviceSelectionCard: { marginBottom: 16, padding: 12, backgroundColor: COLORS.tint, borderRadius: 8 },
  serviceCheckbox: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  serviceCheckboxInfo: { flex: 1 },
  serviceCheckboxName: { fontSize: 14, fontWeight: "600", color: COLORS.dark, marginBottom: 4 },
  serviceCheckboxDesc: { fontSize: 12, color: COLORS.muted, marginBottom: 4 },
  defaultPrice: { fontSize: 11, color: COLORS.accent },
  saveButton: { backgroundColor: COLORS.dark, padding: 16, borderRadius: 12, alignItems: "center", marginTop: 20 },
  saveButtonText: { color: COLORS.white, fontSize: 16, fontWeight: "600" },

  // ---- Analytics / Earnings (redesigned) ----
  analyticsContainer: { flex: 1, backgroundColor: COLORS.white },

  analyticsHeaderRow: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 4 },
  analyticsHeaderTitle: { fontSize: 24, fontWeight: "800", color: COLORS.dark },
  analyticsHeaderSubtitle: { fontSize: 13, color: COLORS.muted, marginTop: 4 },

  earningsHeroCard: {
    backgroundColor: COLORS.dark,
    borderRadius: 22,
    marginHorizontal: 20,
    marginTop: 16,
    padding: 20,
  },
  earningsHeroLabel: { fontSize: 13, color: COLORS.tint, fontWeight: "700", letterSpacing: 0.5 },
  earningsHeroAmount: { fontSize: 38, fontWeight: "800", color: COLORS.white, marginTop: 6 },
  earningsHeroFooterRow: {
    flexDirection: "row",
    gap: 20,
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.15)",
  },
  earningsHeroFooterItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  earningsHeroFooterText: { fontSize: 12, color: COLORS.tint, fontWeight: "600" },

  earningsSplitRow: { flexDirection: "row", gap: 12, paddingHorizontal: 20, marginTop: 14 },
  earningsSplitCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.tint,
  },
  earningsSplitIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.tint,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  earningsSplitLabel: { fontSize: 12, color: COLORS.muted, fontWeight: "600" },
  earningsSplitAmount: { fontSize: 20, fontWeight: "800", color: COLORS.dark, marginTop: 2 },
  earningsSplitSub: { fontSize: 11, color: COLORS.muted, marginTop: 2 },

  statsSection: { paddingHorizontal: 20, marginTop: 28 },
  serviceStatCard: {
    marginBottom: 12,
    padding: 14,
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.tint,
  },
  serviceStatHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8 },
  serviceStatName: { fontSize: 15, fontWeight: "700", color: COLORS.dark, flex: 1 },
  serviceStatRatingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.tint,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  serviceStatProgressTrack: { height: 6, backgroundColor: COLORS.tint, borderRadius: 3, overflow: "hidden", marginBottom: 10 },
  serviceStatProgressFill: { height: 6, backgroundColor: COLORS.accent, borderRadius: 3 },
  serviceStatDetails: { flexDirection: "row", gap: 16 },
  serviceStatItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  serviceStatValue: { fontSize: 12, color: COLORS.muted, fontWeight: "500" },
  emptyStatsBox: { alignItems: "center", paddingVertical: 32, gap: 10 },
  noStatsText: { fontSize: 13, color: COLORS.muted },

  quickStatsGrid: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  quickStat: {
    flex: 1,
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderRadius: 16,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: COLORS.tint,
  },
  quickStatIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.tint,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  quickStatValue: { fontSize: 20, fontWeight: "800", color: COLORS.dark },
  quickStatLabel: { fontSize: 11, color: COLORS.muted, marginTop: 4 },

  // ==========================================================================
  // "On The Way" tracking screen (Start & Navigate → in-app map)
  // ==========================================================================
  otwContainer: { flex: 1, backgroundColor: COLORS.white },
  otwHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.tint,
  },
  otwHeaderIconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.tint,
    justifyContent: "center",
    alignItems: "center",
  },
  otwHeaderTitle: { fontSize: 16, fontWeight: "800", color: COLORS.dark },

  otwEtaCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.white,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.tint,
  },
  otwEtaTextWrap: { flex: 1 },
  otwEtaLabel: { fontSize: 13, color: COLORS.muted, fontWeight: "600" },
  otwEtaValue: { fontSize: 30, fontWeight: "800", color: COLORS.dark, marginTop: 2 },
  otwEtaDistance: { fontSize: 12, color: COLORS.accent, fontWeight: "600", marginTop: 4 },
  otwEtaRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 3,
    borderColor: COLORS.dark,
    borderRightColor: COLORS.tint,
    borderBottomColor: COLORS.tint,
    backgroundColor: COLORS.white,
    justifyContent: "center",
    alignItems: "center",
  },

  otwMapContainer: { flex: 1, backgroundColor: COLORS.tint },
  otwMap: { flex: 1 },
  otwLoadingMap: { flex: 1, justifyContent: "center", alignItems: "center" },
  otwLoadingMapText: { marginTop: 12, fontSize: 13, color: COLORS.muted },

  // ✅ Same hard-hat pin + pointer shape used in tabs/customer.tsx
  // (mechanicMarkerPin / mechanicMarkerPointer), reproduced here so the
  // mechanic's own marker on THIS screen is visually identical.
  otwMechanicMarkerPin: {
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
  otwMechanicMarkerPointer: {
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
  otwCalloutText: { fontSize: 12, fontWeight: "600", color: COLORS.dark },

  otwInfoCard: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    marginTop: -18,
    paddingHorizontal: 16,
    paddingTop: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 6,
  },
  otwCustomerRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  otwCustomerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.dark,
    justifyContent: "center",
    alignItems: "center",
  },
  otwCustomerTextWrap: { flex: 1, marginLeft: 12, marginRight: 8 },
  otwCustomerName: { fontSize: 15, fontWeight: "700", color: COLORS.dark },
  otwCustomerAddress: { fontSize: 12, color: COLORS.muted, marginTop: 2, lineHeight: 16 },
  otwCallButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.tint,
    justifyContent: "center",
    alignItems: "center",
  },
  otwServiceRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.tint,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  otwServiceIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.white,
    justifyContent: "center",
    alignItems: "center",
  },
  otwServiceTextWrap: { flex: 1, marginLeft: 10, marginRight: 8 },
  otwServiceName: { fontSize: 13, fontWeight: "700", color: COLORS.dark },
  otwServiceSub: { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  otwServicePrice: { fontSize: 15, fontWeight: "800", color: COLORS.accent },
  otwRouteErrorText: { fontSize: 11, color: "#EF4444", textAlign: "center", marginBottom: 8 },
  otwReachedButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.accent,
    paddingVertical: 16,
    borderRadius: 16,
    marginTop: 4,
  },
  otwReachedButtonText: { color: COLORS.white, fontSize: 15, fontWeight: "800" },
});