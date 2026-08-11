/* eslint-disable react/no-unescaped-entities */
// app/(tabs)/bookings.tsx (or wherever your bookings screen is)
import { useEffect, useState, useCallback } from "react";
import {
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  RefreshControl,
  Alert,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
} from "react-native";
import { BookingStatusCard } from "@/components/BookingStatusCard";
import { api } from "@/lib/api";
import { Booking } from "@/types";
import { useAuth } from "@/context/AuthContext";
import { Ionicons } from "@expo/vector-icons";

export default function BookingsScreen() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [updateNote, setUpdateNote] = useState("");
  const [updating, setUpdating] = useState(false);
  const [ratingsModalVisible, setRatingsModalVisible] = useState(false);
  const [selectedRatingsBooking, setSelectedRatingsBooking] =
    useState<any>(null);
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      loadBookings();
    }
  }, [user]);

  async function loadBookings() {
    if (!user) return;

    setLoading(true);
    try {
      const { data } = await api.get(`/bookings/customer/${user.id}`);
      setBookings(data);
    } catch (error) {
      console.error("Failed to load bookings:", error);
      Alert.alert("Error", "Failed to load bookings");
    } finally {
      setLoading(false);
    }
  }

  const onRefresh = useCallback(async () => {
    if (!user) return;

    setRefreshing(true);
    try {
      const { data } = await api.get(`/bookings/customer/${user.id}`);
      setBookings(data);
    } catch (error) {
      console.error("Failed to refresh bookings:", error);
    } finally {
      setRefreshing(false);
    }
  }, [user]);

  async function deleteBooking(bookingId: string) {
    Alert.alert(
      "Delete Booking",
      "Are you sure you want to delete this booking? This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await api.delete(`/bookings/${bookingId}`);
              Alert.alert("Success", "Booking deleted successfully");
              await loadBookings();
            } catch (error: any) {
              console.error(error);
              Alert.alert("Error", error?.message || "Failed to delete booking");
            }
          },
        },
      ],
    );
  }

  async function updateBooking() {
    if (!selectedBooking) return;

    setUpdating(true);
    try {
      await api.patch(`/bookings/${selectedBooking.id}`, {
        issue_note: updateNote,
      });
      Alert.alert("Success", "Booking updated successfully");
      setModalVisible(false);
      setSelectedBooking(null);
      setUpdateNote("");
      await loadBookings();
    } catch (error) {
      console.error("Failed to update booking:", error);
      Alert.alert("Error", "Failed to update booking");
    } finally {
      setUpdating(false);
    }
  }

  async function cancelBooking(bookingId: string) {
    Alert.alert(
      "Cancel Booking",
      "Are you sure you want to cancel this booking?",
      [
        { text: "No", style: "cancel" },
        {
          text: "Yes",
          style: "destructive",
          onPress: async () => {
            try {
              await api.patch(`/bookings/${bookingId}/status`, {
                status: "cancelled",
              });
              Alert.alert("Success", "Booking cancelled successfully");
              await loadBookings();
            } catch (error) {
              console.error("Failed to cancel booking:", error);
              Alert.alert("Error", "Failed to cancel booking");
            }
          },
        },
      ],
    );
  }

  const openUpdateModal = (booking: Booking) => {
    setSelectedBooking(booking);
    setUpdateNote(booking.issue_note || "");
    setModalVisible(true);
  };

  const openRatingsModal = (booking: Booking) => {
    setSelectedRatingsBooking(booking);
    setRatingsModalVisible(true);
  };

  // Helper function to render star rating
  const renderStars = (rating: number | null | undefined) => {
    if (!rating) return <Text style={styles.noRatingText}>No rating yet</Text>;

    const stars = [];
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 !== 0;

    for (let i = 1; i <= 5; i++) {
      if (i <= fullStars) {
        stars.push(<Ionicons key={i} name="star" size={16} color="#FBBF24" />);
      } else if (hasHalfStar && i === fullStars + 1) {
        stars.push(
          <Ionicons key={i} name="star-half" size={16} color="#FBBF24" />,
        );
      } else {
        stars.push(
          <Ionicons key={i} name="star-outline" size={16} color="#CBD5E1" />,
        );
      }
    }
    return (
      <View style={styles.starsContainer}>
        {stars}
        <Text style={styles.ratingText}> ({rating.toFixed(1)})</Text>
      </View>
    );
  };
  console.log(selectedRatingsBooking);
  const renderRatingsModal = () => {
    if (!selectedRatingsBooking) return null;

    return (
      <Modal
        animationType="slide"
        transparent={true}
        visible={ratingsModalVisible}
        onRequestClose={() => setRatingsModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <ScrollView>
            <View style={styles.ratingsModalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Ratings & Reviews</Text>
                <TouchableOpacity onPress={() => setRatingsModalVisible(false)}>
                  <Ionicons name="close" size={24} color="#64748B" />
                </TouchableOpacity>
              </View>

              <View style={styles.ratingsBody}>
                <View style={styles.bookingInfo}>
                  <Text style={styles.bookingInfoText}>
                    Booking #{selectedRatingsBooking.id.slice(0, 8)}
                  </Text>
                  <Text style={styles.bookingInfoDate}>
                    {new Date(
                      selectedRatingsBooking.created_at,
                    ).toLocaleDateString()}
                  </Text>
                </View>

                {/* Customer's Rating of Mechanic */}
                <View style={styles.ratingSection}>
                  <View style={styles.ratingHeader}>
                    <View style={styles.ratingTitleContainer}>
                      <Ionicons
                        name="person-outline"
                        size={20}
                        color="#0F172A"
                      />
                      <Text style={styles.ratingTitle}>Your Rating</Text>
                    </View>
                    <Text style={styles.ratingRoleBadge}>Customer</Text>
                  </View>

                  <View style={styles.ratingContent}>
                    {selectedRatingsBooking.customer_rating ? (
                      <>
                        <View style={styles.ratingStarsLarge}>
                          {renderStars(selectedRatingsBooking.customer_rating)}
                        </View>
                        {selectedRatingsBooking.customer_review && (
                          <View style={styles.reviewContainer}>
                            <Text style={styles.reviewLabel}>Your Review:</Text>
                            <Text style={styles.reviewText}>
                              "{selectedRatingsBooking.customer_review}&quot;
                            </Text>
                          </View>
                        )}
                      </>
                    ) : (
                      <View style={styles.noRatingContainer}>
                        <Ionicons
                          name="star-outline"
                          size={32}
                          color="#CBD5E1"
                        />
                        <Text style={styles.noRatingText}>
                          You haven't rated this service yet
                        </Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Mechanic's Rating of Customer */}
                <View style={styles.ratingSection}>
                  <View style={styles.ratingHeader}>
                    <View style={styles.ratingTitleContainer}>
                      <Ionicons
                        name="construct-outline"
                        size={20}
                        color="#0F172A"
                      />
                      <Text style={styles.ratingTitle}>Mechanic's Rating</Text>
                    </View>
                    <Text
                      style={[styles.ratingRoleBadge, styles.mechanicBadge]}
                    >
                      Mechanic
                    </Text>
                  </View>

                  <View style={styles.ratingContent}>
                    {selectedRatingsBooking.mechanic_rating ? (
                      <>
                        <View style={styles.ratingStarsLarge}>
                          {renderStars(selectedRatingsBooking.mechanic_rating)}
                        </View>
                        {selectedRatingsBooking.mechanic_review && (
                          <View style={styles.reviewContainer}>
                            <Text style={styles.reviewLabel}>
                              Mechanic's Review:
                            </Text>
                            <Text style={styles.reviewText}>
                              "{selectedRatingsBooking.mechanic_review}"
                            </Text>
                          </View>
                        )}
                      </>
                    ) : (
                      <View style={styles.noRatingContainer}>
                        <Ionicons
                          name="time-outline"
                          size={32}
                          color="#CBD5E1"
                        />
                        <Text style={styles.noRatingText}>
                          Mechanic hasn't rated yet
                        </Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Service Details */}
                <View style={styles.serviceDetails}>
                  <Text style={styles.serviceDetailsTitle}>
                    Service Details
                  </Text>
                  <View style={styles.serviceDetailRow}>
                    <Text style={styles.serviceDetailLabel}>Service:</Text>
                    <Text style={styles.serviceDetailValue}>
                      {selectedRatingsBooking.service?.name ||
                        "Roadside Assistance"}
                    </Text>
                  </View>

                  <View style={styles.serviceDetailRow}>
                    <Text style={styles.serviceDetailLabel}>Status:</Text>
                    <Text
                      style={[
                        styles.serviceDetailValue,
                        selectedRatingsBooking.status === "completed" &&
                          styles.completedStatus,
                        selectedRatingsBooking.status === "cancelled" &&
                          styles.cancelledStatus,
                      ]}
                    >
                      {selectedRatingsBooking.status?.toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.serviceDetailRow}>
                    <Text style={styles.serviceDetailLabel}>Completed:</Text>
                    <Text style={styles.serviceDetailValue}>
                      {selectedRatingsBooking.completed_at
                        ? new Date(
                            selectedRatingsBooking.completed_at,
                          ).toLocaleString()
                        : "Not completed yet"}
                    </Text>
                  </View>

                  <View style={styles.serviceDetailRow}>
                    <Text style={styles.serviceDetailLabel}>
                      Vehicle Model:
                    </Text>
                    <Text style={styles.serviceDetailValue}>
                      {selectedRatingsBooking?.vehicle_model}
                    </Text>
                  </View>

                  <View style={styles.serviceDetailRow}>
                    <Text style={styles.serviceDetailLabel}>Vehicle Type:</Text>
                    <Text style={styles.serviceDetailValue}>
                      {selectedRatingsBooking?.vehicle_type}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.closeRatingsButton}
                  onPress={() => setRatingsModalVisible(false)}
                >
                  <Text style={styles.closeRatingsButtonText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    );
  };

  const renderBookingCard = ({ item }: { item: Booking }) => {
    const isActive = item.status !== "completed" && item.status !== "cancelled";
    const isCancellable =
      item.status === "requested" || item.status === "accepted";
    const hasRatings = item.customer_rating || item.mechanic_rating;

    return (
      <View style={styles.cardWrapper}>
        <BookingStatusCard booking={item} />

        {/* Rating Summary Badge */}
        {(item.status === "completed" || item.customer_rating) && (
          <TouchableOpacity
            style={styles.ratingSummaryBadge}
            onPress={() => openRatingsModal(item)}
          >
            <View style={styles.ratingSummaryLeft}>
              <Ionicons name="star" size={16} color="#FBBF24" />
              <Text style={styles.ratingSummaryText}>
                {item.customer_rating
                  ? `${item.customer_rating.toFixed(1)}`
                  : "Rate"}
                {item.customer_rating ? " ★" : " Service"}
              </Text>
            </View>
            <View style={styles.ratingSummaryRight}>
              {item.mechanic_rating && (
                <View style={styles.mechanicRatingBadge}>
                  <Ionicons
                    name="construct-outline"
                    size={12}
                    color="#10B981"
                  />
                  <Text style={styles.mechanicRatingText}>
                    {item.mechanic_rating.toFixed(1)} ★
                  </Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
            </View>
          </TouchableOpacity>
        )}

        <View style={styles.actionButtons}>
          {isActive && (
            <>
              <TouchableOpacity
                style={[styles.actionButton, styles.updateButton]}
                onPress={() => openUpdateModal(item)}
              >
                <Ionicons name="create-outline" size={18} color="#2563EB" />
                <Text style={styles.updateButtonText}>Update</Text>
              </TouchableOpacity>

              {isCancellable && (
                <TouchableOpacity
                  style={[styles.actionButton, styles.cancelButton]}
                  onPress={() => cancelBooking(item.id)}
                >
                  <Ionicons
                    name="close-circle-outline"
                    size={18}
                    color="#EF4444"
                  />
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          <TouchableOpacity
            style={[styles.actionButton, styles.deleteButton]}
            onPress={() => deleteBooking(item.id)}
          >
            <Ionicons name="trash-outline" size={18} color="#EF4444" />
            <Text style={styles.deleteButtonText}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (loading && !refreshing) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#0F172A" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={bookings}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={["#0F172A"]}
            tintColor="#0F172A"
            title="Pull to refresh"
            titleColor="#64748B"
          />
        }
        ListHeaderComponent={
          <View>
            <Text style={styles.title}>Your Bookings</Text>
            <Text style={styles.subtitle}>
              Track, update, or cancel your roadside requests.
            </Text>
          </View>
        }
        renderItem={renderBookingCard}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="receipt-outline" size={64} color="#CBD5E1" />
            <Text style={styles.emptyStateText}>No bookings found</Text>
            <Text style={styles.emptyStateSubtext}>
              Create your first booking from the Customer tab
            </Text>
          </View>
        }
      />

      {/* Update Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Update Booking</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={24} color="#64748B" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.bookingId}>
                Booking #{selectedBooking?.id.slice(0, 8)}
              </Text>

              <Text style={styles.label}>Issue Description</Text>
              <TextInput
                style={styles.textArea}
                value={updateNote}
                onChangeText={setUpdateNote}
                placeholder="Describe your issue..."
                multiline
                numberOfLines={4}
                editable={!updating}
              />

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelModalButton]}
                  onPress={() => setModalVisible(false)}
                  disabled={updating}
                >
                  <Text style={styles.cancelModalButtonText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalButton, styles.updateModalButton]}
                  onPress={updateBooking}
                  disabled={updating}
                >
                  {updating ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <Text style={styles.updateModalButtonText}>Update</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Ratings Modal */}
      {renderRatingsModal()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC", marginTop: 20 },
  content: { padding: 16, flexGrow: 1 },
  title: { fontSize: 28, fontWeight: "800", color: "#0F172A", marginTop: 10 },
  subtitle: { fontSize: 14, color: "#64748B", marginTop: 6, marginBottom: 18 },
  centerContent: { flex: 1, justifyContent: "center", alignItems: "center" },

  cardWrapper: {
    marginBottom: 16,
  },

  ratingSummaryBadge: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#FFF",
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },

  ratingSummaryLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },

  ratingSummaryText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0F172A",
  },

  ratingSummaryRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  mechanicRatingBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F0FDF4",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },

  mechanicRatingText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#10B981",
  },

  actionButtons: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
    justifyContent: "flex-end",
  },

  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },

  updateButton: {
    backgroundColor: "#EFF6FF",
  },

  updateButtonText: {
    color: "#2563EB",
    fontSize: 12,
    fontWeight: "600",
  },

  cancelButton: {
    backgroundColor: "#FEF2F2",
  },

  cancelButtonText: {
    color: "#EF4444",
    fontSize: 12,
    fontWeight: "600",
  },

  deleteButton: {
    backgroundColor: "#FEF2F2",
  },

  deleteButtonText: {
    color: "#EF4444",
    fontSize: 12,
    fontWeight: "600",
  },

  emptyState: {
    padding: 32,
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#64748B",
    marginBottom: 8,
    marginTop: 12,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: "#94A3B8",
    textAlign: "center",
  },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
  },
  modalContent: {
    backgroundColor: "#FFF",
    borderRadius: 20,
    width: "90%",
    maxWidth: 400,
    overflow: "hidden",
  },
  ratingsModalContent: {
    backgroundColor: "#FFF",
    borderRadius: 20,
    width: "100%",
    // maxWidth: 500,
    marginVertical: 40,
    alignSelf: "center",
    overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0F172A",
  },
  modalBody: {
    padding: 20,
  },
  ratingsBody: {
    padding: 20,
  },
  bookingId: {
    fontSize: 14,
    fontWeight: "600",
    color: "#64748B",
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0F172A",
    marginBottom: 8,
  },
  textArea: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: "#0F172A",
    minHeight: 100,
    textAlignVertical: "top",
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: "row",
    gap: 12,
  },
  modalButton: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  cancelModalButton: {
    backgroundColor: "#F1F5F9",
  },
  cancelModalButtonText: {
    color: "#64748B",
    fontWeight: "600",
  },
  updateModalButton: {
    backgroundColor: "#0F172A",
  },
  updateModalButtonText: {
    color: "#FFF",
    fontWeight: "600",
  },

  // Ratings Modal Styles
  bookingInfo: {
    backgroundColor: "#F1F5F9",
    padding: 12,
    borderRadius: 12,
    marginBottom: 20,
  },
  bookingInfoText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0F172A",
  },
  bookingInfoDate: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 4,
  },
  ratingSection: {
    marginBottom: 24,
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
  ratingTitleContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  ratingTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0F172A",
  },
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
  mechanicBadge: {
    backgroundColor: "#F0FDF4",
    color: "#10B981",
  },
  ratingContent: {
    padding: 16,
  },
  ratingStarsLarge: {
    marginBottom: 12,
  },
  starsContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  ratingText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0F172A",
    marginLeft: 4,
  },
  reviewContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
  },
  reviewLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
    marginBottom: 8,
  },
  reviewText: {
    fontSize: 14,
    color: "#0F172A",
    lineHeight: 20,
    fontStyle: "italic",
  },
  noRatingContainer: {
    alignItems: "center",
    paddingVertical: 20,
  },
  noRatingText: {
    fontSize: 13,
    color: "#94A3B8",
    marginTop: 8,
  },
  serviceDetails: {
    marginTop: 8,
    padding: 16,
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
  },
  serviceDetailsTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
    marginBottom: 12,
  },
  serviceDetailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  serviceDetailLabel: {
    fontSize: 13,
    color: "#64748B",
  },
  serviceDetailValue: {
    fontSize: 13,
    fontWeight: "500",
    color: "#0F172A",
  },
  completedStatus: {
    color: "#10B981",
  },
  cancelledStatus: {
    color: "#EF4444",
  },
  closeRatingsButton: {
    marginTop: 20,
    backgroundColor: "#0F172A",
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  closeRatingsButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "600",
  },
});
