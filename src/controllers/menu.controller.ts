import { Request, Response } from "express";
import { MENU_ERROR } from "~/common/error-code/menu";
import { badRequestResponse, createErrorResponse, notFoundResponse, serverErrorResponse } from "~/common/responses/error";
import { createSuccessResponse, getSuccessResponse, successResponse } from "~/common/responses/success";
import { IGetQuery } from "~/interfaces";
import { menuService } from "~/services";
import { buildListParams } from "~/utils/pagination";

/** Chạy service và trả response chuẩn; mã lỗi -> thông báo theo `ns` (menu:dish_..., menu:combo_...) */
const handle = async (
    req: Request,
    res: Response,
    ns: "tag" | "dish" | "combo" | "restaurant_menu",
    action: "get" | "create" | "update" | "delete",
    run: () => Promise<unknown>,
) => {
    try {
        const result = await run();
        if (typeof result === "number") {
            switch (result) {
                case MENU_ERROR.NOT_FOUND:
                    return notFoundResponse(res, req.t(`menu:${ns}_not_found`));
                case MENU_ERROR.RESTAURANT_NOT_FOUND:
                    return notFoundResponse(res, req.t("restaurant:not_found"));
                case MENU_ERROR.DUPLICATE_NAME:
                    return badRequestResponse(res, req.t(`menu:${ns}_duplicate_name`));
                case MENU_ERROR.INVALID_TAGS:
                    return badRequestResponse(res, req.t("menu:invalid_tags"));
                case MENU_ERROR.INVALID_DISHES:
                    return badRequestResponse(res, req.t("menu:invalid_dishes"));
                case MENU_ERROR.DISH_IN_COMBO:
                    return badRequestResponse(res, req.t("menu:dish_in_combo"));
                default:
                    return createErrorResponse(res, req.t(`menu:${ns}_${action}_failed`));
            }
        }
        const message = req.t(`menu:${ns}_${action}_successfully`);
        if (action === "create") return createSuccessResponse(res, message, result);
        if (action === "get") return getSuccessResponse(res, message, result);
        return successResponse(res, message, result);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

const id = (req: Request) => Number(req.params.id);

// ---- Thẻ ----
export const getTags = (req: Request, res: Response) => handle(req, res, "tag", "get", () => menuService.getTags());
export const createTag = (req: Request, res: Response) =>
    handle(req, res, "tag", "create", () => menuService.createTag(req.body.name));
export const updateTag = (req: Request, res: Response) =>
    handle(req, res, "tag", "update", () => menuService.updateTag(id(req), req.body.name));
export const deleteTag = (req: Request, res: Response) =>
    handle(req, res, "tag", "delete", () => menuService.deleteTag(id(req)));

// ---- Món ăn ----
export const getDishes = (req: Request, res: Response) => {
    const query = req.query as IGetQuery;
    const filters = Array.isArray(query.filters) ? query.filters : [];
    // "tag_id" không phải cột của dishes -> tách ra, lọc bằng EXISTS ở service
    const tagIds = filters
        .filter((f) => f.field === "tag_id")
        .flatMap((f) => ([] as unknown[]).concat(f.value))
        .map(Number);
    if (tagIds.some((t) => !Number.isInteger(t) || t <= 0)) {
        return badRequestResponse(res, req.t("menu:invalid_tags"));
    }
    const params = buildListParams({ ...query, filters: filters.filter((f) => f.field !== "tag_id") });
    return handle(req, res, "dish", "get", () => menuService.getDishes(params, tagIds));
};
export const getDishById = (req: Request, res: Response) =>
    handle(req, res, "dish", "get", () => menuService.getDishById(id(req)));
export const createDish = (req: Request, res: Response) =>
    handle(req, res, "dish", "create", () => menuService.createDish(req.body));
export const updateDish = (req: Request, res: Response) =>
    handle(req, res, "dish", "update", () => menuService.updateDish(id(req), req.body));
export const deleteDish = (req: Request, res: Response) =>
    handle(req, res, "dish", "delete", () => menuService.deleteDish(id(req)));

// ---- Combo ----
export const getCombos = (req: Request, res: Response) =>
    handle(req, res, "combo", "get", () => menuService.getCombos(buildListParams(req.query as IGetQuery)));
export const getComboById = (req: Request, res: Response) =>
    handle(req, res, "combo", "get", () => menuService.getComboById(id(req)));
export const createCombo = (req: Request, res: Response) =>
    handle(req, res, "combo", "create", () => menuService.createCombo(req.body));
export const updateCombo = (req: Request, res: Response) =>
    handle(req, res, "combo", "update", () => menuService.updateCombo(id(req), req.body));
export const deleteCombo = (req: Request, res: Response) =>
    handle(req, res, "combo", "delete", () => menuService.deleteCombo(id(req)));

// ---- Thực đơn theo nhà hàng ----
export const getRestaurantMenu = (req: Request, res: Response) =>
    handle(req, res, "restaurant_menu", "get", () => menuService.getRestaurantMenu(Number(req.params.restaurantId)));

export const updateRestaurantDish = (req: Request, res: Response) =>
    handle(req, res, "restaurant_menu", "update", () =>
        menuService.updateRestaurantMenuItem(
            "dish",
            Number(req.params.restaurantId),
            Number(req.params.itemId),
            req.body,
        ),
    );

export const updateRestaurantCombo = (req: Request, res: Response) =>
    handle(req, res, "restaurant_menu", "update", () =>
        menuService.updateRestaurantMenuItem(
            "combo",
            Number(req.params.restaurantId),
            Number(req.params.itemId),
            req.body,
        ),
    );
