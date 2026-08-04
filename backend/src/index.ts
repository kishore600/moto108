// server/index.ts — PRODUCTION FIXED FULL VERSION
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import http from "http";
import { Server } from "socket.io";
import { env } from "./config/env";
import { servicesRouter } from "./routes/services.routes";
import { bookingsRouter } from "./routes/bookings.routes";
import { mechanicsRouter } from "./routes/mechanics.routes";
import { initSocket } from "./socket";
import cookieParser from "cookie-parser";
import { authMiddleware } from "./middleware/auth";
import authRouter from "./routes/auth.routes";
import savedLocationRouter from "./routes/savedLocations.routes";
import profileRoutes from "./routes/profile.routes";

const app = express();

// ─────────────────────────────────────────────────────────────
// MIDDLEWARE ORDER MATTERS — cors + json MUST come before routes
// ─────────────────────────────────────────────────────────────
app.use(cookieParser());
app.use(cors({ origin: "*", credentials: true }));
app.use(helmet({
  // ✅ Allow cross-origin requests from the mobile app
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────────────────────────
// REQUEST TIMEOUT MIDDLEWARE
// Must be before routes so every request gets a timeout
// ─────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setTimeout(20000, () => {
    console.error(`⏱️ Request timeout: ${req.method} ${req.url}`);
    if (!res.headersSent) {
      res.status(503).json({
        error: "Request timeout. Server may be starting up, please retry.",
      });
    }
  });
  next();
});

// ─────────────────────────────────────────────────────────────
// HTTP SERVER + SOCKET.IO
// ─────────────────────────────────────────────────────────────
const server = http.createServer(app);

// ✅ Set server-level timeouts — prevents Render from silently dropping connections
server.timeout = 25000;          // 25s — slightly more than client's 20s
server.keepAliveTimeout = 30000; // 30s keep-alive
server.headersTimeout = 31000;   // must be > keepAliveTimeout

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  // ✅ polling FIRST — more reliable on Render cold starts
  // websocket upgrade happens automatically after polling connects
  transports: ["polling", "websocket"],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  // ✅ Increase connection timeout for Render cold starts
  connectTimeout: 30000,
});

initSocket(io);

// ─────────────────────────────────────────────────────────────
// HEALTH + KEEP-ALIVE ENDPOINTS
// Set up cron-job.org to ping /ping every 10 minutes
// URL: https://your-server.onrender.com/ping
// ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "moto108-api",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get("/ping", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// ─────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────
app.use("/api/services", servicesRouter);
app.use("/api/auth", authRouter);
app.use("/api/bookings", authMiddleware, bookingsRouter);
app.use("/api/mechanics", authMiddleware, mechanicsRouter);
app.use("/api/location", authMiddleware, savedLocationRouter);
app.use("/api/profile", authMiddleware, profileRoutes);

// ─────────────────────────────────────────────────────────────
// DIRECTIONS PROXY
// Proxies Google Directions API from server-side so the API key
// is never exposed in the mobile app bundle
// ─────────────────────────────────────────────────────────────
app.post("/api/directions", async (req, res) => {
  try {
    const { origin, destination } = req.body;

    // ✅ Validate inputs before calling Google
    if (
      !origin?.latitude ||
      !origin?.longitude ||
      !destination?.latitude ||
      !destination?.longitude
    ) {
      return res.status(400).json({
        error: "origin and destination with latitude/longitude are required",
      });
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      console.error("❌ GOOGLE_MAPS_API_KEY is not set on the server");
      return res.status(500).json({ error: "Maps API key not configured" });
    }

    const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
    url.searchParams.append("origin", `${origin.latitude},${origin.longitude}`);
    url.searchParams.append("destination", `${destination.latitude},${destination.longitude}`);
    url.searchParams.append("key", apiKey);
    url.searchParams.append("mode", "driving");

    // ✅ Add timeout to the Google API call
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeout);

    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    console.error("Directions API error:", error?.message || error);

    if (error?.name === "AbortError") {
      return res.status(504).json({ error: "Directions request timed out" });
    }

    res.status(500).json({ error: "Failed to fetch directions" });
  }
});

// ─────────────────────────────────────────────────────────────
// 404 HANDLER — catches unmatched routes
// Without this, unmatched routes hang forever
// ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ─────────────────────────────────────────────────────────────
// GLOBAL ERROR HANDLER
// Express error middleware must have 4 params
// ─────────────────────────────────────────────────────────────
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("❌ Unhandled error:", err?.message || err);
  if (!res.headersSent) {
    res.status(500).json({
      error: err?.message || "Internal server error",
    });
  }
});

// ─────────────────────────────────────────────────────────────
// PROCESS ERROR HANDLERS
// Prevents server crash on unhandled promise rejections
// ─────────────────────────────────────────────────────────────
process.on("unhandledRejection", (reason: any, promise) => {
  console.error("⚠️ Unhandled Rejection at:", promise);
  console.error("Reason:", reason?.message || reason);
  // Don't exit — log and continue
});

process.on("uncaughtException", (error: Error) => {
  console.error("⚠️ Uncaught Exception:", error?.message || error);
  // Don't exit — log and continue
});

// ─────────────────────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────────────────────
server.listen(env.port, () => {
  console.log(`🚀 API running on http://localhost:${env.port}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`📡 Socket.IO ready`);
});