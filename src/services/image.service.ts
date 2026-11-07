import { ImageEntityEnum } from "~/common/enum";
import { IMAGE_ERROR } from "~/common/error-code/menu";
import { rollback, withTransaction } from "~/config/db";
import { IImage } from "~/interfaces";
import { imageRepository } from "~/repositories";
import { destroyImage, uploadImage } from "~/utils/cloudinary";

export const getImages = async (entityType: ImageEntityEnum, entityId: number): Promise<IImage[] | number> => {
    try {
        return await imageRepository.getImages(entityType, entityId);
    } catch (error) {
        return IMAGE_ERROR.FAILED;
    }
};

/**
 * Tải nhiều ảnh lên Cloudinary rồi lưu DB. Đối tượng chưa có ảnh đại diện thì ảnh đầu tiên thành ảnh đại diện.
 * Nếu lưu DB thất bại, các file vừa tải lên sẽ bị xóa khỏi Cloudinary.
 */
export const uploadImages = async (
    entityType: ImageEntityEnum,
    entityId: number,
    files: Express.Multer.File[],
): Promise<IImage[] | number> => {
    if (files.length === 0) return IMAGE_ERROR.NO_FILES;

    const results = await Promise.allSettled(files.map((f) => uploadImage(f.buffer, entityType)));
    const uploaded = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    if (uploaded.length !== files.length) {
        // Một file lỗi -> hủy cả lô để không còn ảnh "mồ côi" trên Cloudinary
        await Promise.all(uploaded.map((u) => destroyImage(u.public_id)));
        return IMAGE_ERROR.UPLOAD_FAILED;
    }

    try {
        return await withTransaction(async () => {
            const existing = await imageRepository.getImages(entityType, entityId);
            const hasPrimary = existing.some((i) => i.is_primary);
            return await imageRepository.createImages(entityType, entityId, uploaded, !hasPrimary);
        });
    } catch (error) {
        await Promise.all(uploaded.map((u) => destroyImage(u.public_id)));
        return IMAGE_ERROR.FAILED;
    }
};

export const setPrimary = async (image: IImage): Promise<IImage[] | number> => {
    try {
        await withTransaction(() => imageRepository.setPrimaryImage(image));
        return await imageRepository.getImages(image.entity_type, image.entity_id);
    } catch (error) {
        return IMAGE_ERROR.FAILED;
    }
};

/** Xóa ảnh; nếu là ảnh đại diện thì ảnh kế tiếp trở thành ảnh đại diện. */
export const deleteImage = async (image: IImage): Promise<IImage[] | number> => {
    try {
        const remaining = await withTransaction(async () => {
            const current = await imageRepository.getImageById(image.id);
            if (!current) return rollback(IMAGE_ERROR.NOT_FOUND);
            await imageRepository.deleteImage(image.id);
            const rest = await imageRepository.getImages(image.entity_type, image.entity_id);
            if (current.is_primary && rest.length > 0) {
                await imageRepository.setPrimaryImage(rest[0]);
                return imageRepository.getImages(image.entity_type, image.entity_id);
            }
            return rest;
        });
        if (typeof remaining !== "number") await destroyImage(image.public_id);
        return remaining;
    } catch (error) {
        return IMAGE_ERROR.FAILED;
    }
};
