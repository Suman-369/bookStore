import "dotenv/config";
import fs from "fs";
import ImageKit from "imagekit";

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL,
});

// Upload function - returns object with secure_url and public_id like Cloudinary
async function upload(filePath, options = {}) {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = options.fileName || `file-${Date.now()}`;

  const uploadOptions = {
    file: fileBuffer,
    fileName: fileName,
    folder: options.folder || "MA",
  };

  // Add resource type if specified (for videos)
  if (options.resource_type === "video") {
    uploadOptions.resourceType = "video";
    uploadOptions.tags = ["video"];
  }

  const result = await imagekit.upload(uploadOptions);

  return {
    secure_url: result.url,
    public_id: result.fileId,
    url: result.url,
  };
}

// Delete function
async function destroy(publicId, options = {}) {
  try {
    await imagekit.deleteFile(publicId);
    return { result: "ok" };
  } catch (error) {
    console.error("ImageKit delete error:", error);
    throw error;
  }
}

// Bulk delete function
async function deleteResources(publicIds, options = {}) {
  const results = await Promise.all(
    publicIds.map(async (publicId) => {
      try {
        await imagekit.deleteFile(publicId);
        return { public_id: publicId, result: "ok" };
      } catch (error) {
        console.error(`Error deleting ${publicId}:`, error);
        return { public_id: publicId, result: "error" };
      }
    }),
  );
  return results;
}

// Export in a format compatible with existing Cloudinary usage
// The routes use cloudinary.uploader.upload, cloudinary.uploader.destroy, cloudinary.api.delete_resources
export default {
  uploader: {
    upload: async (filePath, options = {}) => {
      // Read file if it's a path, otherwise use directly
      let fileData = filePath;
      if (typeof filePath === "string") {
        // It's a path, read the file
        fileData = fs.readFileSync(filePath);
      }

      const fileName = options.fileName || `file-${Date.now()}`;

      const uploadOptions = {
        file: fileData,
        fileName: fileName,
        folder: "MA",
      };

      // Add resource type if specified (for videos)
      if (options.resource_type === "video") {
        uploadOptions.resourceType = "video";
        uploadOptions.tags = ["video"];
      }

      const result = await imagekit.upload(uploadOptions);

      return {
        secure_url: result.url,
        public_id: result.fileId,
        url: result.url,
      };
    },
    destroy: async (publicId, options = {}) => {
      try {
        await imagekit.deleteFile(publicId);
        return { result: "ok" };
      } catch (error) {
        console.error("ImageKit delete error:", error);
        throw error;
      }
    },
  },
  api: {
    delete_resources: async (publicIds, options = {}) => {
      const results = await Promise.all(
        publicIds.map(async (publicId) => {
          try {
            await imagekit.deleteFile(publicId);
            return { public_id: publicId, result: "ok" };
          } catch (error) {
            console.error(`Error deleting ${publicId}:`, error);
            return { public_id: publicId, result: "error" };
          }
        }),
      );
      return results;
    },
  },
};
