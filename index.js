const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { app, ensureDb } = require("./server");

module.exports = async (req, res) => {
  try {
    await ensureDb();
  } catch (err) {
    console.error("DB connection failed:", err.message);
  }
  return app(req, res);
};
