import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator,
  Alert, TouchableOpacity, TextInput, Platform, StatusBar,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { api } from "@/lib/api";
import { ServiceCard } from "@/components/ServiceCard";
import { useAuth } from "@/context/AuthContext";
import { ServiceItem } from "@/types";

// ---------------------------------------------------------------------------
// Temporary availability gate: only these services can be booked right now.
// Everything else still shows in the list (so customers know it exists) but
// is dimmed, un-tappable, and labeled "Service Unavailable" in red.
// Match is case-insensitive and trims whitespace, since service names come
// from the API and small casing/spacing differences shouldn't silently
// disable a service that should be available.
// ---------------------------------------------------------------------------
const AVAILABLE_SERVICE_NAMES = [
  "Towing Support",
  "Tubeless Mushroom Puncture",
  "Tubeless Puncture",
];

function isServiceAvailable(name?: string): boolean {
  if (!name) return false;
  const normalized = name.trim().toLowerCase();
  return AVAILABLE_SERVICE_NAMES.some(
    (allowed) => allowed.toLowerCase() === normalized,
  );
}

export default function ServiceSelectionScreen() {
  const params = useLocalSearchParams<{
    vehicleId: string; vehicleName: string; vehicleCategory: string;
    lat: string; lng: string; address: string; savedLocationId: string;
  }>();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [services, setServices] = useState<ServiceItem[]>([]);
  const [servicePrices, setServicePrices] = useState<Map<string, number>>(new Map());
  const [priceDetails, setPriceDetails] = useState<Map<string, any>>(new Map());
  const [loading, setLoading] = useState(true);
  const [issueNote, setIssueNote] = useState("");
  const [creatingBooking, setCreatingBooking] = useState(false);
  const [selectedService, setSelectedService] = useState<ServiceItem | null>(null);

  useEffect(() => {
    loadServicesAndPricing();
  }, []);

  async function loadServicesAndPricing() {
    setLoading(true);
    try {
      const { data: allServices } = await api.get("/services");
      setServices(allServices || []);

      const { data: pricing } = await api.get(
        `/services/pricing/vehicle/${params.vehicleId}`,
      );
      const priceMap = new Map<string, number>();
      const detailsMap = new Map<string, any>();
      if (Array.isArray(pricing)) {
        pricing.forEach((p: any) => {
          const name = p.services?.name;
          if (name) {
            priceMap.set(name, p.price);
            detailsMap.set(name, {
              notes: p.notes,
              pricingId: p.id,
            });
          }
        });
      }
      setServicePrices(priceMap);
      setPriceDetails(detailsMap);
    } catch (error) {
      console.error("Failed to load services/pricing:", error);
      Alert.alert("Error", "Failed to load services. Pull down to retry.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectService(service: ServiceItem) {
    // ✅ Guard against booking a service that's currently unavailable, even
    // if something manages to trigger onPress (the wrapper below already
    // blocks touches, but this is a safe backstop).
    if (!isServiceAvailable(service.name)) {
      Alert.alert(
        "Service Unavailable",
        `${service.name} isn't available for booking right now.`,
      );
      return;
    }

    if (!user) {
      Alert.alert("Not logged in", "Please login to create a booking");
      router.push("/(auth)/login");
      return;
    }
    const lat = Number(params.lat);
    const lng = Number(params.lng);
    if (!lat || !lng) {
      Alert.alert("Location missing", "Go back and select a location first.");
      return;
    }

    setSelectedService(service);
    setCreatingBooking(true);

    const priceInfo = priceDetails.get(service.name);
    const finalAmount = servicePrices.get(service.name) ?? service.base_price;

    try {
      const { data } = await api.post("/bookings", {
        customerId: user.id,
        mechanicId: null,
        serviceId: service.id,
        issueNote: issueNote || `${service.name} assistance needed`,
        customerLat: lat,
        customerLng: lng,
        customerAddress: params.address || "Live GPS location",
        status: "requested",
        savedLocationId: params.savedLocationId || null,
        vehicle_type: params.vehicleCategory,
        vehicle_model: params.vehicleId,
        amount: Number(finalAmount),
        service_pricing_id: priceInfo?.pricingId ?? null,
      });

      if (!data || typeof data !== "object" || !data.id) {
        throw new Error(data?.message || data?.error || "Booking creation failed.");
      }

      // Customer tab's checkActiveBooking() picks this up on focus.
      router.replace("/(tabs)/customer");
    } catch (error: any) {
      const errMsg =
        error?.message ||
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        "Failed to create booking. Please try again.";
      Alert.alert("Booking Failed", errMsg);
      setSelectedService(null);
    } finally {
      setCreatingBooking(false);
    }
  }

 return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={[styles.header, { paddingTop: Platform.OS === "android" ? 12 : 16 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={22} color="#0F172A" />
        </TouchableOpacity>
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle}>Choose a Service</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            For {params.vehicleName}
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#0F172A" />
          <Text style={styles.loadingText}>Loading services...</Text>
        </View>
      ) : (
        <FlatList
          data={services}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: 40 + insets.bottom },
          ]}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          renderItem={({ item }) => {
            const available = isServiceAvailable(item.name);
            return (
              <ServiceCard
                item={item}
                onPress={() => handleSelectService(item)}
                disabled={creatingBooking}
                unavailable={!available}
                selectedVehicle={{ name: params.vehicleName }}
                dynamicPrice={servicePrices.get(item.name)}
                priceNote={priceDetails.get(item.name)?.notes}
              />
            );
          }}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No services available right now.</Text>
          }
        />
      )}

      {creatingBooking && (
        <View style={styles.bookingOverlay}>
          <ActivityIndicator size="large" color="#FFF" />
          <Text style={styles.bookingOverlayText}>
            Requesting {selectedService?.name}...
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  header: { flexDirection: "row", alignItems: "center", padding: 16, backgroundColor: "#FFF", borderBottomWidth: 1, borderBottomColor: "#E2E8F0" },
  backButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#F1F5F9", justifyContent: "center", alignItems: "center", marginRight: 12 },
  headerTextWrap: { flex: 1 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#0F172A" },
  headerSubtitle: { fontSize: 13, color: "#64748B", marginTop: 2 },
  issueInput: {
  backgroundColor: "#FFF",
  marginHorizontal: 16,
  marginTop: 16,      // was 12
  marginBottom: 4,    // NEW — separates it from the list below
  padding: 12,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: "#E2E8F0",
  fontSize: 13,
  minHeight: 44,
  textAlignVertical: "top",
},
listContent: {
  padding: 16,
  paddingTop: 8,       // NEW
  paddingBottom: 40,
},
  centerContent: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { marginTop: 12, fontSize: 14, color: "#64748B" },
  emptyText: { textAlign: "center", color: "#94A3B8", marginTop: 40 },
  bookingOverlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(15,23,42,0.6)", justifyContent: "center", alignItems: "center" },
  bookingOverlayText: { color: "#FFF", marginTop: 12, fontSize: 14, fontWeight: "600" },

});