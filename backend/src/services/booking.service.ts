// services/booking.service.ts

import { supabaseAdmin } from "../config/supabase";
import { twilioClient } from "../config/twilio";
import {
  emitBookingUpdate,
  emitMechanicLocation,
  emitNewBooking,
  getIO,
} from "../socket"; // Add emitNewBooking import

// Store active timers
const activeBookingTimers = new Map<string, NodeJS.Timeout>();

export async function getServices() {
  const { data, error } = await supabaseAdmin
    .from("services")
    .select("*")
    .order("name");
  if (error) throw error;
  return data;
}

export async function getVehicleTypes() {
  const { data, error } = await supabaseAdmin
    .from("vehicle_types")
    .select("*")
    .order("display_order");
  if (error) throw error;
  return data;
}

export async function getServicePricing() {
  const { data, error } = await supabaseAdmin
    .from("mobile_service_pricing")
    .select("*")
    .order("display_order", { ascending: true })
    .order("service_name", { ascending: true });
  if (error) throw error;
  return data;
}

export async function getPricingByVehicleType(vehicleTypeId: number) {
  const { data, error } = await supabaseAdmin
    .from("service_pricing")
    .select(
      `
      *,
      services:service_id (id, name, base_price),
      vehicle_types:vehicle_type_id (id, name, category, display_order)
    `,
    )
    .eq("vehicle_type_id", vehicleTypeId)
    .order("service_id");
  if (error) throw error;
  return data;
}

export async function getPricingByService(serviceId: string) {
  const { data, error } = await supabaseAdmin
    .from("service_pricing")
    .select(
      `
      *,
      services:service_id (id, name, base_price),
      vehicle_types:vehicle_type_id (id, name, category, display_order)
    `,
    )
    .eq("service_id", serviceId)
    .order("vehicle_type_id");
  if (error) throw error;
  return data;
}

export async function getPricingForVehicleAndService(
  vehicleTypeId: number,
  serviceId: string,
) {
  const { data, error } = await supabaseAdmin
    .from("service_pricing")
    .select(
      `
      *,
      services:service_id (id, name, base_price),
      vehicle_types:vehicle_type_id (id, name, category)
    `,
    )
    .eq("vehicle_type_id", vehicleTypeId)
    .eq("service_id", serviceId)
    .single();
  if (error && error.code !== "PGRST116") throw error;
  return data;
}

export async function createService(name: string, basePrice: number) {
  const { data, error } = await supabaseAdmin
    .from("services")
    .insert([{ name, base_price: basePrice }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateServicePricing(
  pricingId: number,
  price: number,
  notes?: string,
) {
  const { data, error } = await supabaseAdmin
    .from("service_pricing")
    .update({ price, notes })
    .eq("id", pricingId)
    .select();
  if (error) throw error;
  return data;
}

export async function getVehicleTypeByName(name: string) {
  const { data, error } = await supabaseAdmin
    .from("vehicle_types")
    .select("*")
    .eq("name", name)
    .single();
  if (error && error.code !== "PGRST116") throw error;
  return data;
}

export async function getServiceByName(name: string) {
  const { data, error } = await supabaseAdmin
    .from("services")
    .select("*")
    .eq("name", name)
    .single();
  if (error && error.code !== "PGRST116") throw error;
  return data;
}

export async function getServiceById(serviceId: string) {
  const { data, error } = await supabaseAdmin
    .from("services")
    .select("*")
    .eq("id", serviceId)
    .single();
  if (error && error.code !== "PGRST116") throw error;
  return data;
}

export async function getNearbyMechanics(
  customerLat?: number,
  customerLng?: number,
  radiusKm: number = 10,
) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select(
      "id, full_name, mechanic_status(is_online, vehicle_type, current_lat, current_lng)",
    )
    .eq("role", "mechanic");

  if (error) throw error;

  let mechanics = (data || [])
    .map((item: any) => ({
      id: item.id,
      full_name: item.full_name,
      is_online: item.mechanic_status?.is_online ?? false,
      vehicle_type: item.mechanic_status?.vehicle_type,
      current_lat: item.mechanic_status?.current_lat,
      current_lng: item.mechanic_status?.current_lng,
      distance_km: null as number | null,
    }))
    .filter((item) => item.is_online && item.current_lat && item.current_lng);

  if (customerLat && customerLng && mechanics.length > 0) {
    mechanics = mechanics.map((mechanic) => {
      const distance = calculateDistance(
        customerLat,
        customerLng,
        mechanic.current_lat!,
        mechanic.current_lng!,
      );
      return {
        ...mechanic,
        distance_km: distance,
      };
    });

    mechanics = mechanics
      .filter((mechanic) => mechanic.distance_km! <= radiusKm)
      .sort(
        (a, b) => (a.distance_km || Infinity) - (b.distance_km || Infinity),
      );
  }

  return mechanics;
}

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

export async function createBooking(payload: any) {
  payload.status = "requested";
  payload.mechanic_id = null;

  const { data, error } = await supabaseAdmin
    .from("bookings")
    .insert(payload)
    .select(
      `
      *,
      customer:profiles!bookings_customer_id_fkey(
        full_name,
        email,
        phone
      ),
      service:services(
        id,
        name,
        base_price
      )
    `,
    )
    .single();

  if (error) throw error;

  // Start auto-cancellation timer
  startAutoCancelTimer(data.id);

  // Emit to customer who created the booking
  emitBookingUpdate(data.id, data);

  // IMPORTANT: Emit to all mechanics for new booking
  emitNewBooking(data);

  return data;
}

function startAutoCancelTimer(bookingId: string) {
  if (activeBookingTimers.has(bookingId)) {
    clearTimeout(activeBookingTimers.get(bookingId));
  }

  const timer = setTimeout(async () => {
    await autoCancelBooking(bookingId);
  }, 120000);

  activeBookingTimers.set(bookingId, timer);

  console.log(
    `⏰ Auto-cancel timer started for booking ${bookingId} (2 minutes)`,
  );
}

async function autoCancelBooking(bookingId: string) {
  try {
    const { data: booking, error: fetchError } = await supabaseAdmin
      .from("bookings")
      .select("status")
      .eq("id", bookingId)
      .single();

    if (fetchError) {
      console.error(`Error fetching booking ${bookingId}:`, fetchError);
      return;
    }

    if (booking && booking.status === "requested") {
      const { data, error } = await supabaseAdmin
        .from("bookings")
        .update({
          status: "cancelled",
          updated_at: new Date().toISOString(),
          cancellation_reason: "auto_cancelled_no_mechanic",
        })
        .eq("id", bookingId)
        .select("*")
        .single();

      if (error) {
        console.error(`Error auto-cancelling booking ${bookingId}:`, error);
        return;
      }

      console.log(
        `⏰ Auto-cancelled booking ${bookingId} - No mechanic accepted within 30 seconds`,
      );

      emitBookingUpdate(bookingId, {
        ...data,
        auto_cancelled: true,
        reason: "No mechanic accepted your request within 30 seconds",
      });

      // Emit to mechanics that booking is cancelled
      emitNewBooking({ ...data, status: "cancelled", auto_cancelled: true });
    }
  } catch (error) {
    console.error(`Auto-cancel failed for booking ${bookingId}:`, error);
  } finally {
    activeBookingTimers.delete(bookingId);
  }
}

export async function cancelAutoCancelTimer(bookingId: string) {
  if (activeBookingTimers.has(bookingId)) {
    clearTimeout(activeBookingTimers.get(bookingId));
    activeBookingTimers.delete(bookingId);
    console.log(`✅ Auto-cancel timer cancelled for booking ${bookingId}`);
  }
}

export async function assignMechanic(
  bookingId: string,
  mechanicId: string,
  etaMinutes: number,
) {
  // First, get the current booking to check status
  const { data: existingBooking, error: fetchError } = await supabaseAdmin
    .from("bookings")
    .select("id, status, mechanic_id")
    .eq("id", bookingId)
    .single();

  if (fetchError || !existingBooking) {
    throw new Error("Booking not found");
  }

  // Validate booking status
  if (existingBooking.status !== "requested") {
    throw new Error(
      `Booking is not in requested status. Current status: ${existingBooking.status}`,
    );
  }

  // Check if already assigned to a mechanic
  if (existingBooking.mechanic_id) {
    throw new Error("Booking already assigned to a mechanic");
  }

  // Cancel auto-cancel timer if exists
  await cancelAutoCancelTimer(bookingId);

  // Update the booking - use the fetched data to ensure we're updating the correct one
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .update({
      mechanic_id: mechanicId,
      status: "accepted",
      eta_minutes: etaMinutes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", bookingId)
    .eq("status", "requested") // Additional safety: only update if still requested
    .is("mechanic_id", null) // Additional safety: only update if no mechanic assigned
    .select(
      `
      *,
      customer:profiles!bookings_customer_id_fkey(
        full_name, 
        email,
        phone
      ),
      mechanic:profiles!bookings_mechanic_id_fkey(
        full_name, 
        email,
        phone
      ),
      service:services(
        id,
        name,
        base_price
      )
    `,
    )
    .single();

  // Check if update was successful (no rows updated means race condition)
  if (error || !data) {
    // Check again if booking was taken by someone else
    const { data: recheck, error: recheckError } = await supabaseAdmin
      .from("bookings")
      .select("status, mechanic_id")
      .eq("id", bookingId)
      .single();

    if (!recheckError && recheck) {
      if (recheck.mechanic_id) {
        throw new Error("Booking already assigned to another mechanic");
      }
      if (recheck.status !== "requested") {
        throw new Error(`Booking status changed to ${recheck.status}`);
      }
    }

    throw new Error("Failed to assign mechanic - booking may have been taken");
  }

  // Emit socket events
  emitBookingUpdate(bookingId, data);

  // Emit booking:taken event to notify all mechanics
  const io = getIO();
  if (io) {
    io.emit("booking:taken", {
      bookingId: bookingId,
      mechanicId: mechanicId,
      message: "Booking has been accepted by another mechanic",
    });

    // Also emit to the specific booking room
    io.to(`booking:${bookingId}`).emit("booking:assigned", {
      bookingId: bookingId,
      mechanicId: mechanicId,
      status: "accepted",
    });
  }

  return data;
}

export async function getBookingById(bookingId: string) {
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select(
      `
      *,
      customer:profiles!bookings_customer_id_fkey(
        full_name, 
        email
      ),
      mechanic:profiles!bookings_mechanic_id_fkey(
        full_name, 
        email
      )
    `,
    )
    .eq("id", bookingId)
    .single();

  if (error) throw error;
  return data;
}

export async function getMechanicCurrentBooking(mechanicId: string) {
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select("*")
    .eq("mechanic_id", mechanicId)
    .in("status", ["accepted", "on_the_way", "arrived"])
    .single();

  if (error && error.code !== "PGRST116") throw error;
  return data;
}

export async function getCustomerBookings(customerId: string) {
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select(
      `
      *,
      mechanic:profiles!bookings_mechanic_id_fkey(
        full_name, 
        email
      ),
      service:services(
        name, 
        base_price
      )
    `,
    )
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getOpenBookings() {
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select(
      `
      *,
      customer:profiles!bookings_customer_id_fkey(
        full_name, 
        email,
        phone
      ),
      service:services(
        id,
        name, 
        base_price
      )
    `,
    )
    .eq("status", "requested")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function updateBookingStatus(bookingId: string, status: string) {
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", bookingId)
    .select(
      `
      *,
      customer:profiles!bookings_customer_id_fkey(
        full_name, 
        email
      ),
      mechanic:profiles!bookings_mechanic_id_fkey(
        full_name, 
        email
      )
    `,
    )
    .single();
  if (error) throw error;
  emitBookingUpdate(bookingId, data);
  return data;
}

export async function updateMechanicAvailability(
  mechanicId: string,
  data: { isOnline: boolean; currentLat?: number; currentLng?: number },
) {
  console.log(data);
  const payload = {
    profile_id: mechanicId,
    is_online: data.isOnline,
    current_lat: data.currentLat,
    current_lng: data.currentLng,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from("mechanic_status")
    .upsert(payload, { onConflict: "profile_id" });
  if (error) throw error;
  return payload;
}

export async function updateMechanicLocation(
  mechanicId: string,
  lat: number,
  lng: number,
) {
  const payload = {
    profile_id: mechanicId,
    current_lat: lat,
    current_lng: lng,
  };

  const { error } = await supabaseAdmin
    .from("mechanic_status")
    .upsert(payload, { onConflict: "profile_id" });

  if (error) throw error;

  emitMechanicLocation(payload);

  return payload;
}

function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export async function findNearestMechanic(lat: number, lng: number) {
  const { data, error } = await supabaseAdmin
    .from("mechanic_status")
    .select("profile_id, current_lat, current_lng, is_online")
    .eq("is_online", true);

  if (error) throw error;

  let nearest = null;
  let minDistance = Infinity;

  for (const mech of data || []) {
    if (!mech.current_lat || !mech.current_lng) continue;

    const dist = getDistance(lat, lng, mech.current_lat, mech.current_lng);

    if (dist < 5 && dist < minDistance) {
      minDistance = dist;
      nearest = mech;
    }
  }

  return nearest;
}

export async function cancelBooking(bookingId: string, reason?: string) {
  await cancelAutoCancelTimer(bookingId);

  const { data: booking, error: fetchError } = await supabaseAdmin
    .from("bookings")
    .select("status")
    .eq("id", bookingId)
    .single();

  if (fetchError) throw fetchError;

  if (booking.status !== "requested" && booking.status !== "accepted") {
    throw new Error("Only requested or accepted bookings can be cancelled");
  }

  const { data, error } = await supabaseAdmin
    .from("bookings")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString(),
      cancellation_reason: reason || "user_cancelled",
    })
    .eq("id", bookingId)
    .select("*")
    .single();

  if (error) throw error;
  emitBookingUpdate(bookingId, data);
  return data;
}

export async function deleteBooking(bookingId: any) {
  try {
    const { data: booking, error: fetchError } = await supabaseAdmin
      .from("bookings")
      .select("status")
      .eq("id", bookingId)
      .single();

    if (fetchError) {
      console.error("Fetch error in deleteBooking:", fetchError);
      throw new Error(`Booking not found: ${fetchError.message}`);
    }

    if (!booking) {
      throw new Error("Booking not found");
    }

    console.log("Deleting booking with status:", booking.status);

    const deletableStatuses = ["completed", "cancelled", "rejected"];

    if (!deletableStatuses.includes(booking.status)) {
      throw new Error(
        `Cannot delete booking with status '${booking.status}'. Only completed, cancelled, or rejected bookings can be deleted.`,
      );
    }

    const { error: deleteError } = await supabaseAdmin
      .from("bookings")
      .delete()
      .eq("id", bookingId);

    if (deleteError) {
      console.error("Delete error:", deleteError);
      throw new Error(`Failed to delete booking: ${deleteError.message}`);
    }

    try {
      emitBookingUpdate(bookingId, { deleted: true, id: bookingId });
    } catch (emitError) {
      console.warn("Failed to emit deletion event:", emitError);
    }

    return { success: true, message: "Booking deleted successfully" };
  } catch (error: any) {
    console.error("Error in deleteBooking function:", error);
    throw new Error(error.message || "Failed to delete booking");
  }
}

export async function updateBooking(
  bookingId: string,
  updateData: {
    issue_note?: string;
    customer_address?: string;
    updated_at: string;
  },
) {
  const { data: booking, error: fetchError } = await supabaseAdmin
    .from("bookings")
    .select("status")
    .eq("id", bookingId)
    .single();

  if (fetchError) throw fetchError;

  if (booking.status === "completed") {
    throw new Error("Cannot update a completed booking");
  }

  if (booking.status === "cancelled") {
    throw new Error("Cannot update a cancelled booking");
  }

  const { data, error } = await supabaseAdmin
    .from("bookings")
    .update(updateData)
    .eq("id", bookingId)
    .select("*")
    .single();

  if (error) throw error;

  emitBookingUpdate(bookingId, data);

  return data;
}

export async function getMechanicBookings(mechanicId: any) {
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select(
      `
      *,
      customer:profiles!bookings_customer_id_fkey(
        full_name, 
        email
      ),
      service:services(
        name, 
        base_price
      )
    `,
    )
    .eq("mechanic_id", mechanicId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function cleanupExpiredBookings() {
  console.log("🧹 Cleaning up expired bookings...");

  const twoMins_ago = new Date(Date.now() - 120000).toISOString();

  const { data: expiredBookings, error } = await supabaseAdmin
    .from("bookings")
    .select("id")
    .eq("status", "requested")
    .lt("created_at", twoMins_ago);

  if (error) {
    console.error("Error fetching expired bookings:", error);
    return;
  }

  for (const booking of expiredBookings || []) {
    await autoCancelBooking(booking.id);
  }

  console.log(`✅ Cleaned up ${expiredBookings?.length || 0} expired bookings`);
}

// services/booking.service.ts - Update the verifyOTPAndComplete function

export async function verifyOTPAndComplete(bookingId: string, otp: string, mechanicId: string) {
  // First, get the booking to verify OTP
  const { data: booking, error: fetchError } = await supabaseAdmin
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .single();

  if (fetchError) throw fetchError;

  if (!booking) {
    throw new Error("Booking not found");
  }

  // ✅ CRITICAL: Verify this is the assigned mechanic
  if (booking.mechanic_id !== mechanicId) {
    throw new Error("You are not authorized to complete this booking");
  }

  // Allow completion for arrived or on_the_way status
  if (booking.status !== "arrived" && booking.status !== "on_the_way") {
    throw new Error("Service cannot be completed at this stage");
  }

  if (!booking.completion_otp || !booking.otp_expires_at) {
    throw new Error("No OTP generated for this booking");
  }

  // Check if OTP is expired
  if (new Date(booking.otp_expires_at) < new Date()) {
    throw new Error("OTP has expired. Please generate a new OTP");
  }

  // ✅ Verify OTP (mechanic enters what customer tells them)
  if (booking.completion_otp !== otp) {
    throw new Error("Invalid OTP. Please try again");
  }

  // Update booking to completed
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", bookingId)
    .select(`
      *,
      customer:profiles!bookings_customer_id_fkey(
        id,
        full_name, 
        email,
        phone
      ),
      mechanic:profiles!bookings_mechanic_id_fkey(
        id,
        full_name, 
        email,
        phone
      ),
      service:services(
        id,
        name,
        base_price
      )
    `)
    .single();

  if (error) throw error;

  // Clear OTP fields
  await supabaseAdmin
    .from("bookings")
    .update({
      completion_otp: null,
      otp_expires_at: null,
    })
    .eq("id", bookingId);

  // Emit socket event for real-time update
  emitBookingUpdate(bookingId, data);

  return data;
}

// Add push notification function
async function sendServiceCompletionNotifications(booking: any) {
  const notifications = [];

  // Notify customer
  if (booking.customer?.expo_push_token) {
    notifications.push(
      sendPushNotification(booking.customer.expo_push_token, {
        title: "✅ Service Completed!",
        body: `Your service with ${booking.mechanic?.full_name} has been completed. Please rate your experience.`,
        data: {
          type: "service_completed",
          bookingId: booking.id,
          screen: "rating",
        },
      }),
    );
  }

  // Notify mechanic
  if (booking.mechanic?.expo_push_token) {
    notifications.push(
      sendPushNotification(booking.mechanic.expo_push_token, {
        title: "✅ Service Completed!",
        body: `You have completed service for ${booking.customer?.full_name}.`,
        data: {
          type: "service_completed",
          bookingId: booking.id,
        },
      }),
    );
  }

  await Promise.all(notifications);
}

// Helper function to send push notification
async function sendPushNotification(expoPushToken: string, message: any) {
  // Implement using Expo's push notification service
  // You'll need to add expo-server-sdk
  console.log(`Sending push notification to ${expoPushToken}:`, message);
}
// New function to add customer rating after completion
export async function addCustomerRating(
  bookingId: string,
  rating: number,
  review?: string,
) {
  if (rating < 1 || rating > 5) {
    throw new Error("Rating must be between 1 and 5");
  }

  const { data: booking, error: fetchError } = await supabaseAdmin
    .from("bookings")
    .select("*, customer_id, mechanic_id")
    .eq("id", bookingId)
    .single();

  if (fetchError) throw fetchError;

  if (booking.status !== "completed") {
    throw new Error("Can only rate completed bookings");
  }

  if (booking.customer_rating) {
    throw new Error("Rating already submitted for this booking");
  }

  const { data, error } = await supabaseAdmin
    .from("bookings")
    .update({
      customer_rating: rating,
      customer_review: review || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", bookingId)
    .select(
      `
            *,
            customer:profiles!bookings_customer_id_fkey(
                full_name, 
                email,
                phone
            ),
            mechanic:profiles!bookings_mechanic_id_fkey(
                full_name, 
                email,
                phone
            ),
            service:services(
                id,
                name,
                base_price
            )
        `,
    )
    .single();

  if (error) throw error;

  // Create review in reviews table
  await supabaseAdmin.from("reviews").insert({
    booking_id: bookingId,
    reviewer_id: booking.customer_id,
    reviewee_id: booking.mechanic_id,
    rating: rating,
    review: review || null,
    reviewer_role: "customer",
  });

  emitBookingUpdate(bookingId, data);
  return data;
}

// Generate OTP for job completion.
// The OTP is texted to the CUSTOMER, not shown to the mechanic — the whole
// point is that the mechanic has to ask the customer for it on-site, so
// completion actually requires the customer's involvement.
export async function generateCompletionOTP(
  bookingId: string,
  mechanicId: string,
): Promise<{ sent: boolean; devOtp?: string }> {
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from("bookings")
    .select("mechanic_id, status")
    .eq("id", bookingId)
    .single();

  if (fetchError || !existing) {
    throw new Error("Booking not found");
  }

  if (existing.mechanic_id !== mechanicId) {
    throw new Error("You are not authorized to generate an OTP for this booking");
  }

  if (existing.status !== "arrived") {
    throw new Error(
      "OTP can only be generated after you've marked yourself as arrived",
    );
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

  const { data, error } = await supabaseAdmin
    .from("bookings")
    .update({
      completion_otp: otp,
      otp_expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", bookingId)
    .eq("status", "arrived") // Only if mechanic has arrived
    .eq("mechanic_id", mechanicId)
    .select("customer:profiles!bookings_customer_id_fkey(phone)")
    .single();

  if (error) throw error;

  let sent = false;
  const customerPhone = (data as any)?.customer?.phone;

  if (customerPhone) {
    try {
      await twilioClient.messages.create({
        body: `Your RoadAssist completion code is ${otp}. Only share it with your mechanic once the job is done. It expires in 10 minutes.`,
        to: customerPhone,
        from: process.env.TWILIO_PHONE_NUMBER,
      });
      sent = true;
    } catch (twilioError) {
      console.error(`Failed to SMS completion OTP for booking ${bookingId}:`, twilioError);
    }
  } else {
    console.error(`No customer phone on file for booking ${bookingId}; completion OTP not sent`);
  }

  console.log(`Completion OTP generated for booking ${bookingId} (sent: ${sent})`);

  return {
    sent,
    ...(process.env.NODE_ENV !== "production" ? { devOtp: otp } : {}),
  };
}

// Mechanic submits rating for customer
export async function addMechanicRating(
  bookingId: string,
  rating: number,
  review?: string,
) {
  if (rating < 1 || rating > 5) {
    throw new Error("Rating must be between 1 and 5");
  }

  const { data: booking, error: fetchError } = await supabaseAdmin
    .from("bookings")
    .select("status, mechanic_id")
    .eq("id", bookingId)
    .single();

  if (fetchError) throw fetchError;

  if (booking.status !== "completed") {
    throw new Error("Can only rate completed bookings");
  }

  const { data, error } = await supabaseAdmin
    .from("bookings")
    .update({
      mechanic_rating: rating,
      mechanic_review: review || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", bookingId)
    .select()
    .single();

  if (error) throw error;

  // Create review in reviews table
  await supabaseAdmin.from("reviews").insert({
    booking_id: bookingId,
    reviewer_id: booking.mechanic_id,
    reviewee_id: data.customer_id,
    rating: rating,
    review: review || null,
    reviewer_role: "mechanic",
  });

  emitBookingUpdate(bookingId, data);
  return data;
}

// Get booking details with ratings
export async function getBookingWithRatings(bookingId: string) {
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select(
      `
            *,
            customer:profiles!bookings_customer_id_fkey(
                id,
                full_name, 
                email,
                phone
            ),
            mechanic:profiles!bookings_mechanic_id_fkey(
                id,
                full_name, 
                email,
                phone
            ),
            service:services(
                id,
                name,
                base_price
            ),
            customer_review_entry:reviews!reviews_booking_id_fkey(
                rating,
                review,
                created_at
            )
        `,
    )
    .eq("id", bookingId)
    .single();

  if (error) throw error;
  return data;
}

export async function getMechanicTodayEarnings(mechanicId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select("amount")
    .eq("mechanic_id", mechanicId)
    .eq("status", "completed")
    .gte("completed_at", today.toISOString())
    .lt("completed_at", tomorrow.toISOString());

  if (error) throw error;

  const total =
    data?.reduce((sum, booking) => sum + (booking.amount || 0), 0) || 0;

  return {
    total,
    count: data?.length || 0,
  };
}

// Get mechanic's average rating
export async function getMechanicRating(mechanicId: string) {
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select("customer_rating")
    .eq("mechanic_id", mechanicId)
    .not("customer_rating", "is", null);

  if (error) throw error;

  if (!data || data.length === 0) {
    return { average_rating: 0, total_reviews: 0 };
  }

  const totalRating = data.reduce(
    (sum, booking) => sum + (booking.customer_rating || 0),
    0,
  );
  const averageRating = totalRating / data.length;

  return {
    average_rating: parseFloat(averageRating.toFixed(1)),
    total_reviews: data.length,
  };
}
