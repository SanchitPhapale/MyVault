const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand
} = require("@aws-sdk/client-s3");

const fs = require("fs");

const s3 = new S3Client({
  region: process.env.IDRIVE_REGION,
  endpoint: process.env.IDRIVE_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.IDRIVE_ACCESS_KEY_ID,
    secretAccessKey: process.env.IDRIVE_SECRET_ACCESS_KEY
  }
});

const BUCKET = process.env.IDRIVE_BUCKET_NAME;

async function uploadFile(localPath, key, contentType) {
  const fileStream = fs.createReadStream(localPath);

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: fileStream,
      ContentType: contentType || "application/octet-stream"
    })
  );

  return key;
}

async function getFile(key) {
  return await s3.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key
    })
  );
}

async function deleteFile(key) {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key
    })
  );
}

async function fileExists(key) {
  try {
    await s3.send(
      new HeadObjectCommand({
        Bucket: BUCKET,
        Key: key
      })
    );

    return true;
  } catch (error) {
    if (
      error.name === "NotFound" ||
      error.$metadata?.httpStatusCode === 404
    ) {
      return false;
    }

    throw error;
  }
}

async function saveJSON(key, data) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify(data, null, 2),
      ContentType: "application/json"
    })
  );
}

async function getJSON(key, defaultValue) {
  try {
    const result = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: key
      })
    );

    const text = await result.Body.transformToString();

    return JSON.parse(text);

  } catch (error) {
    if (
      error.name === "NoSuchKey" ||
      error.name === "NotFound" ||
      error.$metadata?.httpStatusCode === 404
    ) {
      return defaultValue;
    }

    throw error;
  }
}

module.exports = {
  s3,
  BUCKET,
  uploadFile,
  getFile,
  deleteFile,
  fileExists,
  saveJSON,
  getJSON
};