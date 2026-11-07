import { PG_ERROR } from "~/common/constant";
import { ImageEntityEnum } from "~/common/enum";
import { MENU_ERROR } from "~/common/error-code/menu";
import { rollback, withTransaction } from "~/config/db";
import {
    ICombo,
    IComboBody,
    IDish,
    IDishBody,
    IGetCombos,
    IGetDishes,
    IRestaurantMenu,
    IRestaurantMenuItemBody,
    ISelectQuery,
    ITag,
} from "~/interfaces";
import { imageRepository, menuRepository, restaurantRepository } from "~/repositories";
import { destroyImage } from "~/utils/cloudinary";
import { getPgErrorCode } from "~/utils/common";
import { buildPagination } from "~/utils/pagination";

/** Lỗi UNIQUE (tên trùng) -> DUPLICATE_NAME, còn lại -> FAILED */
const toMenuError = (error: unknown): number =>
    getPgErrorCode(error) === PG_ERROR.UNIQUE_VIOLATION ? MENU_ERROR.DUPLICATE_NAME : MENU_ERROR.FAILED;

// ---------------------------------------------------------------------------
// Thẻ
// ---------------------------------------------------------------------------

export const getTags = async (): Promise<ITag[] | number> => {
    try {
        return await menuRepository.getTags();
    } catch (error) {
        return MENU_ERROR.FAILED;
    }
};

export const createTag = async (name: string): Promise<ITag | number> => {
    try {
        return await menuRepository.createTag(name);
    } catch (error) {
        return toMenuError(error);
    }
};

export const updateTag = async (id: number, name: string): Promise<ITag | number> => {
    try {
        return (await menuRepository.updateTag(id, name)) ?? MENU_ERROR.NOT_FOUND;
    } catch (error) {
        return toMenuError(error);
    }
};

export const deleteTag = async (id: number): Promise<{ id: number } | number> => {
    try {
        return await withTransaction(async () => (await menuRepository.deleteTag(id)) ?? rollback(MENU_ERROR.NOT_FOUND));
    } catch (error) {
        return MENU_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Món ăn
// ---------------------------------------------------------------------------

/** `tagIds`: chỉ lấy món có ít nhất một thẻ trong danh sách (controller đã kiểm tra là số nguyên). */
export const getDishes = async (params: ISelectQuery, tagIds: number[] = []): Promise<IGetDishes | number> => {
    try {
        const conditions = tagIds.length
            ? [`EXISTS (SELECT 1 FROM dish_tags dt_f WHERE dt_f.dish_id = d.id AND dt_f.tag_id IN (${tagIds.join(", ")}))`]
            : [];
        const result = await menuRepository.getDishes({ ...params, conditions });
        return { dishes: result.rows, pagination: buildPagination(params, result.totalCount) };
    } catch (error) {
        return MENU_ERROR.FAILED;
    }
};

export const getDishById = async (id: number): Promise<IDish | number> => {
    try {
        return (await menuRepository.getDishById(id)) ?? MENU_ERROR.NOT_FOUND;
    } catch (error) {
        return MENU_ERROR.FAILED;
    }
};

export const createDish = async (body: IDishBody): Promise<IDish | number> => {
    try {
        return await withTransaction(async () => {
            const { tag_ids, ...fields } = body;
            const tagIds = [...new Set(tag_ids || [])];
            if ((await menuRepository.countTagsByIds(tagIds)) !== tagIds.length) {
                return rollback(MENU_ERROR.INVALID_TAGS);
            }
            const dish = await menuRepository.createDish(fields);
            await menuRepository.replaceDishTags(dish.id, tagIds);
            return (await menuRepository.getDishById(dish.id))!;
        });
    } catch (error) {
        return toMenuError(error);
    }
};

export const updateDish = async (id: number, body: IDishBody): Promise<IDish | number> => {
    try {
        return await withTransaction(async () => {
            const { tag_ids, ...fields } = body;
            const updated = await menuRepository.updateDish(id, fields);
            if (!updated) return rollback(MENU_ERROR.NOT_FOUND);

            if (tag_ids !== undefined) {
                const tagIds = [...new Set(tag_ids)];
                if ((await menuRepository.countTagsByIds(tagIds)) !== tagIds.length) {
                    return rollback(MENU_ERROR.INVALID_TAGS);
                }
                await menuRepository.replaceDishTags(id, tagIds);
            }
            return (await menuRepository.getDishById(id))!;
        });
    } catch (error) {
        return toMenuError(error);
    }
};

/** Không cho xóa món đang nằm trong combo; muốn ngừng bán thì đổi status = discontinued. */
export const deleteDish = async (id: number): Promise<{ id: number; combos?: string[] } | number> => {
    try {
        const combos = await menuRepository.getCombosContainingDish(id);
        if (combos.length > 0) return MENU_ERROR.DISH_IN_COMBO;

        let publicIds: string[] = [];
        const result = await withTransaction(async () => {
            const deleted = await menuRepository.deleteDish(id);
            if (!deleted) return rollback(MENU_ERROR.NOT_FOUND);
            publicIds = await imageRepository.deleteImagesOf(ImageEntityEnum.DISH, id);
            return deleted;
        });
        if (typeof result !== "number") await Promise.all(publicIds.map(destroyImage));
        return result;
    } catch (error) {
        return MENU_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Combo
// ---------------------------------------------------------------------------

const validateComboItems = async (items: { dish_id: number; quantity: number }[]): Promise<boolean> => {
    const ids = items.map((i) => i.dish_id);
    if (new Set(ids).size !== ids.length) return false;
    const existing = await menuRepository.getExistingDishIds(ids);
    return existing.length === ids.length;
};

export const getCombos = async (params: ISelectQuery): Promise<IGetCombos | number> => {
    try {
        const result = await menuRepository.getCombos(params);
        return { combos: result.rows, pagination: buildPagination(params, result.totalCount) };
    } catch (error) {
        return MENU_ERROR.FAILED;
    }
};

export const getComboById = async (id: number): Promise<ICombo | number> => {
    try {
        return (await menuRepository.getComboById(id)) ?? MENU_ERROR.NOT_FOUND;
    } catch (error) {
        return MENU_ERROR.FAILED;
    }
};

export const createCombo = async (body: IComboBody): Promise<ICombo | number> => {
    try {
        const { items = [], ...fields } = body;
        if (!(await validateComboItems(items))) return MENU_ERROR.INVALID_DISHES;
        return await withTransaction(async () => {
            const combo = await menuRepository.createCombo(fields);
            await menuRepository.replaceComboItems(combo.id, items);
            return (await menuRepository.getComboById(combo.id))!;
        });
    } catch (error) {
        return toMenuError(error);
    }
};

export const updateCombo = async (id: number, body: IComboBody): Promise<ICombo | number> => {
    try {
        const { items, ...fields } = body;
        if (items !== undefined && !(await validateComboItems(items))) return MENU_ERROR.INVALID_DISHES;
        return await withTransaction(async () => {
            const updated = await menuRepository.updateCombo(id, fields);
            if (!updated) return rollback(MENU_ERROR.NOT_FOUND);
            if (items !== undefined) await menuRepository.replaceComboItems(id, items);
            return (await menuRepository.getComboById(id))!;
        });
    } catch (error) {
        return toMenuError(error);
    }
};

export const deleteCombo = async (id: number): Promise<{ id: number } | number> => {
    try {
        let publicIds: string[] = [];
        const result = await withTransaction(async () => {
            const deleted = await menuRepository.deleteCombo(id);
            if (!deleted) return rollback(MENU_ERROR.NOT_FOUND);
            publicIds = await imageRepository.deleteImagesOf(ImageEntityEnum.COMBO, id);
            return deleted;
        });
        if (typeof result !== "number") await Promise.all(publicIds.map(destroyImage));
        return result;
    } catch (error) {
        return MENU_ERROR.FAILED;
    }
};

// ---------------------------------------------------------------------------
// Thực đơn theo nhà hàng
// ---------------------------------------------------------------------------

export const getRestaurantMenu = async (restaurantId: number): Promise<IRestaurantMenu | number> => {
    try {
        const restaurant = await restaurantRepository.getRestaurantById(restaurantId);
        if (!restaurant) return MENU_ERROR.RESTAURANT_NOT_FOUND;
        const menu = await menuRepository.getRestaurantMenu(restaurantId);
        return { restaurant_id: restaurantId, ...menu };
    } catch (error) {
        return MENU_ERROR.FAILED;
    }
};

/** Cập nhật một phần: field không truyền giữ nguyên giá trị hiện tại của nhà hàng. */
export const updateRestaurantMenuItem = async (
    kind: "dish" | "combo",
    restaurantId: number,
    itemId: number,
    body: IRestaurantMenuItemBody,
): Promise<IRestaurantMenu | number> => {
    try {
        const restaurant = await restaurantRepository.getRestaurantById(restaurantId);
        if (!restaurant) return MENU_ERROR.RESTAURANT_NOT_FOUND;

        const item =
            kind === "dish" ? await menuRepository.getDishById(itemId) : await menuRepository.getComboById(itemId);
        if (!item) return MENU_ERROR.NOT_FOUND;

        await withTransaction(async () => {
            const current = await menuRepository.getRestaurantMenuItem(kind, restaurantId, itemId);
            await menuRepository.upsertRestaurantMenuItem(kind, restaurantId, itemId, {
                is_available: body.is_available ?? current?.is_available ?? true,
                price: body.price !== undefined ? body.price : current?.price != null ? Number(current.price) : null,
            });
        });
        return await getRestaurantMenu(restaurantId);
    } catch (error) {
        return MENU_ERROR.FAILED;
    }
};
