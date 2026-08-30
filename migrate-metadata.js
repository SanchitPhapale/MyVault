require("dotenv").config();

const fs = require("fs");
const path = require("path");

const {
  saveJSON,
  getJSON
} = require("./idrive");

const DATA_DIR = path.join(__dirname, "vault-data");

const META_FILE = path.join(
  DATA_DIR,
  "meta.json"
);

const ACTIVITY_FILE = path.join(
  DATA_DIR,
  "activity.json"
);

const META_KEY = "metadata/meta.json";
const ACTIVITY_KEY = "metadata/activity.json";

async function migrate() {
  try {
    // ==========================================
    // CHECK LOCAL METADATA
    // ==========================================

    if (!fs.existsSync(META_FILE)) {
      throw new Error(
        "Local meta.json was not found."
      );
    }

    if (!fs.existsSync(ACTIVITY_FILE)) {
      throw new Error(
        "Local activity.json was not found."
      );
    }

    // ==========================================
    // READ LOCAL METADATA
    // ==========================================

    const meta = JSON.parse(
      fs.readFileSync(META_FILE, "utf8")
    );

    const activity = JSON.parse(
      fs.readFileSync(ACTIVITY_FILE, "utf8")
    );

    console.log(
      `Local files: ${meta.files.length}`
    );

    console.log(
      `Local folders: ${meta.folders.length}`
    );

    console.log(
      `Local activities: ${activity.length}`
    );

    // ==========================================
    // CHECK IDRIVE FIRST
    // ==========================================

    const existingMeta = await getJSON(
      META_KEY,
      null
    );

    const existingActivity = await getJSON(
      ACTIVITY_KEY,
      null
    );

    if (existingMeta !== null) {
      console.log(
        "⚠️ Metadata already exists on IDrive."
      );

      console.log(
        "Migration stopped to protect existing cloud data."
      );

      return;
    }

    if (existingActivity !== null) {
      console.log(
        "⚠️ Activity data already exists on IDrive."
      );

      console.log(
        "Migration stopped to protect existing cloud data."
      );

      return;
    }

    // ==========================================
    // UPLOAD METADATA
    // ==========================================

    console.log(
      "Uploading metadata to IDrive..."
    );

    await saveJSON(
      META_KEY,
      meta
    );

    // ==========================================
    // UPLOAD ACTIVITY
    // ==========================================

    console.log(
      "Uploading activity to IDrive..."
    );

    await saveJSON(
      ACTIVITY_KEY,
      activity
    );

    // ==========================================
    // VERIFY
    // ==========================================

    const verifyMeta = await getJSON(
      META_KEY,
      null
    );

    const verifyActivity = await getJSON(
      ACTIVITY_KEY,
      null
    );

    if (!verifyMeta) {
      throw new Error(
        "Metadata verification failed."
      );
    }

    if (!verifyActivity) {
      throw new Error(
        "Activity verification failed."
      );
    }

    console.log(
      `IDrive files: ${verifyMeta.files.length}`
    );

    console.log(
      `IDrive folders: ${verifyMeta.folders.length}`
    );

    console.log(
      `IDrive activities: ${verifyActivity.length}`
    );

    console.log(
      "🎉 Metadata migration successful!"
    );

  } catch (error) {
    console.error(
      "❌ Metadata migration failed:"
    );

    console.error(
      error.message
    );
  }
}

migrate();