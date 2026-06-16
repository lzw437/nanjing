// Local development launcher
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { app, ensureDb } = require("./api/server");
// Set env to match Vercel
process.env.VERCEL = "1";

async function start() {
  try { await ensureDb(); } catch (err) { console.error("DB:", err.message); }
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log("Server running at http://localhost:" + port);
    console.log("MongoDB collection: landscape-map.sign in");
  });
}
start().catch(err => { console.error("Failed:", err); process.exit(1); });
