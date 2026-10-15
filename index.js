const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
res.json({
name: "Hahari Anime Edit API",
status: "online",
version: "1.0.0"
});
});

app.get("/api/search", (req, res) => {
const query = String(req.query.q || "").trim();

if (!query) {
return res.status(400).json({
success: false,
error: "Missing search query. Use /api/search?q=gojo"
});
}

res.json({
success: true,
query,
message: "Search endpoint is ready for implementation."
});
});

app.listen(PORT, "0.0.0.0", () => {
console.log("Hahari Anime Edit API running on port ${PORT}");
});
