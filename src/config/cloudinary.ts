import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import dotenv from "dotenv";

dotenv.config();

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
        let resourceType: "image" | "video" | "raw" = "image";

        if (file.mimetype.startsWith("video")) {
            resourceType = "video";
        } else if (file.mimetype.startsWith("audio")) {
            resourceType = "video";
        }

        return {
            folder: "restaurant-management",
            resource_type: resourceType,
            allowed_formats: ["jpg", "png", "jpeg", "mp3", "wav", "mp4", "mov", "mkv"],
            public_id: file.fieldname + "-" + Date.now(),
        };
    },
});

export { cloudinary, storage };
