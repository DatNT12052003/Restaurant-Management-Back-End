import { v2 as cloudinary } from "cloudinary";

export const deleteFromCloudinary = async (publicId: string): Promise<any> => {
    try {
        return await cloudinary.uploader.destroy(publicId);
    } catch (error) {
        console.error("Cloudinary Delete Error:", error);
        throw new Error("Không thể xóa file trên Cloudinary");
    }
};
