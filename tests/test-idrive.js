require("dotenv").config();

const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand
} = require("@aws-sdk/client-s3");

const s3 = new S3Client({
  region: process.env.IDRIVE_REGION,
  endpoint: process.env.IDRIVE_ENDPOINT,
  credentials: {
    accessKeyId: process.env.IDRIVE_ACCESS_KEY_ID,
    secretAccessKey: process.env.IDRIVE_SECRET_ACCESS_KEY
  }
});

async function testIDrive() {
  const testFile = "myvault-test.txt";

  try {
    console.log("Connecting to IDrive e2...");

    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.IDRIVE_BUCKET_NAME,
        Key: testFile,
        Body: Buffer.from("MyVault IDrive test file")
      })
    );

    console.log("✅ Upload successful!");

    const result = await s3.send(
      new ListObjectsV2Command({
        Bucket: process.env.IDRIVE_BUCKET_NAME
      })
    );

    console.log("✅ IDrive connection successful!");

    console.log(
      "Files:",
      result.Contents?.map(file => file.Key) || []
    );

    await s3.send(
      new DeleteObjectCommand({
        Bucket: process.env.IDRIVE_BUCKET_NAME,
        Key: testFile
      })
    );

    console.log("✅ Test file deleted!");
    console.log("🎉 IDrive e2 is working correctly!");

  } catch (error) {
    console.error("❌ IDrive connection failed:");
    console.error(error.message);
  }
}

testIDrive();