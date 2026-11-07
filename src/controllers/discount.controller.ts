import { Request, Response } from "express";
import { DISCOUNT_ERROR } from "~/common/error-code/payment";
import {
    authorizationErrorResponse,
    badRequestResponse,
    createErrorResponse,
    notFoundResponse,
    serverErrorResponse,
} from "~/common/responses/error";
import { createSuccessResponse, getSuccessResponse, successResponse } from "~/common/responses/success";
import { IGetQuery } from "~/interfaces";
import { listDiscountsSchema } from "~/schemas";
import { discountService } from "~/services";
import { buildListParams } from "~/utils/pagination";
import { withRestaurantScope } from "~/middlewares/restaurantScope.middleware";

const ERROR_MESSAGES: Record<number, [typeof badRequestResponse, string]> = {
    [DISCOUNT_ERROR.NOT_FOUND]: [notFoundResponse, "discount:not_found"],
    [DISCOUNT_ERROR.DUPLICATE_CODE]: [badRequestResponse, "discount:duplicate_code"],
    [DISCOUNT_ERROR.FORBIDDEN]: [authorizationErrorResponse, "discount:forbidden"],
    [DISCOUNT_ERROR.RESTAURANT_NOT_FOUND]: [notFoundResponse, "restaurant:not_found"],
    [DISCOUNT_ERROR.INACTIVE]: [badRequestResponse, "discount:inactive"],
    [DISCOUNT_ERROR.NOT_STARTED]: [badRequestResponse, "discount:not_started"],
    [DISCOUNT_ERROR.EXPIRED]: [badRequestResponse, "discount:expired"],
    [DISCOUNT_ERROR.NOT_APPLICABLE]: [badRequestResponse, "discount:not_applicable"],
    [DISCOUNT_ERROR.MIN_ORDER_NOT_MET]: [badRequestResponse, "discount:min_order_not_met"],
    [DISCOUNT_ERROR.USAGE_LIMIT_REACHED]: [badRequestResponse, "discount:usage_limit_reached"],
    [DISCOUNT_ERROR.PER_USER_LIMIT_REACHED]: [badRequestResponse, "discount:per_user_limit_reached"],
    [DISCOUNT_ERROR.GUEST_REQUIRED]: [badRequestResponse, "discount:guest_required"],
    [DISCOUNT_ERROR.ORDER_NOT_FOUND]: [notFoundResponse, "order:not_found"],
    [DISCOUNT_ERROR.ORDER_CLOSED]: [badRequestResponse, "order:order_closed"],
    [DISCOUNT_ERROR.NO_DISCOUNT]: [badRequestResponse, "discount:no_discount"],
    [DISCOUNT_ERROR.INVALID_VALUE]: [badRequestResponse, "discount:invalid_value"],
};

type Action = "get" | "create" | "update" | "delete" | "apply" | "remove";

const handle = async (req: Request, res: Response, action: Action, run: () => Promise<unknown>) => {
    try {
        const result = await run();
        if (typeof result === "number") {
            const [respond, key] = ERROR_MESSAGES[result] ?? [createErrorResponse, `discount:${action}_failed`];
            return respond(res, req.t(key));
        }
        const message = req.t(`discount:${action}_successfully`);
        if (action === "create") return createSuccessResponse(res, message, result);
        if (action === "get") return getSuccessResponse(res, message, result);
        return successResponse(res, message, result);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

const id = (req: Request) => Number(req.params.id);

export const getDiscounts = (req: Request, res: Response) => {
    const query = req.query as IGetQuery;
    const extra = listDiscountsSchema.shape.query.parse(req.query);
    // Admin lọc theo ?restaurant_id=; người bị giới hạn được thấy mã cả chuỗi + mã nhà hàng mình (service)
    const filters =
        req.restaurantScope == null ? withRestaurantScope(query.filters, "restaurant_id", extra.restaurant_id) : query.filters;
    const params = buildListParams({ ...query, filters });
    return handle(req, res, "get", () => discountService.getDiscounts(params, req.restaurantScope));
};

export const getDiscountById = (req: Request, res: Response) =>
    handle(req, res, "get", () => discountService.getDiscountById(id(req), req.restaurantScope));

export const createDiscount = (req: Request, res: Response) =>
    handle(req, res, "create", () => discountService.createDiscount(req.body, req.restaurantScope, req.user?.id));

export const updateDiscount = (req: Request, res: Response) =>
    handle(req, res, "update", () => discountService.updateDiscount(id(req), req.body, req.restaurantScope));

export const deleteDiscount = (req: Request, res: Response) =>
    handle(req, res, "delete", () => discountService.deleteDiscount(id(req), req.restaurantScope));

export const applyDiscount = (req: Request, res: Response) =>
    handle(req, res, "apply", () => discountService.applyDiscount(id(req), req.body.code, req.restaurantScope, req.user?.id));

export const removeDiscount = (req: Request, res: Response) =>
    handle(req, res, "remove", () => discountService.removeDiscount(id(req), req.restaurantScope));
