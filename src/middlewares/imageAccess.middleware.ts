import { Request, Response, NextFunction } from "express";
import { ImageEntityEnum } from "~/common/enum";
import {
    ComboPermissionEnum,
    DishPermissionEnum,
    RestaurantPermissionEnum,
    RoomPermissionEnum,
} from "~/common/permission-enum";
import { isAdmin } from "~/common/role-level";
import { authorizationErrorResponse, notFoundResponse, serverErrorResponse } from "~/common/responses/error";
import { getImageById } from "~/repositories/image.repository";
import { getComboById, getDishById } from "~/repositories/menu.repository";
import { getRestaurantById } from "~/repositories/restaurant.repository";
import { getRoomById } from "~/repositories/room.repository";

/** Quyền cần có để xem / sửa ảnh của từng loại đối tượng */
const IMAGE_PERMISSIONS: Record<ImageEntityEnum, { view: string; update: string }> = {
    [ImageEntityEnum.DISH]: { view: DishPermissionEnum.VIEW, update: DishPermissionEnum.UPDATE },
    [ImageEntityEnum.COMBO]: { view: ComboPermissionEnum.VIEW, update: ComboPermissionEnum.UPDATE },
    [ImageEntityEnum.RESTAURANT]: { view: RestaurantPermissionEnum.VIEW, update: RestaurantPermissionEnum.UPDATE },
    [ImageEntityEnum.ROOM]: { view: RoomPermissionEnum.VIEW, update: RoomPermissionEnum.UPDATE },
};

/** Đối tượng có tồn tại và nằm trong phạm vi nhà hàng của người dùng không */
const entityAccessible = async (type: ImageEntityEnum, id: number, scope: number | null): Promise<boolean> => {
    switch (type) {
        case ImageEntityEnum.DISH:
            return !!(await getDishById(id));
        case ImageEntityEnum.COMBO:
            return !!(await getComboById(id));
        case ImageEntityEnum.RESTAURANT:
            return !!(await getRestaurantById(id)) && (scope === null || scope === id);
        case ImageEntityEnum.ROOM: {
            const room = await getRoomById(id);
            return !!room && (scope === null || room.restaurant_id === scope);
        }
        default:
            return false;
    }
};

/**
 * Kiểm tra quyền thao tác với ảnh. Chạy sau `loadUserContext` (và `validate`).
 * - Route `/:id`: lấy ảnh theo id, gán `req.image`.
 * - Route khác: đọc `entity_type`, `entity_id` từ query (xem) hoặc body (tải lên).
 * Quyền cần có phụ thuộc loại đối tượng (ví dụ ảnh món cần `dish.update` để sửa).
 */
export const authorizeImageAccess = (action: "view" | "update") => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            let entityType: ImageEntityEnum;
            let entityId: number;

            if (req.params.id) {
                const image = await getImageById(Number(req.params.id));
                if (!image) {
                    notFoundResponse(res, req.t("image:not_found"));
                    return;
                }
                req.image = image;
                entityType = image.entity_type;
                entityId = image.entity_id;
            } else {
                const source = (action === "view" ? req.query : req.body) as Record<string, unknown>;
                entityType = source.entity_type as ImageEntityEnum;
                entityId = Number(source.entity_id);
            }

            const permission = IMAGE_PERMISSIONS[entityType]?.[action];
            if (!permission || !req.permissions?.includes(permission)) {
                authorizationErrorResponse(res, req.t("common:forbidden"));
                return;
            }

            const scope = isAdmin(req.roles) ? null : (req.user?.restaurant_id ?? -1);
            if (!(await entityAccessible(entityType, entityId, scope))) {
                notFoundResponse(res, req.t("image:entity_not_found"));
                return;
            }
            next();
        } catch (error) {
            serverErrorResponse(res);
        }
    };
};
