const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET =
  process.env.JWT_SECRET || "edutech_super_secret_jwt_key_2026";

app.use(
  cors({
    origin: ["http://localhost:3000"],
    credentials: true,
  }),
);
app.use(express.json());

// MongoDB Connection
if (
  process.env.MONGODB_URI &&
  !process.env.MONGODB_URI.includes("<username>")
) {
  mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => console.log("MongoDB Connected Successfully"))
    .catch((err) => console.error("MongoDB Connection Error:", err.message));
} else {
  console.log(
    "Server started! (Replace MONGODB_URI in .env with your Atlas URI)",
  );
}

// JWT Middleware
const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized access" });
  }
  const token = authHeader.split(" ")[1];
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: "Forbidden access" });
    req.user = decoded;
    next();
  });
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

const JoinedEvent = mongoose.model("JoinedEvent", joinedSchema);

// Routes
app.get("/", (req, res) => {
  res.send("EduTech Impact Server is Running!");
});

app.post("/api/jwt", (req, res) => {
  const token = jwt.sign(req.body, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token });
});

// Get Events (Uses .limit(6) for homepage recent upcoming events)
app.get("/api/events", async (req, res) => {
  try {
    const { limit } = req.query;
    const today = new Date().toISOString().split("T")[0];
    let query = Event.find({ eventDate: { $gte: today } }).sort({
      eventDate: 1,
    });
    if (limit) query = query.limit(parseInt(limit, 10));
    const events = await query.exec();
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

app.get("/api/events/:id", async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    res.json(event);
  } catch (error) {
    res.status(404).json({ error: "Event not found" });
  }
});

app.post("/api/events", verifyJWT, async (req, res) => {
  try {
    const saved = await new Event(req.body).save();
    res.status(201).json(saved);
  } catch (error) {
    res.status(400).json({ error: "Failed to create event" });
  }
});

app.put("/api/events/:id", verifyJWT, async (req, res) => {
  try {
    const updated = await Event.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: "Failed to update event" });
  }
});

app.delete("/api/events/:id", verifyJWT, async (req, res) => {
  try {
    await Event.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted successfully" });
  } catch (error) {
    res.status(400).json({ error: "Failed to delete event" });
  }
});

app.post("/api/joined-events", verifyJWT, async (req, res) => {
  try {
    const saved = await new JoinedEvent(req.body).save();
    res.status(201).json(saved);
  } catch (error) {
    res.status(400).json({ error: "Failed to join event" });
  }
});

app.get("/api/joined-events", verifyJWT, async (req, res) => {
  try {
    const joined = await JoinedEvent.find({ userEmail: req.query.email }).sort({
      eventDate: 1,
    });
    res.json(joined);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch joined events" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
