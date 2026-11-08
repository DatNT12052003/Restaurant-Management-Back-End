import { Request, Response } from "express";
import { RESTAURANT_ERROR } from "~/common/error-code/restaurant";
import { isAdmin } from "~/common/role-level";
import {
    authorizationErrorResponse,
    badRequestResponse,
    createErrorResponse,
    notFoundResponse,
    serverErrorResponse,
} from "~/common/responses/error";
import { createSuccessResponse, getSuccessResponse, successResponse } from "~/common/responses/success";
import { IGetQuery } from "~/interfaces";
import { getRestaurantsResource } from "~/resources/restaurant.resource";
import { restaurantService } from "~/services";
import { buildListParams } from "~/utils/pagination";

const respondError = (req: Request, res: Response, code: number, fallback: string) => {
    switch (code) {
        case RESTAURANT_ERROR.NOT_FOUND:
            return notFoundResponse(res, req.t("restaurant:not_found"));
        case RESTAURANT_ERROR.HAS_DEPENDENCIES:
            return badRequestResponse(res, req.t("restaurant:has_dependencies"));
        default:
            return createErrorResponse(res, req.t(fallback));
    }
};

export const getRestaurants = async (req: Request, res: Response) => {
    try {
        const params = buildListParams(req.query as IGetQuery, {
            returning: [
                "id",
                "name",
                "status",
                "address",
                "service_fee_percent",
                "tax_percent",
                "open_time",
                "close_time",
                "reservation_hold_minutes",
                "no_show_after_minutes",
                "created_at",
                "updated_at",
                "deleted_at",
            ],
        });
        const restaurants = await restaurantService.getRestaurants(params);
        if (typeof restaurants === "number") {
            return createErrorResponse(res, req.t("restaurant:error_getting_restaurants"));
        }
        return getSuccessResponse(res, req.t("restaurant:get_restaurants_successfully"), restaurants);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

/** Danh sách rút gọn cho bộ chọn chi nhánh. Người không phải admin chỉ thấy nhà hàng của mình. */
export const getAllRestaurants = async (req: Request, res: Response) => {
    try {
        const admin = isAdmin(req.roles);
        if (!admin && !req.user?.restaurant_id) {
            return getSuccessResponse(res, req.t("restaurant:get_restaurants_successfully"), []);
        }
        const scope = admin ? null : req.user!.restaurant_id;
        const restaurants = await restaurantService.getAllRestaurants(scope);
        if (typeof restaurants === "number") {
            return createErrorResponse(res, req.t("restaurant:error_getting_restaurants"));
        }
        return getSuccessResponse(
            res,
            req.t("restaurant:get_restaurants_successfully"),
            getRestaurantsResource(restaurants),
        );
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const getRestaurantById = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (req.restaurantScope && req.restaurantScope !== id) {
            return authorizationErrorResponse(res, req.t("common:restaurant_forbidden"));
        }
        const restaurant = await restaurantService.getRestaurantById(id);
        if (typeof restaurant === "number") {
            return respondError(req, res, restaurant, "restaurant:error_getting_restaurants");
        }
        return getSuccessResponse(res, req.t("restaurant:get_restaurant_successfully"), restaurant);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const createRestaurant = async (req: Request, res: Response) => {
    try {
        const restaurant = await restaurantService.createRestaurant(req.body);
        if (typeof restaurant === "number") {
            return respondError(req, res, restaurant, "restaurant:create_failed");
        }
        return createSuccessResponse(res, req.t("restaurant:created_successfully"), restaurant);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const updateRestaurant = async (req: Request, res: Response) => {
    try {
        const restaurant = await restaurantService.updateRestaurant(Number(req.params.id), req.body);
        if (typeof restaurant === "number") {
            return respondError(req, res, restaurant, "restaurant:update_failed");
        }
        return successResponse(res, req.t("restaurant:updated_successfully"), restaurant);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const deleteRestaurant = async (req: Request, res: Response) => {
    try {
        const result = await restaurantService.deleteRestaurant(Number(req.params.id));
        if (typeof result === "number") {
            return respondError(req, res, result, "restaurant:delete_failed");
        }
        return successResponse(res, req.t("restaurant:deleted_successfully"), result);
    } catch (error) {
        return serverErrorResponse(res);
    }
};
