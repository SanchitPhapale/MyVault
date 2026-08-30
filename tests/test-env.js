require("dotenv").config();

console.log("PORT:", process.env.PORT);
console.log("VAULT PASSWORD SET:", !!process.env.VAULT_PASSWORD);
console.log("MONGODB URI SET:", !!process.env.MONGODB_URI);
console.log("SESSION SECRET SET:", !!process.env.SESSION_SECRET);
console.log("IDRIVE ENDPOINT SET:", !!process.env.IDRIVE_ENDPOINT);
console.log("IDRIVE REGION SET:", !!process.env.IDRIVE_REGION);
console.log("IDRIVE KEY SET:", !!process.env.IDRIVE_ACCESS_KEY_ID);
console.log(
  "IDRIVE SECRET SET:",
  !!process.env.IDRIVE_SECRET_ACCESS_KEY
);
console.log("IDRIVE BUCKET:", process.env.IDRIVE_BUCKET_NAME);