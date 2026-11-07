import { Request, Response, NextFunction } from "express";
import { RolesEnum } from "~/common/enum";
import { authorizationErrorResponse, serverErrorResponse } from "~/common/responses/error";
import { IGetQuery } from "~/interfaces";

/**
 * Giới hạn phạm vi dữ liệu theo nhà hàng (đặc tả mục 6.1, 8.2). Phải chạy sau `checkPermission`.
 *
 * - Admin: `req.restaurantScope = null` (được xem mọi nhà hàng).
 * - Vai trò khác: `req.restaurantScope = user.restaurant_id`. Nếu request chỉ định rõ một `restaurant_id`
 *   khác (params, body hoặc query) thì bị chặn 403. User chưa được phân công nhà hàng cũng bị chặn.
 *
 * Controller/repository chịu trách nhiệm áp `req.restaurantScope` vào truy vấn (xem `withRestaurantScope`).
 *
 * Hiện tại mỗi nhân viên thuộc một nhà hàng (`users.restaurant_id`). Nếu sau này chuyển sang bảng
 * `user_restaurants`, chỉ cần đổi cách tính phạm vi tại đây.
 */
export const restrictToRestaurant = (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    const roles = req.roles;
    if (!user || !roles) {
        serverErrorResponse(res);
        return;
    }

    if (roles.includes(RolesEnum.ADMIN)) {
        req.restaurantScope = null;
        return next();
    }

    if (!user.restaurant_id) {
        authorizationErrorResponse(res, req.t("common:restaurant_not_assigned"));
        return;
    }

    const requested = [
        req.params?.restaurantId,
        req.body?.restaurant_id,
        req.body?.user?.restaurant_id,
        req.query?.restaurant_id,
    ]
        .filter((v) => v !== undefined && v !== null && v !== "")
        .map(Number);

    if (requested.some((id) => id !== user.restaurant_id)) {
        authorizationErrorResponse(res, req.t("common:restaurant_forbidden"));
        return;
    }

    req.restaurantScope = user.restaurant_id;
    next();
};

/** Thêm điều kiện `field = scope` vào danh sách filter khi người dùng bị giới hạn nhà hàng. */
export const withRestaurantScope = (
    filters: IGetQuery["filters"] = [],
    field: string,
    scope: number | null | undefined,
): NonNullable<IGetQuery["filters"]> => {
    const list = Array.isArray(filters) ? filters : [];
    if (scope === null || scope === undefined) return list;
    return [...list, { field, value: scope }];
};
