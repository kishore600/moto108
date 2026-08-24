/* eslint-disable react/no-unescaped-entities */
// app/(tabs)/bookings.tsx (or wherever your bookings screen is)
import { useEffect, useState, useCallback, useMemo } from "react";
import {
  FlatList,
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
import { SafeAreaView } from "react-native-safe-area-context";
import { BookingStatusCard } from "@/components/BookingStatusCard";
import { api } from "@/lib/api";
import { Booking } from "@/types";
import { useAuth } from "@/context/AuthContext";
import { Ionicons } from "@expo/vector-icons";

const PAGE_SIZE = 5;
// Adjust this to match the height of your bottom tab bar so the list
// never gets hidden behind it.
const TAB_BAR_CLEARANCE = 90;

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

  // --- Search & pagination state ---
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

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
      setCurrentPage(1);
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
              Alert.alert("Error", error?.message ?? "Failed to delete booking");
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

  // Helper function to render star rating (only ever called with a real rating)
  const renderStars = (rating: number | null | undefined) => {
    if (!rating) return null;

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

  // ---------------------------------------------------------------------
  // Search filtering
  // ---------------------------------------------------------------------
  const filteredBookings = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return bookings;

    return bookings.filter((b: any) => {
      const idMatch = b.id?.toLowerCase().includes(query);
      const statusMatch = b.status?.toLowerCase().includes(query);
      const noteMatch = b.issue_note?.toLowerCase().includes(query);
      const serviceMatch = b.service?.name?.toLowerCase().includes(query);
      const vehicleMatch = b.vehicle_model?.toLowerCase().includes(query);
      return idMatch || statusMatch || noteMatch || serviceMatch || vehicleMatch;
    });
  }, [bookings, searchQuery]);

  // Reset to page 1 whenever the search query (or underlying data) changes,
  // so the user is never stranded on an out-of-range page.
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, bookings.length]);

  const totalPages = Math.max(1, Math.ceil(filteredBookings.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedBookings = useMemo(() => {
    const start = (safeCurrentPage - 1) * PAGE_SIZE;
    return filteredBookings.slice(start, start + PAGE_SIZE);
  }, [filteredBookings, safeCurrentPage]);

  const goToPage = (page: number) => {
    if (page < 1 || page > totalPages) return;
    setCurrentPage(page);
  };

  const renderRatingsModal = () => {
    if (!selectedRatingsBooking) return null;

    const hasCustomerRating = !!selectedRatingsBooking.customer_rating;
    const hasMechanicRating = !!selectedRatingsBooking.mechanic_rating;

    return (
      <Modal
        animationType="slide"
        transparent={true}
        visible={ratingsModalVisible}
        onRequestClose={() => setRatingsModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.ratingsModalContent}>
            {/* Fixed header — never scrolls, never overlaps the body */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Ratings & Reviews</Text>
              <TouchableOpacity
                onPress={() => setRatingsModalVisible(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.ratingsScroll}
              contentContainerStyle={styles.ratingsBody}
              showsVerticalScrollIndicator={false}
            >
              {/* Booking summary strip */}
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

              {/* Ratings — one unified card, two compact rows */}
              <View style={styles.ratingsCard}>
                {/* Customer's rating of the mechanic */}
                <View style={styles.ratingRow}>
                  <View style={styles.ratingRowHeader}>
                    <View style={styles.ratingTitleContainer}>
                      <Ionicons
                        name="person-outline"
                        size={16}
                        color="#0F172A"
                      />
                      <Text style={styles.ratingTitle}>Your Rating</Text>
                    </View>
                    <Text style={styles.ratingRoleBadge}>Customer</Text>
                  </View>

                  {hasCustomerRating ? (
                    <>
                      {renderStars(selectedRatingsBooking.customer_rating)}
                      {selectedRatingsBooking.customer_review ? (
                        <Text style={styles.reviewText} numberOfLines={4}>
                          "{selectedRatingsBooking.customer_review}"
                        </Text>
                      ) : null}
                    </>
                  ) : (
                    <View style={styles.noRatingRow}>
                      <Ionicons
                        name="star-outline"
                        size={15}
                        color="#94A3B8"
                      />
                      <Text style={styles.noRatingText}>
                        You haven't rated this service yet
                      </Text>
                    </View>
                  )}
                </View>

                <View style={styles.ratingDivider} />

               
              </View>

              {/* Service details */}
              <View style={styles.serviceDetails}>
                <Text style={styles.serviceDetailsTitle}>
                  Service Details
                </Text>

                <View style={styles.serviceDetailRow}>
                  <Text style={styles.serviceDetailLabel}>Service</Text>
                  <Text style={styles.serviceDetailValue}>
                    {selectedRatingsBooking.service?.name ||
                      "Roadside Assistance"}
                  </Text>
                </View>

                <View style={styles.serviceDetailRow}>
                  <Text style={styles.serviceDetailLabel}>Status</Text>
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
                  <Text style={styles.serviceDetailLabel}>Completed</Text>
                  <Text style={styles.serviceDetailValue}>
                    {selectedRatingsBooking.completed_at
                      ? new Date(
                          selectedRatingsBooking.completed_at,
                        ).toLocaleString()
                      : "Not completed yet"}
                  </Text>
                </View>

                {selectedRatingsBooking.vehicle_model ? (
                  <View style={styles.serviceDetailRow}>
                    <Text style={styles.serviceDetailLabel}>
                      Vehicle Model
                    </Text>
                    <Text style={styles.serviceDetailValue}>
                      {selectedRatingsBooking.vehicle_model}
                    </Text>
                  </View>
                ) : null}

                {selectedRatingsBooking.vehicle_type ? (
                  <View
                    style={[styles.serviceDetailRow, styles.serviceDetailRowLast]}
                  >
                    <Text style={styles.serviceDetailLabel}>
                      Vehicle Type
                    </Text>
                    <Text style={styles.serviceDetailValue}>
                      {selectedRatingsBooking.vehicle_type}
                    </Text>
                  </View>
                ) : null}
              </View>
            </ScrollView>

            {/* Fixed footer button — never scrolls with the content */}
            <View style={styles.ratingsModalFooter}>
              <TouchableOpacity
                style={styles.closeRatingsButton}
                onPress={() => setRatingsModalVisible(false)}
              >
                <Text style={styles.closeRatingsButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  const renderBookingCard = ({ item }: { item: Booking }) => {
    const isActive = item.status !== "completed" && item.status !== "cancelled";
    const isCancellable =
      item.status === "requested" || item.status === "accepted";

    return (
      <View style={styles.cardWrapper}>
        {/* Icon-only delete button, pinned to the top-right corner of the
            card. It sits on top of BookingStatusCard via absolute
            positioning so it never pushes other content around or
            overlaps the row below. */}
        <TouchableOpacity
          style={styles.deleteIconButton}
          onPress={() => deleteBooking(item.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="trash-outline" size={16} color="#EF4444" />
        </TouchableOpacity>

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

        {isActive && (
          <View style={styles.actionButtons}>
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
          </View>
        )}
      </View>
    );
  };

  // ---------------------------------------------------------------------
  // Pagination footer (numbered, with prev/next)
  // ---------------------------------------------------------------------
  const renderPagination = () => {
    if (filteredBookings.length === 0) return null;

    const pageNumbers: number[] = [];
    for (let i = 1; i <= totalPages; i++) pageNumbers.push(i);

    return (
      <View style={styles.paginationWrapper}>
        {/* Left arrow — fixed-width slot, pinned to the left edge */}
        <View style={styles.pageArrowSlot}>
          <TouchableOpacity
            style={[
              styles.pageArrow,
              safeCurrentPage === 1 && styles.pageArrowDisabled,
            ]}
            disabled={safeCurrentPage === 1}
            onPress={() => goToPage(safeCurrentPage - 1)}
          >
            <Ionicons
              name="chevron-back"
              size={18}
              color={safeCurrentPage === 1 ? "#CBD5E1" : "#0F172A"}
            />
          </TouchableOpacity>
        </View>

        {/* Page numbers — this block gets equal space on both sides
            (flex: 1, centered content), so it's centered in the wrapper
            regardless of the arrow slots' width. */}
        <View style={styles.pageNumbersCenter}>
          {pageNumbers.length > 5 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pageNumbersRow}
            >
              {pageNumbers.map((page) => {
                const active = page === safeCurrentPage;
                return (
                  <TouchableOpacity
                    key={page}
                    style={[styles.pageChip, active && styles.pageChipActive]}
                    onPress={() => goToPage(page)}
                  >
                    <Text
                      style={[
                        styles.pageChipText,
                        active && styles.pageChipTextActive,
                      ]}
                    >
                      {page}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : (
            <View style={styles.pageNumbersRowStatic}>
              {pageNumbers.map((page) => {
                const active = page === safeCurrentPage;
                return (
                  <TouchableOpacity
                    key={page}
                    style={[styles.pageChip, active && styles.pageChipActive]}
                    onPress={() => goToPage(page)}
                  >
                    <Text
                      style={[
                        styles.pageChipText,
                        active && styles.pageChipTextActive,
                      ]}
                    >
                      {page}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* Right arrow — fixed-width slot, pinned to the right edge */}
        <View style={styles.pageArrowSlot}>
          <TouchableOpacity
            style={[
              styles.pageArrow,
              safeCurrentPage === totalPages && styles.pageArrowDisabled,
            ]}
            disabled={safeCurrentPage === totalPages}
            onPress={() => goToPage(safeCurrentPage + 1)}
          >
            <Ionicons
              name="chevron-forward"
              size={18}
              color={safeCurrentPage === totalPages ? "#CBD5E1" : "#0F172A"}
            />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (loading && !refreshing) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#0F172A" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      {/* Fixed header — sits above the list, never overlaps it */}
      <View style={styles.header}>
        <Text style={styles.title}>Your Bookings</Text>
        <Text style={styles.subtitle}>
          Track, update, or cancel your roadside requests.
        </Text>

        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={18} color="#94A3B8" />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search by ID, status, service, vehicle..."
            placeholderTextColor="#94A3B8"
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery("")}>
              <Ionicons name="close-circle" size={18} color="#94A3B8" />
            </TouchableOpacity>
          )}
        </View>

        {searchQuery.length > 0 && (
          <Text style={styles.resultsCount}>
            {filteredBookings.length} result
            {filteredBookings.length === 1 ? "" : "s"}
          </Text>
        )}
      </View>

      <FlatList
        data={paginatedBookings}
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
        renderItem={renderBookingCard}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="receipt-outline" size={64} color="#CBD5E1" />
            <Text style={styles.emptyStateText}>
              {searchQuery ? "No matching bookings" : "No bookings found"}
            </Text>
            <Text style={styles.emptyStateSubtext}>
              {searchQuery
                ? "Try a different search term"
                : "Create your first booking from the Customer tab"}
            </Text>
          </View>
        }
        ListFooterComponent={renderPagination}
        ListFooterComponentStyle={styles.footerWrapper}
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
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  centerContent: { flex: 1, justifyContent: "center", alignItems: "center" },

  // --- Fixed header ---
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: "#F8FAFC",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    zIndex: 10,
  },
  title: { fontSize: 26, fontWeight: "800", color: "#0F172A" },
  subtitle: { fontSize: 13, color: "#64748B", marginTop: 4, marginBottom: 14 },

  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: "#0F172A",
    height: "100%",
  },
  resultsCount: {
    marginTop: 8,
    fontSize: 12,
    color: "#94A3B8",
  },

  // --- List content ---
  content: {
    padding: 16,
    paddingBottom: TAB_BAR_CLEARANCE,
    flexGrow: 1,
  },
  separator: { height: 16 },

  cardWrapper: {
    // each card is a fully self-contained block; the ItemSeparatorComponent
    // (not margin) creates spacing, so cards never overlap.
    position: "relative",
  },

  // Icon-only delete button, absolutely positioned over the top-right
  // corner of the card. zIndex/elevation keeps it tappable above
  // BookingStatusCard's own content.
  deleteIconButton: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#FEF2F2",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 5,
    elevation: 5,
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

  emptyState: {
    padding: 32,
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    minHeight: 300,
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

  // --- Pagination ---
  footerWrapper: {
    marginTop: 8,
  },
  paginationWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  // Fixed-width slots for the prev/next arrows. Because both slots are
  // the same width, the pageNumbersCenter block between them (flex: 1)
  // is always mathematically centered in the wrapper — it can't drift
  // left or right as the page count changes.
  pageArrowSlot: {
    width: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  pageArrow: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F1F5F9",
  },
  pageArrowDisabled: {
    backgroundColor: "#F8FAFC",
  },
  pageNumbersCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    // small nudge to the right so the visual weight of the numbers sits
    // dead-center between the two arrows
    paddingLeft: 6,
  },
  pageNumbersRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pageNumbersRowStatic: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  pageChip: {
    minWidth: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    backgroundColor: "#F1F5F9",
  },
  pageChipActive: {
    backgroundColor: "#0F172A",
  },
  pageChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748B",
  },
  pageChipTextActive: {
    color: "#FFF",
  },

  // --- Modal styles ---
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
    width: "90%",
    maxWidth: 480,
    maxHeight: "82%",
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

  // --- Ratings Modal styles ---
  ratingsScroll: {
    flexGrow: 0,
  },
  ratingsBody: {
    padding: 16,
    paddingBottom: 4,
  },
  bookingInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 14,
  },
  bookingInfoText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0F172A",
  },
  bookingInfoDate: {
    fontSize: 12,
    color: "#64748B",
  },

  // One card, two compact rows — replaces the old two-separate-boxes layout
  ratingsCard: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 14,
  },
  ratingRow: {
    padding: 12,
  },
  ratingDivider: {
    height: 1,
    backgroundColor: "#E2E8F0",
  },
  ratingRowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  ratingTitleContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  ratingTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0F172A",
  },
  ratingRoleBadge: {
    fontSize: 10,
    fontWeight: "700",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: "#EFF6FF",
    color: "#2563EB",
    overflow: "hidden",
  },
  mechanicBadge: {
    backgroundColor: "#F0FDF4",
    color: "#10B981",
  },
  starsContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  ratingText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0F172A",
    marginLeft: 4,
  },
  reviewText: {
    fontSize: 13,
    color: "#475569",
    lineHeight: 18,
    fontStyle: "italic",
    marginTop: 6,
  },
  // Compact single-line empty state — replaces the old large centered
  // icon + text block that ate most of the modal's height.
  noRatingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  noRatingText: {
    fontSize: 13,
    color: "#94A3B8",
  },

  serviceDetails: {
    padding: 14,
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    marginBottom: 8,
  },
  serviceDetailsTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F172A",
    marginBottom: 10,
  },
  serviceDetailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  serviceDetailRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
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

  // Fixed footer — stays pinned below the scroll area, never overlaps it
  ratingsModalFooter: {
    padding: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
  },
  closeRatingsButton: {
    backgroundColor: "#0F172A",
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
  },
  closeRatingsButtonText: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "600",
  },
});