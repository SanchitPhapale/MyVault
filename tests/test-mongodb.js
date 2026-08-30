require("dotenv").config();

const { MongoClient } = require("mongodb");

async function testMongoDB() {
  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    await client.connect();

    console.log("✅ MongoDB connected successfully!");

    const db = client.db("myvault");

    console.log("✅ Database selected:", db.databaseName);
  } catch (error) {
    console.error("❌ MongoDB connection failed:");
    console.error(error.message);
  } finally {
    await client.close();
  }
}

testMongoDB();