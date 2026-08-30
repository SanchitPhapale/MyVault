require("dotenv").config();

const {
  uploadFile,
  getFile,
  deleteFile,
  fileExists
} = require("./idrive");

const fs = require("fs");

async function test() {
  const localFile = "helper-test.txt";
  const remoteKey = ".system/helper-test.txt";

  try {
    fs.writeFileSync(
      localFile,
      "MyVault IDrive helper test"
    );

    console.log("Uploading...");

    await uploadFile(
      localFile,
      remoteKey,
      "text/plain"
    );

    console.log("✅ Upload successful");

    const exists = await fileExists(remoteKey);

    console.log(
      "File exists on IDrive:",
      exists
    );

    if (!exists) {
      throw new Error(
        "File was uploaded but could not be found."
      );
    }

    console.log("Deleting...");

    await deleteFile(remoteKey);

    console.log("✅ Delete successful");

    fs.unlinkSync(localFile);

    console.log("🎉 IDrive helper is working!");
  } catch (error) {
    console.error("❌ Test failed:");
    console.error(error.message);

    if (fs.existsSync(localFile)) {
      fs.unlinkSync(localFile);
    }
  }
}

test();
