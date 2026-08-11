/* eslint-disable react/no-unescaped-entities */
import { useEffect, useState, useCallback, useRef } from "react";
import {
  Alert,
  FlatList,
  SafeAreaView,
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
} from "react-native";
import * as Location from "expo-location";
import { api } from "@/lib/api";
import { Booking } from "@/types";
import { useAuth } from "@/context/AuthContext";
import { router } from "expo-router";
import { socket, socketService } from "@/lib/socket";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";

// Types
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

// Distance calculation function
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

export default function MechanicDashboard() {
  const [jobs, setJobs] = useState<Booking[]>([]);
  const [myJobs, setMyJobs] = useState<Booking[]>([]);
  const [online, setOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"available" | "myJobs" | "profile" | "analytics">(
    "available",
  );
  const [currentLocation, setCurrentLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<any | null>(null);
  const [showAcceptModal, setShowAcceptModal] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const { user, logout } = useAuth();
  const [showOTPModal, setShowOTPModal] = useState(false);
  const [generatedOTP, setGeneratedOTP] = useState("");
  // ✅ NEW — tracks WHICH booking the current `generatedOTP` belongs to.
  // Without this, a pin generated for one job could be silently reused
  // (or assumed to already exist) for a different job once the mechanic
  // moves on to their next customer.
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
  const [todayEarnings, setTodayEarnings] = useState(0);
  const [todaysJobsCount, setTodaysJobsCount] = useState(0);
  const [weeklyEarnings, setWeeklyEarnings] = useState(0);
  const [monthlyEarnings, setMonthlyEarnings] = useState(0);
  const [totalJobsCompleted, setTotalJobsCompleted] = useState(0);
  const [serviceStats, setServiceStats] = useState<ServiceStats[]>([]);
  const [activeBooking, setActiveBooking] = useState<any | null>(null);
  
  // Profile states
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
  
  // Sound related states
  const soundRef = useRef<Audio.Sound | null>(null);

  // Function to play beep sound
  const playBeepSound = async () => {
    try {
      if (soundRef.current) {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }

      if (Platform.OS === 'web') {
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
            require('@/assets/ring.mp3'),
            { shouldPlay: true, volume: 1.0, isLooping: false }
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

  function calculateETA(
    mechanicLat: number,
    mechanicLng: number,
    customerLat: number,
    customerLng: number,
  ): number {
    const distance = calculateDistance(
      mechanicLat,
      mechanicLng,
      customerLat,
      customerLng,
    );
    const etaMinutes = Math.ceil((distance / 30) * 60);
    return Math.min(etaMinutes, 30);
  }

  async function fetchTodayEarnings() {
    try {
      const today = new Date().toISOString().split("T")[0];
      const { data } = await api.get(
        `/bookings/mechanic/${user?.id}/earnings`,
        {
          params: { date: today },
        },
      );
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

  // ---------------------------------------------------------------------
  // ✅ FIX — generates a fresh OTP/pin for the given booking and marks
  // (via otpBookingId) which booking it belongs to. This is the ONLY
  // place that talks to the "generate-otp" endpoint, so every path that
  // needs a pin (the explicit "Generate OTP" button AND "Complete
  // Service" below) always goes through here and the customer always
  // actually receives the pin before the mechanic can verify it.
  //
  // ✅ NEW — this is also the ONLY moment the customer's app is told a
  // pin exists ("otp:generated" socket event below). Arriving at the
  // customer's location no longer implies a pin was generated — the
  // customer's OTP screen stays closed until the mechanic actually taps
  // "Generate OTP" or "Complete Service" here. This is the single
  // trigger the customer app listens for to pop the "Service
  // Completion" screen — see the "otp:generated" listener in
  // tabs/customer.tsx. Simply marking a job "Arrived" never opens it.
  //
  // ✅ FIX — previously this called `socket.emit(...)` directly, but
  // `socket` here is typed as `SocketService` (the same wrapper class as
  // `socketService`), which does not expose a generic `.emit` method —
  // that's what was causing the
  // "Property 'emit' does not exist on type 'SocketService'" build
  // error. We now go through the same `socketService.<namedMethod>(...)`
  // pattern used everywhere else in this file (e.g.
  // `socketService.updateBookingStatus`, `socketService.acceptBooking`)
  // via `socketService.emitOtpGenerated(...)`. Add a matching
  // `emitOtpGenerated(bookingId: string, mechanicId?: string)` method to
  // the `SocketService` class in `lib/socket.ts` (it should simply do
  // `this.socket.emit("otp:generated", { bookingId, mechanicId })`
  // internally) if it isn't already there.
  // ---------------------------------------------------------------------
  async function generateOTPForCompletion(bookingId: string) {
    setOtpGenerating(true);
    try {
      const response = await api.post(
        `/bookings/${bookingId}/generate-otp`,
        {},
      );
      if (response.data.success) {
        const generatedOtp = response.data.otp;
        setGeneratedOTP(generatedOtp);
        setOtpBookingId(bookingId);
        setShowOTPModal(true);

        // ✅ Notify the customer in real time that a pin now exists for
        // this booking, so their app can fetch and display it right
        // away instead of waiting on a background poll. This is the
        // ONLY event that should cause the customer's OTP/"Service
        // Completion" modal to open.
        socketService.emitOtpGenerated(bookingId, user?.id);

        Alert.alert(
          "🔐 OTP Generated",
          `Share this OTP with the customer:\n\n${generatedOtp}\n\n⚠️ This OTP will expire in 10 minutes.\n\nThen ask the customer for the code and enter it below.`,
          [{ text: "OK" }],
        );
      }
    } catch (error: any) {
      Alert.alert(
        "Error",
        error.response?.data?.error || "Failed to generate OTP",
      );
    } finally {
      setOtpGenerating(false);
    }
  }

  // ---------------------------------------------------------------------
  // ✅ FIX — this is what actually runs when "Complete Service" is
  // tapped for an "arrived" job. Previously that button just opened the
  // empty OTP-entry modal and relied on the mechanic having separately
  // pressed "Generate OTP" first — if they hadn't, the customer never
  // received a pin at all and there was no way to complete the job.
  //
  // Now: if a pin has already been generated FOR THIS EXACT BOOKING
  // (otpBookingId === booking.id) we just reopen the entry modal: no
  // need to burn a second OTP. Otherwise we generate one right now, which
  // pushes the pin to the customer and opens the modal automatically —
  // so tapping "Complete Service" always results in the customer having
  // the pin, every time.
  // ---------------------------------------------------------------------
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
        mechanicId: user?.id,
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
                // ✅ Clear the pin state now that this booking is
                // "completed" — a fresh pin will be generated next time,
                // instead of a stale one carrying over to the next job.
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
        error.response?.data?.error || "Invalid OTP. Please try again.",
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
      await api.post(
        `/bookings/${selectedCompletedBooking.id}/mechanic-rating`,
        {
          rating: customerRating,
          review: customerReview.trim() || undefined,
        },
      );

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
        error.response?.data?.error || "Failed to submit rating",
      );
    }
  }

  // ---------------------------------------------------------------------
  // ✅ FIX — tapping "Arrived" now ONLY updates the booking status (and,
  // via socketService.updateBookingStatus below, lets the customer's app
  // track that GPS/status change). It no longer auto-generates an OTP,
  // and — because generation is the only thing that emits
  // "otp:generated" — it can never cause the customer's "Service
  // Completion" popup to appear on its own. The OTP is generated — and
  // only then pushed to the customer — the moment the mechanic
  // explicitly taps "Generate OTP" or "Complete Service" (see
  // generateOTPForCompletion / startCompleteService above). This keeps
  // "arrived" and "OTP ready" as two clearly separate moments for both
  // sides.
  // ---------------------------------------------------------------------
  async function updateStatus(
    bookingId: string,
    status: "on_the_way" | "arrived" | "completed",
  ) {
    try {
      const response = await api.patch(`/bookings/${bookingId}/status`, {
        status,
      });
      const updatedBooking = response.data;
      console.log(
        `Booking ${bookingId} status updated to ${status}:`,
        updatedBooking,
      );

      socketService.updateBookingStatus(bookingId, status);

      if (status === "completed") {
        await fetchTodayEarnings();
        await fetchAnalytics();
      }

      Alert.alert("Updated", `Booking marked as ${status.replace("_", " ")}.`);
      await loadMyJobs();
    } catch (error) {
      console.error("Failed to update status:", error);
      Alert.alert("Error", "Failed to update status");
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
        <Ionicons
          key={i}
          name={i <= rating ? "star" : "star-outline"}
          size={14}
          color="#FBBF24"
        />,
      );
    }
    return <View style={{ flexDirection: "row", gap: 2 }}>{stars}</View>;
  };

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
        const eta = calculateETA(
          newLocation.lat,
          newLocation.lng,
          activeJob.customer_lat,
          activeJob.customer_lng,
        );

        socketService.sendMechanicLocation(
          bookingId,
          newLocation,
          eta,
          user?.id,
        );
        await api.patch(`/mechanics/${user?.id}/location`, newLocation);
      }
    } catch (error) {
      console.error("Failed to send location update:", error);
    }
  };

  useEffect(() => {
    const activeJob = myJobs.find(
      (job) =>
        job.status === "accepted" ||
        job.status === "on_the_way" ||
        job.status === "arrived",
    );

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

  useEffect(() => {
    if (user) {
      loadData();
      getCurrentLocation();
      fetchTodayEarnings();
      fetchAnalytics();
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

      Alert.alert(
        "🔔 New Service Request!",
        `A customer needs ${booking.service?.name || "assistance"}. Tap to view details.\n\nVehicle: ${booking.vehicle_type} - ${booking.vehicle_model}`,
        [
          {
            text: "View Now",
            onPress: async () => {
              await stopBeepSound();
              setActiveTab("available");
              loadOpenJobs();
            },
          },
          { 
            text: "Ignore", 
            style: "cancel",
            onPress: async () => {
              await stopBeepSound();
            }
          },
        ],
        { cancelable: false }
      );
      
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
        if (activeTab === "available") {
          loadOpenJobs();
        }
      }, 10000);

      return () => clearInterval(refreshInterval);
    }
  }, [online, activeTab]);

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
      Alert.alert("Error", error.response?.data?.error || "Failed to update profile");
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
          Alert.alert(
            "Location Required",
            "Please enable location permissions to go online.",
          );
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
        Alert.alert(
          "Status Updated",
          `You are now online and will receive booking requests.`,
        );
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
        Alert.alert("Status Updated", "You are now offline.");
      } catch (error) {
        Alert.alert("Error", "Failed to update availability");
      }
    }
  }

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
        {
          id: user?.id,
          full_name: user?.full_name,
          phone: user?.phone,
        },
        15,
      );

      socketService.joinBookingRoom(selectedBooking.id);

      Alert.alert(
        "✓ Accepted!",
        "You have accepted the job. Navigate to the customer's location now.",
      );

      setShowAcceptModal(false);
      await Promise.all([loadOpenJobs(), loadMyJobs()]);
      
      setJobs(prevJobs => prevJobs.filter(job => job.id !== selectedBooking.id));
      
    } catch (error: any) {
      console.error("Failed to accept job:", error);
      
      if (error.response?.status === 409) {
        Alert.alert(
          "Already Accepted",
          "This service request has already been accepted by another mechanic.",
        );
        await loadOpenJobs();
      } else {
        Alert.alert("Error", error.response?.data?.error || "Failed to accept job");
      }
    } finally {
      setAccepting(false);
      setSelectedBooking(null);
    }
  }

  useEffect(() => {
    const handleBookingTaken = (data: { bookingId: string; mechanicId: string; message: string }) => {
      console.log("Booking taken by another mechanic:", data);
      
      setJobs(prevJobs => prevJobs.filter(job => job.id !== data.bookingId));
      
      if (selectedBooking?.id === data.bookingId) {
        Alert.alert(
          "Booking Taken",
          "This service request has been accepted by another mechanic.",
          [
            {
              text: "OK",
              onPress: () => {
                setShowAcceptModal(false);
                setSelectedBooking(null);
              }
            }
          ]
        );
      }
    };

    const handleBookingAcceptError = (data: { bookingId: string; error: string; alreadyAssigned?: boolean }) => {
      if (data.alreadyAssigned) {
        Alert.alert(
          "Already Accepted",
          data.error || "This service request has already been accepted by another mechanic.",
        );
        loadOpenJobs();
      }
    };

    socketService.onBookingTaken(handleBookingTaken);
    socketService.onBookingAcceptError(handleBookingAcceptError);

    return () => {
      socketService.off('booking:taken');
      socketService.off('booking:accept:error');
    };
  }, [selectedBooking]);

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
    await loadMechanicProfile();
    setRefreshing(false);
  }, []);

  const toggleServiceSelection = (serviceId: string) => {
    if (selectedServices.includes(serviceId)) {
      setSelectedServices(selectedServices.filter(id => id !== serviceId));
      const newPrices = { ...customPrices };
      delete newPrices[serviceId];
      setCustomPrices(newPrices);
    } else {
      setSelectedServices([...selectedServices, serviceId]);
    }
  };

  const renderJobCard = ({ item }: { item: any }) => {
    const isMyJob = activeTab === "myJobs";
    const hasCustomerRating = item.customer_rating;
    const hasMechanicRating = item.mechanic_rating;
    const servicePrice = item.service_price || item.service?.base_price || 0;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>
            Service Request #{item.id.slice(0, 8)}
          </Text>
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
            <Text style={styles.statusBadgeText}>
              {item.status?.replaceAll("_", " ").toUpperCase()}
            </Text>
          </View>
        </View>

        <Text style={styles.cardMeta}>
          Service: {item.service?.name || "Road assistance needed"}
        </Text>
        
        <Text style={styles.cardMeta}>
          Price: ₹{servicePrice}
        </Text>

        <Text style={styles.cardMeta}>
          Issue: {item.issue_note || "Road assistance needed"}
        </Text>

        {item.customer && (
          <Text style={styles.cardMeta}>
            Customer: {item.customer.full_name}
          </Text>
        )}

        {item.customer_address && (
          <Text style={styles.cardMeta}>📍 {item.customer_address}</Text>
        )}

        {item.vehicle_type && (
          <Text style={styles.cardMeta}>🚗 {item.vehicle_type}</Text>
        )}

        {item.vehicle_model && (
          <Text style={styles.cardMeta}>🔧 {item.vehicle_model}</Text>
        )}

        {item.customer_lat && item.customer_lng && currentLocation && (
          <Text style={styles.distanceText}>
            📍 Distance:{" "}
            {calculateDistance(
              currentLocation.lat,
              currentLocation.lng,
              item.customer_lat,
              item.customer_lng,
            ).toFixed(1)}{" "}
            km away
          </Text>
        )}

        {isMyJob &&
          (item.status === "accepted" || item.status === "on_the_way") &&
          item.customer_lat &&
          item.customer_lng && (
            <TouchableOpacity
              style={styles.locationCard}
              onPress={() => showNavigationOptions(item)}
            >
              <View style={styles.locationCardLeft}>
                <View style={styles.locationIconContainer}>
                  <Ionicons name="location" size={20} color="#EF4444" />
                </View>
                <View>
                  <Text style={styles.locationCardTitle}>
                    Navigate to Customer
                  </Text>
                  <Text style={styles.locationCardAddress} numberOfLines={1}>
                    {item.customer_address || "Tap to open maps"}
                  </Text>
                </View>
              </View>
              <View style={styles.locationCardRight}>
                <Text style={styles.navigateText}>Navigate →</Text>
              </View>
            </TouchableOpacity>
          )}

        {(item.status === "completed" ||
          hasCustomerRating ||
          hasMechanicRating) && (
          <TouchableOpacity
            style={styles.ratingSummary}
            onPress={() => viewRatingsDetails(item)}
          >
            <View style={styles.ratingSummaryLeft}>
              <Ionicons name="star" size={16} color="#FBBF24" />
              <Text style={styles.ratingSummaryText}>
                {hasCustomerRating
                  ? `${item.customer_rating?.toFixed(1)} ★`
                  : "Rate Customer"}
              </Text>
            </View>
            <View style={styles.ratingSummaryRight}>
              {hasMechanicRating && (
                <View style={styles.mechanicRatingBadge}>
                  <Ionicons name="person-outline" size={12} color="#10B981" />
                  <Text style={styles.mechanicRatingText}>
                    {item.mechanic_rating?.toFixed(1)} ★
                  </Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
            </View>
          </TouchableOpacity>
        )}

        {!isMyJob && item.status === "requested" && (
          <TouchableOpacity
            style={styles.acceptButton}
            onPress={() => acceptJob(item)}
          >
            <Text style={styles.acceptButtonText}>Accept Job</Text>
          </TouchableOpacity>
        )}

        {isMyJob &&
          item.status !== "completed" &&
          item.status !== "cancelled" && (
            <View style={styles.row}>
              {item.status === "accepted" && (
                <>
                  <TouchableOpacity
                    style={[styles.smallBtn, styles.primaryBtn]}
                    onPress={() => {
                      updateStatus(item.id, "on_the_way");
                      setTimeout(() => {
                        showNavigationOptions(item);
                      }, 500);
                    }}
                  >
                    <Ionicons name="car-outline" size={16} color="#FFF" />
                    <Text style={styles.smallBtnText}>Start & Navigate</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.smallBtn, styles.navigateBtn]}
                    onPress={() => showNavigationOptions(item)}
                  >
                    <Ionicons name="navigate-outline" size={16} color="#FFF" />
                    <Text style={styles.smallBtnText}>Navigate</Text>
                  </TouchableOpacity>
                </>
              )}
              {item.status === "on_the_way" && (
                <>
                  <TouchableOpacity
                    style={[styles.smallBtn, styles.primaryBtn]}
                    onPress={() => updateStatus(item.id, "arrived")}
                  >
                    <Ionicons name="flag-outline" size={16} color="#FFF" />
                    <Text style={styles.smallBtnText}>Arrived</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.smallBtn, styles.navigateBtn]}
                    onPress={() => showNavigationOptions(item)}
                  >
                    <Ionicons name="navigate-outline" size={16} color="#FFF" />
                    <Text style={styles.smallBtnText}>Navigate</Text>
                  </TouchableOpacity>
                </>
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
                    <Ionicons name="key-outline" size={16} color="#FFF" />
                    <Text style={[styles.smallBtnText, { color: "#FFF" }]}>
                      Generate OTP
                    </Text>
                  </TouchableOpacity>
                  {/*
                    ✅ FIX — this now routes through startCompleteService(),
                    which guarantees a pin exists (and was sent to the
                    customer) for THIS booking before the entry modal
                    opens, instead of just opening an empty modal and
                    hoping "Generate OTP" was pressed first. This — NOT
                    the earlier "Arrived" tap — is the step that pushes
                    the pin to the customer and pops their "Service
                    Completion" screen, and is also the step that takes
                    the job from "arrived" to "completed" once the
                    mechanic verifies the code the customer reads back to
                    them.
                  */}
                  <TouchableOpacity
                    style={[styles.smallBtn, styles.completeBtn]}
                    onPress={() => startCompleteService(item)}
                  >
                    <Text style={[styles.smallBtnText, { color: "#FFF" }]}>
                      Complete Service
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

        {isMyJob && item.status === "completed" && !item.mechanic_rating && (
          <TouchableOpacity
            style={[
              styles.acceptButton,
              { backgroundColor: "#8B5CF6", marginTop: 12 },
            ]}
            onPress={() => rateCustomer(item)}
          >
            <Ionicons name="star-outline" size={18} color="#FFF" />
            <Text style={styles.acceptButtonText}>Rate Customer</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderProfile = () => {
    return (
      <ScrollView style={styles.profileContainer}>
        <View style={styles.profileHeader}>
          <View style={styles.profileAvatar}>
            <Ionicons name="person" size={60} color="#FFF" />
          </View>
          <Text style={styles.profileName}>{mechanicProfile?.full_name || user?.full_name}</Text>
          <Text style={styles.profileEmail}>{user?.email}</Text>
          {mechanicProfile?.is_verified && (
            <View style={styles.verifiedBadge}>
              <Ionicons name="checkmark-circle" size={16} color="#10B981" />
              <Text style={styles.verifiedText}>Verified Mechanic</Text>
            </View>
          )}
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Ionicons name="star" size={24} color="#FBBF24" />
            <Text style={styles.statValue}>{mechanicProfile?.rating?.toFixed(1) || "0.0"}</Text>
            <Text style={styles.statLabel}>Rating</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="briefcase" size={24} color="#3B82F6" />
            <Text style={styles.statValue}>{mechanicProfile?.total_jobs || 0}</Text>
            <Text style={styles.statLabel}>Total Jobs</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="checkmark-done" size={24} color="#10B981" />
            <Text style={styles.statValue}>{mechanicProfile?.completion_rate || 0}%</Text>
            <Text style={styles.statLabel}>Completion</Text>
          </View>
        </View>

        <View style={styles.infoSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Profile Information</Text>
            <TouchableOpacity onPress={() => setEditingProfile(true)}>
              <Ionicons name="create-outline" size={20} color="#3B82F6" />
            </TouchableOpacity>
          </View>
          
          <View style={styles.infoRow}>
            <Ionicons name="call-outline" size={18} color="#64748B" />
            <Text style={styles.infoText}>{mechanicProfile?.phone || "Not provided"}</Text>
          </View>
          
          <View style={styles.infoRow}>
            <Ionicons name="car-outline" size={18} color="#64748B" />
            <Text style={styles.infoText}>{mechanicProfile?.vehicle_type || "Not specified"}</Text>
          </View>
          
          <View style={styles.infoRow}>
            <Ionicons name="card-outline" size={18} color="#64748B" />
            <Text style={styles.infoText}>License: {mechanicProfile?.license_number || "Not provided"}</Text>
          </View>
          
          <View style={styles.infoRow}>
            <Ionicons name="time-outline" size={18} color="#64748B" />
            <Text style={styles.infoText}>Experience: {mechanicProfile?.experience_years || 0} years</Text>
          </View>
          
          <View style={styles.infoRow}>
            <Ionicons name="document-text-outline" size={18} color="#64748B" />
            <Text style={styles.infoText}>Bio: {mechanicProfile?.bio || "No bio provided"}</Text>
          </View>
        </View>

        <View style={styles.infoSection}>
          <Text style={styles.sectionTitle}>Services Offered</Text>
          {selectedServices.length > 0 ? (
            selectedServices.map(serviceId => {
              const service = availableServices.find(s => s.id === serviceId);
              const customPrice = customPrices[serviceId];
              return service ? (
                <View key={serviceId} style={styles.serviceCard}>
                  <View style={styles.serviceInfo}>
                    <Text style={styles.serviceName}>{service.name}</Text>
                    <Text style={styles.serviceDescription}>{service.description}</Text>
                  </View>
                  <View style={styles.servicePrice}>
                    <Text style={styles.priceText}>
                      ₹{customPrice || service.base_price}
                    </Text>
                    {customPrice && (
                      <Text style={styles.customPriceBadge}>Custom</Text>
                    )}
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
                    <Ionicons name="close" size={24} color="#64748B" />
                  </TouchableOpacity>
                </View>

                <ScrollView style={{ maxHeight: 500 }}>
                  <TextInput
                    style={styles.input}
                    placeholder="Full Name"
                    value={profileForm.full_name}
                    onChangeText={(text) => setProfileForm({ ...profileForm, full_name: text })}
                  />
                  
                  <TextInput
                    style={styles.input}
                    placeholder="Phone Number"
                    value={profileForm.phone}
                    onChangeText={(text) => setProfileForm({ ...profileForm, phone: text })}
                    keyboardType="phone-pad"
                  />
                  
                  <TextInput
                    style={styles.input}
                    placeholder="Vehicle Type (e.g., Car, Motorcycle)"
                    value={profileForm.vehicle_type}
                    onChangeText={(text) => setProfileForm({ ...profileForm, vehicle_type: text })}
                  />
                  
                  <TextInput
                    style={styles.input}
                    placeholder="License Number"
                    value={profileForm.license_number}
                    onChangeText={(text) => setProfileForm({ ...profileForm, license_number: text })}
                  />
                  
                  <TextInput
                    style={styles.input}
                    placeholder="Years of Experience"
                    value={profileForm.experience_years}
                    onChangeText={(text) => setProfileForm({ ...profileForm, experience_years: text })}
                    keyboardType="numeric"
                  />
                  
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    placeholder="Bio / About You"
                    value={profileForm.bio}
                    onChangeText={(text) => setProfileForm({ ...profileForm, bio: text })}
                    multiline
                    numberOfLines={3}
                  />

                  <Text style={styles.sectionTitle}>Select Services & Set Prices</Text>
                  
                  {availableServices.map((service) => (
                    <View key={service.id} style={styles.serviceSelectionCard}>
                      <TouchableOpacity
                        style={styles.serviceCheckbox}
                        onPress={() => toggleServiceSelection(service.id)}
                      >
                        <Ionicons
                          name={selectedServices.includes(service.id) ? "checkbox" : "square-outline"}
                          size={24}
                          color={selectedServices.includes(service.id) ? "#10B981" : "#64748B"}
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

  const renderAnalytics = () => {
    return (
      <ScrollView style={styles.analyticsContainer}>
        <View style={styles.earningsOverview}>
          <Text style={styles.overviewTitle}>Earnings Overview</Text>
          
          <View style={styles.earningCards}>
            <View style={styles.earningCard}>
              <Text style={styles.earningLabel}>Today</Text>
              <Text style={styles.earningsAmount}>₹{todayEarnings}</Text>
              <Text style={styles.earningJobs}>{todaysJobsCount} jobs</Text>
            </View>
            
            <View style={styles.earningCard}>
              <Text style={styles.earningLabel}>This Week</Text>
              <Text style={styles.earningsAmount}>₹{weeklyEarnings}</Text>
            </View>
            
            <View style={styles.earningCard}>
              <Text style={styles.earningLabel}>This Month</Text>
              <Text style={styles.earningsAmount}>₹{monthlyEarnings}</Text>
            </View>
          </View>
        </View>

        <View style={styles.statsSection}>
          <Text style={styles.sectionTitle}>Service Performance</Text>
          {serviceStats.length > 0 ? (
            serviceStats.map((stat: any) => (
              <View key={stat.service_id} style={styles.serviceStatCard}>
                <View style={styles.serviceStatHeader}>
                  <Text style={styles.serviceStatName}>{stat.service_name}</Text>
                  <View style={styles.serviceStatRating}>
                    <Ionicons name="star" size={14} color="#FBBF24" />
                    <Text style={styles.ratingText}>{stat.avg_rating.toFixed(1)}</Text>
                  </View>
                </View>
                <View style={styles.serviceStatDetails}>
                  <View style={styles.serviceStatItem}>
                    <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                    <Text style={styles.serviceStatValue}>{stat.total_completed} completed</Text>
                  </View>
                  <View style={styles.serviceStatItem}>
                    <Ionicons name="cash" size={16} color="#F59E0B" />
                    <Text style={styles.serviceStatValue}>₹{stat.total_earnings} earned</Text>
                  </View>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.noStatsText}>No service data available yet</Text>
          )}
        </View>

        <View style={styles.statsSection}>
          <Text style={styles.sectionTitle}>Quick Stats</Text>
          <View style={styles.quickStatsGrid}>
            <View style={styles.quickStat}>
              <Ionicons name="happy" size={32} color="#10B981" />
              <Text style={styles.quickStatValue}>{mechanicProfile?.rating?.toFixed(1) || "0.0"}</Text>
              <Text style={styles.quickStatLabel}>Rating</Text>
            </View>
            <View style={styles.quickStat}>
              <Ionicons name="briefcase" size={32} color="#3B82F6" />
              <Text style={styles.quickStatValue}>{totalJobsCompleted}</Text>
              <Text style={styles.quickStatLabel}>Total Jobs</Text>
            </View>
            <View style={styles.quickStat}>
              <Ionicons name="checkmark-done" size={32} color="#8B5CF6" />
              <Text style={styles.quickStatValue}>{mechanicProfile?.completion_rate || 0}%</Text>
              <Text style={styles.quickStatLabel}>Completion</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    );
  };

  const openGoogleMapsNavigation = async (
    customerLat: number,
    customerLng: number,
    customerAddress: string,
  ) => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission Denied",
          "Please enable location permissions to use navigation.",
        );
        return;
      }

      const currentLoc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

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
          onPress: () =>
            openGoogleMapsNavigation(
              job.customer_lat,
              job.customer_lng,
              job.customer_address,
            ),
        },
        {
          text: "Apple Maps",
          onPress: () => {
            if (Platform.OS === "ios") {
              openGoogleMapsNavigation(
                job.customer_lat,
                job.customer_lng,
                job.customer_address,
              );
            } else {
              Alert.alert(
                "Not Available",
                "Apple Maps is only available on iOS.",
              );
            }
          },
        },
        {
          text: "View Address",
          onPress: () => {
            Alert.alert(
              "Customer Address",
              job.customer_address || "Address not provided",
            );
          },
        },
        { text: "Cancel", style: "cancel" },
      ],
      { cancelable: true },
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#0F172A" />
          <Text style={styles.loadingText}>Loading dashboard...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Accept Job Modal */}
      <Modal visible={showAcceptModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Accept Job?</Text>
            <Text style={styles.modalText}>
              You are about to accept a service request from a customer.
            </Text>
            {selectedBooking && (
              <View style={styles.modalDetails}>
                <Text style={styles.modalDetailText}>
                  Service: {selectedBooking.service?.name || "Roadside Assistance"}
                </Text>
                <Text style={styles.modalDetailText}>
                  Price: ₹{selectedBooking.service?.base_price || 0}
                </Text>
                <Text style={styles.modalDetailText}>
                  Issue: {selectedBooking.issue_note || "Not specified"}
                </Text>
              </View>
            )}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalCancelButton]}
                onPress={() => setShowAcceptModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalAcceptButton]}
                onPress={confirmAcceptJob}
                disabled={accepting}
              >
                <Text style={styles.modalAcceptText}>
                  {accepting ? "Accepting..." : "Accept"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ✅ CORRECTED OTP MODAL - Mechanic enters OTP */}
      <Modal visible={showOTPModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { width: "90%", maxWidth: 400 }]}>
            <View style={styles.otpHeader}>
              <Ionicons name="key" size={50} color="#10B981" />
              <Text style={styles.modalTitle}>Complete Service</Text>
            </View>
            
            <View style={styles.otpDivider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>ENTER CODE FROM CUSTOMER</Text>
              <View style={styles.dividerLine} />
            </View>

            {/*
              ✅ While a pin is being generated (startCompleteService /
              generateOTPForCompletion in flight) show a spinner instead
              of an input the mechanic could type into before the
              customer even has a pin to read back.
            */}
            {otpGenerating ? (
              <View style={styles.otpGeneratingBox}>
                <ActivityIndicator size="small" color="#10B981" />
                <Text style={styles.otpGeneratingText}>
                  Generating pin for the customer…
                </Text>
              </View>
            ) : (
              <>
                <Text style={styles.otpInstruction}>
                  Ask the customer for the 6-digit code and enter it below:
                </Text>

                <TextInput
                  style={styles.otpInputField}
                  placeholder="Enter 6-digit OTP"
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
                  // ✅ Clear the pin on cancel too, so re-opening
                  // "Complete Service" later always generates a fresh
                  // one instead of silently reusing a possibly-expired
                  // pin the customer may no longer be looking at.
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
                  (otpGenerating || !enteredOTP || enteredOTP.length !== 6) && styles.disabledButton
                ]}
                onPress={() => verifyMechanicOTP(activeBooking?.id, enteredOTP)}
                disabled={otpGenerating || !enteredOTP || enteredOTP.length !== 6 || verifyingOTP}
              >
                <Text style={styles.modalAcceptText}>
                  {verifyingOTP ? "Verifying..." : "Verify & Complete"}
                </Text>
              </TouchableOpacity>
            </View>
            
            {!otpGenerating && !generatedOTP && activeBooking?.status === "arrived" && (
              <TouchableOpacity
                style={styles.refreshOtpButton}
                onPress={() => generateOTPForCompletion(activeBooking?.id)}
              >
                <Ionicons name="refresh-outline" size={16} color="#3B82F6" />
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
            <Text style={styles.modalText}>
              How was your experience with this customer?
            </Text>

            <View style={styles.ratingContainer}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity
                  key={star}
                  onPress={() => setCustomerRating(star)}
                  style={styles.starButton}
                >
                  <Ionicons
                    name={star <= customerRating ? "star" : "star-outline"}
                    size={40}
                    color="#FBBF24"
                  />
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={styles.reviewInput}
              placeholder="Share your experience (optional)"
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
              <TouchableOpacity
                style={[styles.modalButton, styles.modalAcceptButton]}
                onPress={submitCustomerRating}
              >
                <Text style={styles.modalAcceptText}>Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Ratings Detail Modal */}
      <Modal visible={showRatingsDetailModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalScrollContent}>
            <View style={[styles.modalContent, { width: "90%", maxWidth: 500 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Ratings & Reviews</Text>
                <TouchableOpacity onPress={() => setShowRatingsDetailModal(false)}>
                  <Ionicons name="close" size={24} color="#64748B" />
                </TouchableOpacity>
              </View>

              {selectedRatingsBooking && (
                <View style={styles.ratingsBody}>
                  <View style={styles.bookingInfo}>
                    <Text style={styles.bookingInfoText}>
                      Booking #{selectedRatingsBooking.id.slice(0, 8)}
                    </Text>
                    <Text style={styles.bookingInfoDate}>
                      {new Date(selectedRatingsBooking.created_at).toLocaleDateString()}
                    </Text>
                  </View>

                  <View style={styles.ratingSection}>
                    <View style={styles.ratingHeader}>
                      <View style={styles.ratingTitleContainer}>
                        <Ionicons name="person-outline" size={20} color="#0F172A" />
                        <Text style={styles.ratingTitle}>Customer's Rating</Text>
                      </View>
                      <Text style={styles.ratingRoleBadge}>Of You</Text>
                    </View>

                    <View style={styles.ratingContent}>
                      {selectedRatingsBooking.customer_rating ? (
                        <>
                          <View style={styles.ratingStarsLarge}>
                            {renderStars(selectedRatingsBooking.customer_rating)}
                            <Text style={styles.ratingText}>
                              ({selectedRatingsBooking.customer_rating.toFixed(1)})
                            </Text>
                          </View>
                          {selectedRatingsBooking.customer_review && (
                            <View style={styles.reviewContainer}>
                              <Text style={styles.reviewLabel}>Customer's Review:</Text>
                              <Text style={styles.reviewText}>
                                "{selectedRatingsBooking.customer_review}"
                              </Text>
                            </View>
                          )}
                        </>
                      ) : (
                        <View style={styles.noRatingContainer}>
                          <Ionicons name="star-outline" size={32} color="#CBD5E1" />
                          <Text style={styles.noRatingText}>No rating yet</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  <View style={styles.ratingSection}>
                    <View style={styles.ratingHeader}>
                      <View style={styles.ratingTitleContainer}>
                        <Ionicons name="construct-outline" size={20} color="#0F172A" />
                        <Text style={styles.ratingTitle}>Your Rating</Text>
                      </View>
                      <Text style={[styles.ratingRoleBadge, styles.mechanicBadge]}>
                        Of Customer
                      </Text>
                    </View>

                    <View style={styles.ratingContent}>
                      {selectedRatingsBooking.mechanic_rating ? (
                        <>
                          <View style={styles.ratingStarsLarge}>
                            {renderStars(selectedRatingsBooking.mechanic_rating)}
                            <Text style={styles.ratingText}>
                              ({selectedRatingsBooking.mechanic_rating.toFixed(1)})
                            </Text>
                          </View>
                          {selectedRatingsBooking.mechanic_review && (
                            <View style={styles.reviewContainer}>
                              <Text style={styles.reviewLabel}>Your Review:</Text>
                              <Text style={styles.reviewText}>
                                "{selectedRatingsBooking.mechanic_review}"
                              </Text>
                            </View>
                          )}
                        </>
                      ) : (
                        <View style={styles.noRatingContainer}>
                          <Ionicons name="time-outline" size={32} color="#CBD5E1" />
                          <Text style={styles.noRatingText}>You haven't rated yet</Text>
                        </View>
                      )}
                    </View>
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

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Mechanic Dashboard</Text>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
          <Ionicons name="log-out-outline" size={22} color="#EF4444" />
        </TouchableOpacity>
      </View>

      {/* Today's Earnings Card */}
      <TouchableOpacity style={styles.earningsCard} onPress={() => setActiveTab("analytics")}>
        <View style={styles.earningsLeft}>
          <Ionicons name="cash-outline" size={28} color="#10B981" />
          <View>
            <Text style={styles.earningsLabel}>Today's Earnings</Text>
            <Text style={styles.earningsAmount}>₹{todayEarnings}</Text>
            <Text style={styles.earningsSubtext}>
              {todaysJobsCount} jobs completed
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={fetchTodayEarnings} style={styles.refreshEarnings}>
          <Ionicons name="refresh-outline" size={20} color="#64748B" />
        </TouchableOpacity>
      </TouchableOpacity>

      {/* Status Bar */}
      <View style={styles.statusBar}>
        <TouchableOpacity
          style={[styles.statusButton, online ? styles.onlineBtn : styles.offlineBtn]}
          onPress={toggleAvailability}
        >
          <View style={styles.statusDot} />
          <Text style={styles.statusButtonText}>
            {online ? "Online" : "Offline"}
          </Text>
        </TouchableOpacity>
        {online && currentLocation && (
          <View style={styles.locationActive}>
            <Ionicons name="location" size={14} color="#10B981" />
            <Text style={styles.locationText}>Location active</Text>
          </View>
        )}
      </View>

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "available" && styles.activeTab]}
          onPress={() => setActiveTab("available")}
        >
          <Text style={[styles.tabText, activeTab === "available" && styles.activeTabText]}>
            Available ({jobs.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "myJobs" && styles.activeTab]}
          onPress={() => setActiveTab("myJobs")}
        >
          <Text style={[styles.tabText, activeTab === "myJobs" && styles.activeTabText]}>
            My Jobs ({myJobs.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "profile" && styles.activeTab]}
          onPress={() => setActiveTab("profile")}
        >
          <Text style={[styles.tabText, activeTab === "profile" && styles.activeTabText]}>
            Profile
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "analytics" && styles.activeTab]}
          onPress={() => setActiveTab("analytics")}
        >
          <Text style={[styles.tabText, activeTab === "analytics" && styles.activeTabText]}>
            Analytics
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      {activeTab === "profile" ? (
        renderProfile()
      ) : activeTab === "analytics" ? (
        renderAnalytics()
      ) : (
        <FlatList
          data={activeTab === "available" ? jobs : myJobs}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={["#0F172A"]}
              tintColor="#0F172A"
            />
          }
          renderItem={renderJobCard}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="construct-outline" size={64} color="#CBD5E1" />
              <Text style={styles.emptyStateText}>
                {activeTab === "available"
                  ? "No available jobs at the moment"
                  : "You have no active jobs"}
              </Text>
              {activeTab === "available" && online && (
                <Text style={styles.emptyStateSubtext}>
                  New requests will appear here automatically
                </Text>
              )}
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  centerContent: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { marginTop: 12, fontSize: 14, color: "#64748B" },
  content: { padding: 16, paddingBottom: 32 },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: "#FFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  headerTitle: { fontSize: 22, fontWeight: "800", color: "#0F172A" },
  logoutButton: { padding: 8 },

  earningsCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#FFF",
    margin: 16,
    marginTop: 8,
    marginBottom: 8,
    padding: 16,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  earningsLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  earningsLabel: { fontSize: 12, color: "#64748B", marginBottom: 2 },
  earningsAmount: { fontSize: 24, fontWeight: "800", color: "#0F172A" },
  earningsSubtext: { fontSize: 11, color: "#94A3B8", marginTop: 2 },
  refreshEarnings: { padding: 8 },

  statusBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: "#FFF",
  },
  statusButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 8,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#FFF" },
  onlineBtn: { backgroundColor: "#10B981" },
  offlineBtn: { backgroundColor: "#64748B" },
  statusButtonText: { color: "#FFF", fontWeight: "600", fontSize: 14 },
  locationActive: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F0FDF4",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  locationText: { fontSize: 12, color: "#10B981", fontWeight: "500" },

  tabBar: {
    flexDirection: "row",
    paddingHorizontal: 20,
    gap: 16,
    backgroundColor: "#FFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  tab: { flex: 1, paddingVertical: 14, alignItems: "center" },
  activeTab: { borderBottomWidth: 2, borderBottomColor: "#0F172A" },
  tabText: { fontSize: 14, fontWeight: "600", color: "#64748B" },
  activeTabText: { color: "#0F172A" },

  card: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#0F172A", flex: 1 },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "#F1F5F9",
  },
  completedBadge: { backgroundColor: "#D1FAE5" },
  cancelledBadge: { backgroundColor: "#FEE2E2" },
  acceptedBadge: { backgroundColor: "#DBEAFE" },
  onWayBadge: { backgroundColor: "#FEF3C7" },
  arrivedBadge: { backgroundColor: "#EDE9FE" },
  statusBadgeText: { fontSize: 10, fontWeight: "700", color: "#0F172A" },

  cardMeta: { fontSize: 13, color: "#475569", marginTop: 6 },
  distanceText: {
    fontSize: 12,
    color: "#10B981",
    marginTop: 6,
    fontWeight: "500",
  },

  ratingSummary: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  ratingSummaryLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  ratingSummaryText: { fontSize: 13, fontWeight: "600", color: "#0F172A" },
  ratingSummaryRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  mechanicRatingBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F0FDF4",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  mechanicRatingText: { fontSize: 11, fontWeight: "600", color: "#10B981" },

  acceptButton: {
    backgroundColor: "#0F172A",
    padding: 14,
    borderRadius: 12,
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  acceptButtonText: { color: "#FFF", fontWeight: "700", textAlign: "center" },

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
  primaryBtn: { backgroundColor: "#0F172A" },
  otpBtn: { backgroundColor: "#10B981" },
  completeBtn: { backgroundColor: "#8B5CF6" },
  disabledButton: { opacity: 0.5, backgroundColor: "#94A3B8" },
  smallBtnText: { fontWeight: "700", fontSize: 12, color: "#FFF" },

  emptyState: { padding: 48, alignItems: "center" },
  emptyStateText: { fontSize: 16, fontWeight: "600", color: "#64748B", marginTop: 12 },
  emptyStateSubtext: { fontSize: 14, color: "#94A3B8", textAlign: "center", marginTop: 8 },

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
    width: "85%",
    maxWidth: 400,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    marginBottom: 16,
  },
  modalTitle: { fontSize: 20, fontWeight: "700", color: "#0F172A", textAlign: "center" },
  modalText: { fontSize: 14, color: "#475569", marginBottom: 16, textAlign: "center" },
  modalDetails: {
    backgroundColor: "#F1F5F9",
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
  },
  modalDetailText: { fontSize: 13, color: "#0F172A", marginBottom: 4 },
  modalButtons: { flexDirection: "row", gap: 12, marginTop: 16 },
  modalButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  modalCancelButton: { backgroundColor: "#F1F5F9" },
  modalCancelText: { color: "#64748B", fontWeight: "600" },
  modalAcceptButton: { backgroundColor: "#0F172A" },
  modalAcceptText: { color: "#FFF", fontWeight: "600" },

  otpHeader: { alignItems: "center", marginBottom: 16 },
  generatedOtpContainer: {
    backgroundColor: "#F0FDF4",
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    marginBottom: 16,
  },
  generatedOtpLabel: { fontSize: 14, color: "#047857", marginBottom: 8 },
  generatedOtpDisplay: {
    fontSize: 42,
    fontWeight: "800",
    fontFamily: "monospace",
    letterSpacing: 6,
    color: "#10B981",
  },
  generatedOtpExpiry: { fontSize: 12, color: "#EF4444", marginTop: 8 },
  otpDivider: { flexDirection: "row", alignItems: "center", marginVertical: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: "#E2E8F0" },
  dividerText: { marginHorizontal: 12, fontSize: 11, color: "#94A3B8", fontWeight: "600" },
  otpInstruction: { fontSize: 14, color: "#64748B", textAlign: "center", marginBottom: 12 },
  // ✅ Shown while startCompleteService()/generateOTPForCompletion() is
  // in flight, so the mechanic sees the pin is on its way to the
  // customer instead of a blank input box.
  otpGeneratingBox: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F0FDF4",
    borderRadius: 12,
    paddingVertical: 24,
    marginBottom: 16,
    gap: 10,
  },
  otpGeneratingText: {
    fontSize: 13,
    color: "#047857",
    fontWeight: "600",
  },
  otpInputField: {
    backgroundColor: "#F1F5F9",
    borderRadius: 12,
    padding: 16,
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: 8,
    textAlign: "center",
    marginVertical: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  refreshOtpButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 16,
    padding: 8,
  },
  refreshOtpText: { fontSize: 13, color: "#3B82F6", fontWeight: "500" },
  modalCloseButton: { backgroundColor: "#0F172A", padding: 12, borderRadius: 8, alignItems: "center" },
  modalCloseText: { color: "#FFF", fontWeight: "600" },

  ratingContainer: { flexDirection: "row", justifyContent: "center", marginVertical: 20 },
  starButton: { padding: 8 },
  reviewInput: {
    backgroundColor: "#F1F5F9",
    borderRadius: 8,
    padding: 12,
    minHeight: 80,
    marginBottom: 20,
    fontSize: 14,
  },

  ratingsBody: { paddingBottom: 16 },
  bookingInfo: {
    backgroundColor: "#F1F5F9",
    padding: 12,
    borderRadius: 12,
    marginBottom: 20,
  },
  bookingInfoText: { fontSize: 14, fontWeight: "600", color: "#0F172A" },
  bookingInfoDate: { fontSize: 12, color: "#64748B", marginTop: 4 },
  ratingSection: {
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    overflow: "hidden",
  },
  ratingHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    backgroundColor: "#F8FAFC",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  ratingTitleContainer: { flexDirection: "row", alignItems: "center", gap: 8 },
  ratingTitle: { fontSize: 14, fontWeight: "600", color: "#0F172A" },
  ratingRoleBadge: {
    fontSize: 11,
    fontWeight: "600",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "#EFF6FF",
    color: "#2563EB",
    overflow: "hidden",
  },
  mechanicBadge: { backgroundColor: "#F0FDF4", color: "#10B981" },
  ratingContent: { padding: 16 },
  ratingStarsLarge: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 12 },
  ratingText: { fontSize: 14, fontWeight: "600", color: "#0F172A", marginLeft: 4 },
  reviewContainer: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#E2E8F0" },
  reviewLabel: { fontSize: 12, fontWeight: "600", color: "#64748B", marginBottom: 8 },
  reviewText: { fontSize: 14, color: "#0F172A", lineHeight: 20, fontStyle: "italic" },
  noRatingContainer: { alignItems: "center", paddingVertical: 20 },
  noRatingText: { fontSize: 13, color: "#94A3B8", marginTop: 8 },
  closeRatingsButton: { marginTop: 20, backgroundColor: "#0F172A", padding: 14, borderRadius: 12, alignItems: "center" },
  closeRatingsButtonText: { color: "#FFF", fontSize: 16, fontWeight: "600" },
  navigateBtn: { backgroundColor: "#3B82F6" },
  locationCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F8FAFC",
    padding: 12,
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  locationCardLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  locationIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FEE2E2",
    justifyContent: "center",
    alignItems: "center",
  },
  locationCardTitle: { fontSize: 13, fontWeight: "600", color: "#0F172A" },
  locationCardAddress: { fontSize: 11, color: "#64748B", marginTop: 2 },
  locationCardRight: { paddingLeft: 8 },
  navigateText: { fontSize: 12, fontWeight: "600", color: "#3B82F6" },
  
  // Profile styles
  profileContainer: { flex: 1, backgroundColor: "#F8FAFC" },
  profileHeader: {
    alignItems: "center",
    backgroundColor: "#FFF",
    paddingVertical: 24,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  profileAvatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#0F172A",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  profileName: { fontSize: 22, fontWeight: "700", color: "#0F172A", marginBottom: 4 },
  profileEmail: { fontSize: 14, color: "#64748B", marginBottom: 8 },
  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F0FDF4",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 16,
    gap: 4,
  },
  verifiedText: { fontSize: 12, color: "#10B981", fontWeight: "600" },
  statsGrid: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 20,
    backgroundColor: "#FFF",
    marginTop: 8,
  },
  statCard: { alignItems: "center" },
  statValue: { fontSize: 20, fontWeight: "800", color: "#0F172A", marginTop: 8 },
  statLabel: { fontSize: 12, color: "#64748B", marginTop: 4 },
  infoSection: { backgroundColor: "#FFF", marginTop: 12, padding: 20 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: "#0F172A", marginBottom: 16 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  infoText: { fontSize: 14, color: "#475569", flex: 1 },
  serviceCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  serviceInfo: { flex: 1 },
  serviceName: { fontSize: 16, fontWeight: "600", color: "#0F172A", marginBottom: 4 },
  serviceDescription: { fontSize: 12, color: "#64748B" },
  servicePrice: { alignItems: "flex-end" },
  priceText: { fontSize: 16, fontWeight: "700", color: "#10B981" },
  customPriceBadge: { fontSize: 10, color: "#8B5CF6", marginTop: 2 },
  noServicesText: { fontSize: 14, color: "#94A3B8", textAlign: "center", paddingVertical: 20 },
  
  input: { backgroundColor: "#F1F5F9", borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 14 },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  serviceSelectionCard: { marginBottom: 16, padding: 12, backgroundColor: "#F8FAFC", borderRadius: 8 },
  serviceCheckbox: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  serviceCheckboxInfo: { flex: 1 },
  serviceCheckboxName: { fontSize: 14, fontWeight: "600", color: "#0F172A", marginBottom: 4 },
  serviceCheckboxDesc: { fontSize: 12, color: "#64748B", marginBottom: 4 },
  defaultPrice: { fontSize: 11, color: "#10B981" },
  saveButton: { backgroundColor: "#0F172A", padding: 16, borderRadius: 12, alignItems: "center", marginTop: 20 },
  saveButtonText: { color: "#FFF", fontSize: 16, fontWeight: "600" },
  
  analyticsContainer: { flex: 1, backgroundColor: "#F8FAFC" },
  earningsOverview: { backgroundColor: "#FFF", padding: 20, marginBottom: 12 },
  overviewTitle: { fontSize: 18, fontWeight: "700", color: "#0F172A", marginBottom: 16 },
  earningCards: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  earningCard: { flex: 1, backgroundColor: "#F8FAFC", padding: 12, borderRadius: 12, alignItems: "center" },
  earningLabel: { fontSize: 12, color: "#64748B", marginBottom: 4 },
  earningJobs: { fontSize: 10, color: "#94A3B8", marginTop: 4 },
  statsSection: { backgroundColor: "#FFF", padding: 20, marginBottom: 12 },
  serviceStatCard: { marginBottom: 16, padding: 12, backgroundColor: "#F8FAFC", borderRadius: 12 },
  serviceStatHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  serviceStatName: { fontSize: 16, fontWeight: "600", color: "#0F172A" },
  serviceStatRating: { flexDirection: "row", alignItems: "center", gap: 4 },
  serviceStatDetails: { flexDirection: "row", gap: 16 },
  serviceStatItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  serviceStatValue: { fontSize: 13, color: "#475569" },
  noStatsText: { fontSize: 14, color: "#94A3B8", textAlign: "center", paddingVertical: 20 },
  quickStatsGrid: { flexDirection: "row", justifyContent: "space-around", paddingVertical: 16 },
  quickStat: { alignItems: "center" },
  quickStatValue: { fontSize: 24, fontWeight: "800", color: "#0F172A", marginTop: 8 },
  quickStatLabel: { fontSize: 12, color: "#64748B", marginTop: 4 },
});