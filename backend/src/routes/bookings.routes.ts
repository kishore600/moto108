import { Router, Request, Response } from "express";
import {
  assignMechanic,
  createBooking,
  getCustomerBookings,
  getOpenBookings,
  updateBookingStatus,
  deleteBooking,
  cancelBooking,
  updateBooking,
  getBookingById,
  getMechanicCurrentBooking,
  getMechanicBookings,
  generateCompletionOTP,
  verifyOTPAndComplete,
  addMechanicRating,
  getMechanicRating,
  addCustomerRating,
  getMechanicTodayEarnings,
  getPricingForVehicleAndService,
  getServiceById,
} from "../services/booking.service";
import { VEHICLE_TYPES } from '../constants/vehicleTypes';

export const bookingsRouter = Router();

// authMiddleware (mounted ahead of this router) already verified the JWT and
// attached the decoded { id, role } as req.user — these helpers stop routes
// from trusting a customerId/mechanicId supplied in the body or URL instead.
function currentUser(req: Request): { id: string; role: string } | null {
  return (req as any).user || null;
}

function requireMechanic(req: Request, res: Response): boolean {
  const user = currentUser(req);
  if (!user || user.role !== "mechanic") {
    res.status(403).json({ error: "Only mechanics can perform this action" });
    return false;
  }
  return true;
}

async function loadBookingForOwnershipCheck(bookingId: string) {
  try {
    return await getBookingById(bookingId);
  } catch (err) {
    return null;
  }
}

bookingsRouter.post("/", async (req, res) => {
  try {
    const user = currentUser(req);
    const { customerId, serviceId, customerLat, customerLng } = req.body;

    if (!customerId || !serviceId || customerLat == null || customerLng == null) {
      return res.status(400).json({
        error: "customerId, serviceId, customerLat, and customerLng are required",
      });
    }

    if (!user || user.id !== customerId) {
      return res.status(403).json({ error: "You can only create a booking for your own account" });
    }

    // Price is computed server-side from the service + vehicle type — the
    // client's own number is never trusted, since it's easy to tamper with.
    const vehicleTypeId = Number(req.body.vehicle_model);
    let amount: number | null = null;

    if (!Number.isNaN(vehicleTypeId)) {
      const pricing = await getPricingForVehicleAndService(vehicleTypeId, serviceId);
      if (pricing?.price != null) {
        amount = pricing.price;
      }
    }

    if (amount == null) {
      const service = await getServiceById(serviceId);
      if (!service) {
        return res.status(400).json({ error: "Invalid service selected" });
      }
      amount = service.base_price;
    }

    const payload = {
      customer_id: req.body.customerId,
      mechanic_id: req.body.mechanicId || null,
      service_id: req.body.serviceId,
      issue_note: req.body.issueNote,
      customer_lat: req.body.customerLat,
      customer_lng: req.body.customerLng,
      customer_address: req.body.customerAddress,
      vehicle_type: req.body.vehicle_type,
      vehicle_model: req.body.vehicle_model,
      amount,
    };

    const data = await createBooking(payload);
    res.status(201).json(data);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({
      message: "Failed to create booking",
      error: err?.message || "Failed to create booking",
    });
  }
});

bookingsRouter.get("/vehicle-types", async (_req, res) => {
  try {
    res.json({
      success: true,
      vehicleTypes: VEHICLE_TYPES
    });
  } catch (err) {
    console.error("Error fetching vehicle types:", err);
    res.status(500).json({
      error: "Failed to fetch vehicle types"
    });
  }
});

bookingsRouter.get("/customer/:customerId", async (req, res) => {
  try {
    const user = currentUser(req);
    if (!user || user.id !== req.params.customerId) {
      return res.status(403).json({ error: "You can only view your own bookings" });
    }
    const data = await getCustomerBookings(req.params.customerId);
    res.json(data);
  } catch (err: any) {
    console.error("Error fetching customer bookings:", err);
    res.status(500).json({ error: err.message || "Failed to fetch bookings" });
  }
});

bookingsRouter.get("/open", async (req, res) => {
  try {
    if (!requireMechanic(req, res)) return;
    const data = await getOpenBookings();
    res.json(data);
  } catch (err: any) {
    console.error("Error fetching open bookings:", err);
    res.status(500).json({ error: err.message || "Failed to fetch open bookings" });
  }
});

bookingsRouter.patch("/:bookingId/assign", async (req, res) => {
  try {
    if (!requireMechanic(req, res)) return;
    const { bookingId } = req.params;
    const { etaMinutes = 15 } = req.body;
    const mechanicId = currentUser(req)!.id;

    const data = await assignMechanic(bookingId, mechanicId, etaMinutes);
    res.json(data);
  } catch (error: any) {
    console.error("Error assigning mechanic:", error);

    if (error.message === "Booking not found") {
      return res.status(404).json({ error: error.message });
    }
    if (error.message === "Booking already assigned to a mechanic") {
      return res.status(409).json({
        error: error.message,
        alreadyAssigned: true
      });
    }
    if (error.message === "Booking is not in requested status") {
      return res.status(409).json({
        error: error.message,
        invalidStatus: true
      });
    }

    res.status(500).json({ error: "Failed to assign mechanic" });
  }
});

bookingsRouter.patch("/:bookingId/status", async (req, res) => {
  try {
    const user = currentUser(req);
    const booking = await loadBookingForOwnershipCheck(req.params.bookingId);
    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }
    if (!user || (user.id !== booking.customer_id && user.id !== booking.mechanic_id)) {
      return res.status(403).json({ error: "You don't have access to this booking" });
    }

    const data = await updateBookingStatus(req.params.bookingId, req.body.status);
    res.json(data);
  } catch (err: any) {
    console.error("Error updating booking status:", err);
    res.status(500).json({ error: err.message || "Failed to update booking status" });
  }
});

bookingsRouter.get("/:bookingId", async (req, res) => {
  try {
    const { bookingId } = req.params;
    const user = currentUser(req);
    const data = await getBookingById(bookingId);

    if (!user || (user.id !== data.customer_id && user.id !== data.mechanic_id)) {
      return res.status(403).json({ error: "You don't have access to this booking" });
    }

    res.json(data);
  } catch (err: any) {
    console.error(err);
    res.status(404).json({ error: "Booking not found" });
  }
});

// Cancel booking (soft delete - update status to cancelled)
bookingsRouter.patch("/:bookingId/cancel", async (req, res) => {
  try {
    const { bookingId } = req.params;
    const user = currentUser(req);
    const booking = await loadBookingForOwnershipCheck(bookingId);
    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }
    if (!user || user.id !== booking.customer_id) {
      return res.status(403).json({ error: "Only the customer who booked this can cancel it" });
    }

    const data = await cancelBooking(bookingId);
    res.json({
      success: true,
      message: "Booking cancelled successfully",
      data,
    });
  } catch (err: any) {
    console.error("Error cancelling booking:", err);
    res.status(400).json({ error: err.message || "Failed to cancel booking" });
  }
});

// Delete booking (hard delete - remove from database)
bookingsRouter.delete("/:bookingId", async (req, res) => {
  try {
    const { bookingId } = req.params;
    const user = currentUser(req);
    const booking = await loadBookingForOwnershipCheck(bookingId);
    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }
    if (!user || user.id !== booking.customer_id) {
      return res.status(403).json({ error: "Only the customer who booked this can delete it" });
    }

    const result = await deleteBooking(bookingId);
    res.json({
      success: true,
      message: "Booking deleted successfully",
      data: result,
    });
  } catch (err: any) {
    console.error("Error deleting booking:", err);
    res.status(400).json({
      error: err.message || "Failed to delete booking",
      status: "error",
    });
  }
});

bookingsRouter.patch("/:bookingId", async (req, res) => {
  try {
    const { bookingId } = req.params;
    const user = currentUser(req);
    const booking = await loadBookingForOwnershipCheck(bookingId);
    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }
    if (!user || user.id !== booking.customer_id) {
      return res.status(403).json({ error: "Only the customer who booked this can update it" });
    }

    const updateData = {
      issue_note: req.body.issue_note,
      updated_at: new Date().toISOString(),
    };

    const data = await updateBooking(bookingId, updateData);
    res.json({ success: true, message: "Booking updated successfully", data });
  } catch (err: any) {
    console.error("Error updating booking:", err);
    res.status(500).json({ error: err.message || "Failed to update booking" });
  }
});

bookingsRouter.get("/mechanic/:mechanicId", async (req, res) => {
  try {
    const user = currentUser(req);
    if (!user || user.id !== req.params.mechanicId) {
      return res.status(403).json({ error: "You can only view your own bookings" });
    }
    const { mechanicId } = req.params;
    const data = await getMechanicBookings(mechanicId);
    res.json(data);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to fetch mechanic bookings" });
  }
});

// Also add this to handle the specific endpoint used in the app
bookingsRouter.get("/mechanic/:mechanicId/current", async (req, res) => {
  try {
    const user = currentUser(req);
    if (!user || user.id !== req.params.mechanicId) {
      return res.status(403).json({ error: "You can only view your own bookings" });
    }
    const { mechanicId } = req.params;
    const data = await getMechanicCurrentBooking(mechanicId);
    res.json(data);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to fetch current booking" });
  }
});

bookingsRouter.post("/:bookingId/generate-otp", async (req, res) => {
  try {
    if (!requireMechanic(req, res)) return;
    const { bookingId } = req.params;
    const mechanicId = currentUser(req)!.id;

    const result = await generateCompletionOTP(bookingId, mechanicId);

    res.json({
      success: true,
      message: result.sent
        ? "OTP sent to the customer's phone. Ask them for it, then enter it below to complete the job."
        : "Couldn't text the OTP to the customer — ask them to check with support, then enter the code they receive below.",
      ...(result.devOtp && { devOtp: result.devOtp }),
    });
  } catch (err: any) {
    console.error("Error generating OTP:", err);
    const status =
      err.message === "Booking not found" ? 404 :
      err.message?.includes("not authorized") ? 403 :
      400;
    res.status(status).json({ error: err.message });
  }
});

bookingsRouter.post("/:bookingId/verify-otp", async (req, res) => {
  try {
    if (!requireMechanic(req, res)) return;
    const { bookingId } = req.params;
    const { otp } = req.body;
    const mechanicId = currentUser(req)!.id;

    if (!otp) {
      return res.status(400).json({ error: "OTP is required" });
    }

    const booking = await verifyOTPAndComplete(bookingId, otp, mechanicId);
    res.json({
      success: true,
      message: "Service completed successfully",
      data: booking,
    });
  } catch (err: any) {
    console.error("Error verifying OTP:", err);
    res.status(400).json({ error: err.message });
  }
});

// Endpoint 2: Add rating to completed booking
bookingsRouter.post("/:bookingId/add-rating", async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { rating, review } = req.body;
    const user = currentUser(req);

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Rating must be between 1 and 5" });
    }

    const existing = await loadBookingForOwnershipCheck(bookingId);
    if (!existing) {
      return res.status(404).json({ error: "Booking not found" });
    }
    if (!user || user.id !== existing.customer_id) {
      return res.status(403).json({ error: "Only the customer who booked this can rate it" });
    }

    const booking = await addCustomerRating(bookingId, rating, review);
    res.json({
      success: true,
      message: "Rating added successfully",
      data: booking,
    });
  } catch (err: any) {
    console.error("Error adding rating:", err);
    res.status(400).json({ error: err.message });
  }
});

// Mechanic adds rating for customer
bookingsRouter.post("/:bookingId/mechanic-rating", async (req, res) => {
  try {
    if (!requireMechanic(req, res)) return;
    const { bookingId } = req.params;
    const { rating, review } = req.body;
    const user = currentUser(req)!;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Rating must be between 1 and 5" });
    }

    const existing = await loadBookingForOwnershipCheck(bookingId);
    if (!existing) {
      return res.status(404).json({ error: "Booking not found" });
    }
    if (user.id !== existing.mechanic_id) {
      return res.status(403).json({ error: "Only the mechanic assigned to this booking can rate it" });
    }

    const booking = await addMechanicRating(bookingId, rating, review);
    res.json({
      success: true,
      message: "Rating submitted successfully",
      data: booking,
    });
  } catch (err: any) {
    console.error("Error submitting rating:", err);
    res.status(400).json({ error: err.message });
  }
});

// Get mechanic's rating stats — aggregate, non-sensitive, left open to any
// authenticated user (e.g. a customer deciding whether to accept a mechanic).
bookingsRouter.get("/mechanic/:mechanicId/rating", async (req, res) => {
  try {
    const { mechanicId } = req.params;
    const stats = await getMechanicRating(mechanicId);
    res.json(stats);
  } catch (err: any) {
    console.error("Error fetching rating:", err);
    res.status(500).json({ error: err.message });
  }
});

bookingsRouter.get("/mechanic/:mechanicId/earnings", async (req, res) => {
  try {
    const user = currentUser(req);
    if (!user || user.id !== req.params.mechanicId) {
      return res.status(403).json({ error: "You can only view your own earnings" });
    }

    const { mechanicId } = req.params;
    const earnings = await getMechanicTodayEarnings(mechanicId);

    res.json(earnings);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to fetch earnings' });
  }
});
