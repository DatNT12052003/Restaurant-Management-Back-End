import { cloudinary } from "~/config/cloudinary";
import streamifier from "streamifier";

export const uploadToCloudinary = (fileBuffer: Buffer, folder = "avatars"): Promise<any> => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({ folder }, (error, result) => {
            if (error) return reject(error);
            resolve(result);
        });

        streamifier.createReadStream(fileBuffer).pipe(stream);
    });
};

/** Tải ảnh lên thư mục `restaurant-management/<entity>`; trả url và public_id (để xóa sau này). */
export const uploadImage = async (fileBuffer: Buffer, entity: string): Promise<{ url: string; public_id: string }> => {
    const result = await uploadToCloudinary(fileBuffer, `restaurant-management/${entity}`);
    return { url: result.secure_url, public_id: result.public_id };
};

/** Xóa file trên Cloudinary; lỗi chỉ được ghi log (bản ghi DB vẫn được xóa). */
export const destroyImage = async (publicId: string | null | undefined): Promise<void> => {
    if (!publicId) return;
    try {
        await cloudinary.uploader.destroy(publicId);
    } catch (error) {
        console.error("Cloudinary destroy failed:", publicId, error);
    }
};
