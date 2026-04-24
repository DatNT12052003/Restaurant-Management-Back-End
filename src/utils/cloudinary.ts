import { cloudinary } from "~/config/cloudinary";
import streamifier from "streamifier";

export const uploadToCloudinary = (fileBuffer: Buffer): Promise<any> => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({ folder: "avatars" }, (error, result) => {
            if (error) return reject(error);
            resolve(result);
        });

        streamifier.createReadStream(fileBuffer).pipe(stream);
    });
};
