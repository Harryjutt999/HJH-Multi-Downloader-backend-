import express from "express";
import cors from "cors";

import tiktok from "./api/tiktok.js";
import instagram from "./api/instagram.js";
import facebook from "./api/facebook.js";
import snapchat from "./api/snapchat.js";
import pinterest from "./api/pinterest.js";
import youtube from "./api/youtube.js";

const app = express();
app.use(cors());
app.use(express.json());

// Mount routers
app.use("/api/tiktok", tiktok);
app.use("/api/instagram", instagram);
app.use("/api/facebook", facebook);
app.use("/api/snapchat", snapchat);
app.use("/api/pinterest", pinterest);
app.use("/api/youtube", youtube);

// Root health
app.get("/", (req, res) => res.send("✅ HJH backend running"));

// Start
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server listening on port ${PORT}`));
