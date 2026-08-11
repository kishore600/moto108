// lib/socket.ts
import io, { Socket } from "socket.io-client";
import * as SecureStore from "expo-secure-store";

const SOCKET_URL = process.env.EXPO_PUBLIC_API_URL;

class SocketService {
  private socket: Socket | null = null;
  private userId: string | null = null;
  private eventListeners: Map<string, Set<Function>> = new Map();
  private isInitialized: boolean = false;
  private connectionTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (!SOCKET_URL) {
      console.error(
        "❌ SOCKET_URL is undefined. Check EXPO_PUBLIC_API_URL in eas.json env block.",
      );
      return; // Don't crash — just skip init
    }
    this.initSocket();
  }

  private initSocket() {
    if (this.isInitialized && this.socket) return;

    try {
      this.socket = io(SOCKET_URL!, {
        transports: ["polling", "websocket"], // polling first — more reliable on cold starts
        autoConnect: false, // don't connect until we explicitly call .connect()
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 2000,
        reconnectionDelayMax: 10000,
        timeout: 20000, // 20s timeout for Render cold starts
        forceNew: false,
      });

      this.setupEventHandlers();
      this.isInitialized = true;

      // Connect after setup — not during constructor
      this.socket.connect();
    } catch (error) {
      console.error("❌ Failed to initialize socket:", error);
    }
  }

  private setupEventHandlers() {
    if (!this.socket) return;

    this.socket.on("connect", () => {
      console.log("✅ Socket connected:", this.socket?.id);
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }
      this.joinUserRoom();
    });

    this.socket.on("disconnect", (reason) => {
      console.log("❌ Socket disconnected. Reason:", reason);
      // If server disconnected us, manually reconnect
      if (reason === "io server disconnect" && this.socket) {
        this.socket.connect();
      }
    });

    this.socket.on("connect_error", (error) => {
      console.error("⚠️ Socket connection error:", error?.message || error);
      // Don't throw — just log. App should not crash on socket failure.
    });

    this.socket.on("reconnect", (attemptNumber) => {
      console.log(`🔄 Socket reconnected after ${attemptNumber} attempts`);
      this.joinUserRoom();
    });

    this.socket.on("reconnect_error", (error) => {
      console.error("⚠️ Reconnect error:", error?.message || error);
    });

    this.socket.on("reconnect_failed", () => {
      console.error("❌ All reconnect attempts failed.");
    });

    // Booking events — all route through emitEvent safely
    this.socket.on("booking:accepted", (data) => {
      console.log("📱 Booking accepted:", data);
      this.emitEvent("booking:accepted", data);
    });

    this.socket.on("booking:status:updated", (data) => {
      console.log("📱 Booking status updated:", data);
      this.emitEvent("booking:status:updated", data);
    });

    this.socket.on("mechanic:location:update", (data) => {
      console.log("📍 Mechanic location update:", data);
      this.emitEvent("mechanic:location:update", data);
    });

    this.socket.on("mechanic:location:updated", (data) => {
      this.emitEvent("mechanic:location:update", data); // normalize both event names
    });

    this.socket.on("service:completed", (data) => {
      console.log("✅ Service completed:", data);
      this.emitEvent("service:completed", data);
    });

    this.socket.on("booking:new", (data) => {
      console.log("📱 New booking:", data);
      this.emitEvent("booking:new", data);
    });

    this.socket.on("request:mechanic:location", (data) => {
      console.log("📱 Request mechanic location:", data);
      this.emitEvent("request:mechanic:location", data);
    });

    // ✅ FIX — this handler was missing. The mechanic dashboard calls
    // emitOtpGenerated(), which the server broadcasts back out as an
    // "otp:generated" socket event to everyone in the booking room
    // (including the customer). Without registering this raw-socket
    // listener here, that event would arrive at the client but never
    // get forwarded into our internal emitEvent() dispatcher — so
    // customer.tsx's `socketService.on("otp:generated", handleOtpGenerated)`
    // would never fire, and the "Service Completion" screen would never
    // open. This mirrors the exact same on(...) -> emitEvent(...)
    // pattern used for every other event above.
    this.socket.on("otp:generated", (data) => {
      console.log("🔐 OTP generated:", data);
      this.emitEvent("otp:generated", data);
    });

    this.socket.on("otp:verified", (data) => {
      console.log("🔐 OTP verified:", data);
      this.emitEvent("otp:verified", data);
    });

    this.socket.on("booking:taken", (data) => {
      console.log("⚠️ Booking taken by another mechanic:", data);
      this.emitEvent("booking:taken", data);
    });

    this.socket.on("booking:accept:error", (data) => {
      console.log("❌ Booking accept error:", data);
      this.emitEvent("booking:accept:error", data);
    });

    this.socket.on("booking:accept:success", (data) => {
      console.log("✅ Booking accept success:", data);
      this.emitEvent("booking:accept:success", data);
    });
  }

  // Safe emit — never crashes if socket not ready
  private safeEmit(event: string, data?: any) {
    if (!this.socket) {
      console.warn(`⚠️ Socket not initialized. Cannot emit: ${event}`);
      return;
    }
    if (!this.socket.connected) {
      console.warn(`⚠️ Socket not connected. Queuing emit: ${event}`);
      // Attempt reconnect and retry once connected
      this.socket.once("connect", () => {
        this.socket?.emit(event, data);
      });
      this.socket.connect();
      return;
    }
    this.socket.emit(event, data);
  }

  private async joinUserRoom() {
    try {
      const userStr = await SecureStore.getItemAsync("user");
      if (userStr) {
        const user = JSON.parse(userStr);
        if (user?.id) {
          this.userId = user.id;
          this.safeEmit("user:join", user.id);
          console.log(`👤 User ${user.id} joined personal room`);
        }
      }
    } catch (error) {
      console.error("Failed to join user room:", error);
    }
  }

  public async setUser(userId: string) {
    this.userId = userId;
    this.safeEmit("user:join", userId);
    console.log(`👤 User ${userId} joined personal room`);
  }

  public clearUser() {
    this.userId = null;
  }

  public joinBookingRoom(bookingId: string | null | undefined) {
    if (!bookingId) return; // guard — prevents Hermes crash on undefined
    this.safeEmit("join:booking", bookingId);
    console.log(`Joined booking room: ${bookingId}`);
  }

  public leaveBookingRoom(bookingId: string | null | undefined) {
    if (!bookingId) return;
    this.safeEmit("leave:booking", bookingId);
    console.log(`Left booking room: ${bookingId}`);
  }

  public joinMechanicRoom(mechanicId: string | null | undefined) {
    if (!mechanicId) return;
    this.safeEmit("join:mechanic", mechanicId);
    console.log(`Joined mechanic room: ${mechanicId}`);
  }

  public sendMechanicLocation(
    bookingId: string,
    location: { lat: number; lng: number },
    eta: number,
    mechanicId?: string,
  ) {
    if (!bookingId || !location) return;
    if (typeof location.lat !== "number" || typeof location.lng !== "number") {
      console.warn("⚠️ Invalid location data, skipping emit");
      return;
    }
    this.safeEmit("mechanic:location:update", {
      bookingId,
      location: { lat: location.lat, lng: location.lng },
      eta,
      mechanicId: mechanicId || this.userId,
      timestamp: new Date().toISOString(),
    });
  }

  public onBookingTaken(
    callback: (data: {
      bookingId: string;
      mechanicId: string;
      message: string;
    }) => void,
  ) {
    this.on("booking:taken", callback);
  }

  // Listen for booking accept error
  public onBookingAcceptError(
    callback: (data: {
      bookingId: string;
      error: string;
      status?: string;
      alreadyAssigned?: boolean;
    }) => void,
  ) {
    this.on("booking:accept:error", callback);
  }

  // Listen for booking accept success
  public onBookingAcceptSuccess(
    callback: (data: { bookingId: string; message: string }) => void,
  ) {
    this.on("booking:accept:success", callback);
  }

  public requestMechanicLocation(bookingId: string | null | undefined) {
    if (!bookingId) return;
    this.safeEmit("customer:request:mechanic:location", { bookingId });
    console.log(`Requested mechanic location for booking: ${bookingId}`);
  }

  public acceptBooking(bookingId: string, mechanic: any, eta: number = 15) {
    if (!bookingId) return;
    this.safeEmit("booking:accept", { bookingId, mechanic, eta });
  }

  public updateBookingStatus(
    bookingId: string,
    status: string,
    mechanicLocation?: any,
  ) {
    if (!bookingId) return;
    this.safeEmit("booking:status:update", {
      bookingId,
      status,
      timestamp: new Date().toISOString(),
      mechanicLocation,
    });
  }

  public completeBooking(
    bookingId: string,
    customerId?: string,
    mechanicId?: string,
    mechanicName?: string,
    customerName?: string,
  ) {
    if (!bookingId) return;
    this.safeEmit("booking:complete", {
      bookingId,
      completedAt: new Date().toISOString(),
      customerId,
      mechanicId,
      mechanicName,
      customerName,
    });
  }

  public emitNewBooking(bookingData: any) {
    if (!bookingData) return;
    this.safeEmit("booking:new", bookingData);
  }

  // ✅ FIX — this is the method the mechanic dashboard was calling
  // (`socketService.emitOtpGenerated(bookingId, user?.id)`) that didn't
  // exist yet, causing the "Property 'emitOtpGenerated' does not exist
  // on type 'SocketService'" build error. Mirrors emitOtpVerified below.
  public emitOtpGenerated(
    bookingId: string | null | undefined,
    mechanicId?: string,
  ) {
    if (!bookingId) return;
    this.safeEmit("otp:generated", { bookingId, mechanicId });
    console.log(`📤 Emitted otp:generated for booking: ${bookingId}`);
  }

  public emitOtpVerified(bookingId: string | null | undefined) {
    if (!bookingId) return;
    this.safeEmit("otp:verified", { bookingId });
    console.log(`📤 Emitted otp:verified for booking: ${bookingId}`);
  }

  // Event listener management
  public on(event: string, callback: Function) {
    if (!event || typeof callback !== "function") return;
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)?.add(callback);
  }

  public off(event: string, callback?: Function) {
    if (!event) return;
    if (callback) {
      this.eventListeners.get(event)?.delete(callback);
    } else {
      this.eventListeners.delete(event);
    }
  }

  private emitEvent(event: string, data: any) {
    try {
      const callbacks = this.eventListeners.get(event);
      if (callbacks && callbacks.size > 0) {
        callbacks.forEach((callback) => {
          try {
            callback(data);
          } catch (err) {
            console.error(`❌ Error in listener for "${event}":`, err);
          }
        });
      }
    } catch (error) {
      console.error(`❌ emitEvent failed for "${event}":`, error);
    }
  }

  public isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  public disconnect() {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
      this.isInitialized = false;
    }
  }

  public reconnect() {
    if (!SOCKET_URL) return;
    if (!this.socket || !this.socket.connected) {
      if (!this.isInitialized) {
        this.initSocket();
      } else {
        this.socket?.connect();
      }
    }
  }

  public getSocket(): Socket | null {
    return this.socket;
  }
}

export const socketService = new SocketService();
export const socket = socketService;

export function useSocket() {
  return socketService;
}