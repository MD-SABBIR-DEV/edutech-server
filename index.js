import "dotenv/config";
import cors from "cors";
import express from "express";
import mongoose from "mongoose";
import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();
const PORT = process.env.PORT || 5000;
const configuredClientUrl =
  process.env.CLIENT_URL ||
  (process.env.NODE_ENV === "production" ? null : "http://localhost:3000");

if (!configuredClientUrl) {
  throw new Error("CLIENT_URL must be set to the frontend origin.");
}

const CLIENT_URL = new URL(configuredClientUrl).origin;
const JWKS = createRemoteJWKSet(new URL("/api/auth/jwks", CLIENT_URL));
const EVENT_FIELDS = [
  "title",
  "description",
  "eventType",
  "thumbnail",
  "location",
  "eventDate",
];
const EVENT_TYPES = new Set([
  "Education",
  "Donation",
  "Plantation",
  "Cleanup",
  "Workshop",
]);

function getDhakaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
  }).format(new Date());
}

function isFutureEventDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value <= getDhakaDate()
  ) {
    return false;
  }

  const parsedDate = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsedDate.getTime()) &&
    parsedDate.toISOString().slice(0, 10) === value
  );
}

function getEventInput(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !EVENT_FIELDS.every(
      (field) => typeof body[field] === "string" && body[field].trim(),
    )
  ) {
    return null;
  }

  if (!isFutureEventDate(body.eventDate)) return null;
  if (!EVENT_TYPES.has(body.eventType.trim())) return null;

  let thumbnailUrl;
  try {
    thumbnailUrl = new URL(body.thumbnail.trim());
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(thumbnailUrl.protocol)) return null;

  return Object.fromEntries(
    EVENT_FIELDS.map((field) => [field, body[field].trim()]),
  );
}

app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
  }),
);
app.use(express.json());

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const [scheme, token] = authHeader?.split(/\s+/, 2) || [];

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Unauthorized access" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: CLIENT_URL,
      audience: CLIENT_URL,
    });
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
      return res.status(401).json({ error: "Invalid authentication token" });
    }

    req.user = {
      id: payload.sub,
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : "",
    };
    return next();
  } catch (error) {
    const code = error?.code;
    if (
      typeof code === "string" &&
      (code.startsWith("ERR_JWT_") ||
        code.startsWith("ERR_JWS_") ||
        code === "ERR_JWKS_NO_MATCHING_KEY" ||
        code === "ERR_JOSE_ALG_NOT_ALLOWED")
    ) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    console.error("JWT verification failed:", error);
    return res.status(503).json({ error: "Unable to verify authentication" });
  }
};

// Schemas
const eventSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  eventType: { type: String, required: true },
  thumbnail: { type: String, required: true },
  location: { type: String, required: true },
  eventDate: { type: String, required: true },
  creatorEmail: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const Event = mongoose.model("Event", eventSchema);

const joinedSchema = new mongoose.Schema({
  eventId: { type: String, required: true },
  title: String,
  description: String,
  eventType: String,
  thumbnail: String,
  location: String,
  eventDate: String,
  creatorEmail: String,
  userEmail: { type: String, required: true },
  userName: String,
  joinedAt: { type: Date, default: Date.now },
});

joinedSchema.index({ eventId: 1, userEmail: 1 }, { unique: true });

const JoinedEvent = mongoose.model("JoinedEvent", joinedSchema);

// Routes
app.get("/", (req, res) => {
  res.send("EduTech Impact Server is Running!");
});

// Get Events (Uses .limit(6) for homepage recent upcoming events)
app.get("/api/events", async (req, res) => {
  try {
    const { limit } = req.query;
    let query = Event.find({ eventDate: { $gt: getDhakaDate() } }).sort({
      eventDate: 1,
    });
    if (limit !== undefined) {
      const parsedLimit = Number(limit);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
        return res.status(400).json({ error: "Limit must be a positive integer" });
      }
      query = query.limit(Math.min(parsedLimit, 100));
    }
    const events = await query.exec();
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

app.get("/api/events/mine", verifyToken, async (req, res) => {
  try {
    const events = await Event.find({ creatorEmail: req.user.email }).sort({
      eventDate: 1,
    });
    res.json(events);
  } catch (error) {
    console.error("Failed to fetch organizer events:", error);
    res.status(500).json({ error: "Failed to fetch organizer events" });
  }
});

app.get("/api/events/:id", async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found" });
    res.json(event);
  } catch (error) {
    res.status(404).json({ error: "Event not found" });
  }
});

app.post("/api/events", verifyToken, async (req, res) => {
  try {
    const eventInput = getEventInput(req.body);
    if (!eventInput) {
      return res.status(400).json({
        error:
          "Provide valid event details, a supported event type, an HTTP(S) thumbnail URL, and a future date.",
      });
    }

    const saved = await new Event({
      ...eventInput,
      creatorEmail: req.user.email,
    }).save();
    res.status(201).json(saved);
  } catch (error) {
    res.status(400).json({ error: "Failed to create event" });
  }
});

app.put("/api/events/:id", verifyToken, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found" });
    if (event.creatorEmail !== req.user.email) {
      return res.status(403).json({ error: "You cannot update this event" });
    }

    const eventInput = getEventInput({
      ...event.toObject(),
      ...req.body,
    });
    if (!eventInput) {
      return res.status(400).json({
        error:
          "Provide valid event details, a supported event type, an HTTP(S) thumbnail URL, and a future date.",
      });
    }
    Object.assign(event, eventInput);

    await event.save();
    res.json(event);
  } catch (error) {
    res.status(400).json({ error: "Failed to update event" });
  }
});

app.delete("/api/events/:id", verifyToken, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found" });
    if (event.creatorEmail !== req.user.email) {
      return res.status(403).json({ error: "You cannot delete this event" });
    }

    await event.deleteOne();
    await JoinedEvent.deleteMany({ eventId: event._id });
    res.json({ message: "Deleted successfully" });
  } catch (error) {
    res.status(400).json({ error: "Failed to delete event" });
  }
});

app.post("/api/joined-events", verifyToken, async (req, res) => {
  try {
    const event = await Event.findById(req.body.eventId);
    if (!event) return res.status(404).json({ error: "Event not found" });

    const saved = await new JoinedEvent({
      eventId: event._id,
      title: event.title,
      description: event.description,
      eventType: event.eventType,
      thumbnail: event.thumbnail,
      location: event.location,
      eventDate: event.eventDate,
      creatorEmail: event.creatorEmail,
      userEmail: req.user.email,
      userName: req.user.name,
    }).save();
    res.status(201).json(saved);
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: "You already joined this event" });
    }
    res.status(400).json({ error: "Failed to join event" });
  }
});

app.get("/api/joined-events", verifyToken, async (req, res) => {
  try {
    const joined = await JoinedEvent.find({ userEmail: req.user.email }).sort({
      eventDate: 1,
    });
    res.json(joined);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch joined events" });
  }
});

async function startServer() {
  if (
    !process.env.MONGODB_URI ||
    process.env.MONGODB_URI.includes("<username>")
  ) {
    throw new Error("MONGODB_URI must be configured before starting the server.");
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("MongoDB Connected Successfully");

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start the API server:", error.message);
  process.exitCode = 1;
});
