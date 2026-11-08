import { ImageEntityEnum } from "~/common/enum";
import { db } from "~/config/db";
import { IImage } from "~/interfaces";

export const getImages = async (entityType: ImageEntityEnum, entityId: number): Promise<IImage[]> => {
    const result = await db().query(
        `SELECT * FROM images
        WHERE entity_type = $1 AND entity_id = $2 AND deleted_at IS NULL
        ORDER BY sort_order, id`,
        [entityType, entityId],
    );
    return result.rows;
};

export const getImageById = async (id: number): Promise<IImage | undefined> => {
    const result = await db().query("SELECT * FROM images WHERE id = $1 AND deleted_at IS NULL", [id]);
    return result.rows[0];
};

export const createImages = async (
    entityType: ImageEntityEnum,
    entityId: number,
    files: { url: string; public_id: string }[],
    makeFirstPrimary: boolean,
): Promise<IImage[]> => {
    const { rows } = await db().query(
        "SELECT COALESCE(MAX(sort_order), -1)::int AS max FROM images WHERE entity_type = $1 AND entity_id = $2 AND deleted_at IS NULL",
        [entityType, entityId],
    );
    const start = rows[0].max + 1;
    const result = await db().query(
        `INSERT INTO images (url, public_id, entity_type, entity_id, sort_order, is_primary)
        SELECT f.url, f.public_id, $1, $2, $3 + f.idx - 1, ($4 AND f.idx = 1)
        FROM unnest($5::text[], $6::text[]) WITH ORDINALITY AS f(url, public_id, idx)
        RETURNING *`,
        [entityType, entityId, start, makeFirstPrimary, files.map((f) => f.url), files.map((f) => f.public_id)],
    );
    return result.rows;
};

/** Đặt ảnh làm ảnh đại diện (bỏ đánh dấu ảnh cũ). Gọi trong transaction. */
export const setPrimaryImage = async (image: IImage): Promise<void> => {
    await db().query(
        "UPDATE images SET is_primary = false, updated_at = NOW() WHERE entity_type = $1 AND entity_id = $2 AND is_primary AND deleted_at IS NULL",
        [image.entity_type, image.entity_id],
    );
    await db().query("UPDATE images SET is_primary = true, updated_at = NOW() WHERE id = $1", [image.id]);
};

/** Đặt lại thứ tự theo vị trí trong `ids` (0, 1, 2...). Gọi trong transaction. */
export const setSortOrder = async (ids: number[]): Promise<void> => {
    await db().query(
        `UPDATE images i SET sort_order = x.idx - 1, updated_at = NOW()
        FROM unnest($1::int[]) WITH ORDINALITY AS x(id, idx)
        WHERE i.id = x.id`,
        [ids],
    );
};

export const deleteImage = async (id: number): Promise<void> => {
    await db().query("UPDATE images SET deleted_at = NOW(), is_primary = false WHERE id = $1", [id]);
};

/** Xóa mềm mọi ảnh của đối tượng; trả public_id để xóa file trên Cloudinary */
export const deleteImagesOf = async (entityType: ImageEntityEnum, entityId: number): Promise<string[]> => {
    const result = await db().query(
        `UPDATE images SET deleted_at = NOW(), is_primary = false
        WHERE entity_type = $1 AND entity_id = $2 AND deleted_at IS NULL
        RETURNING public_id`,
        [entityType, entityId],
    );
    return result.rows.map((r) => r.public_id).filter(Boolean);
};
