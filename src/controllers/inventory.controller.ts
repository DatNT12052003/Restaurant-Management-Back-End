import { Request, Response } from "express";
import { FilterOperatorEnum } from "~/common/enum";
import { INGREDIENT_ERROR, INVENTORY_ERROR } from "~/common/error-code/inventory";
import { badRequestResponse, createErrorResponse, notFoundResponse, serverErrorResponse } from "~/common/responses/error";
import { createSuccessResponse, getSuccessResponse, successResponse } from "~/common/responses/success";
import { IGetQuery } from "~/interfaces";
import { withRestaurantScope } from "~/middlewares/restaurantScope.middleware";
import { listInventoryTransactionsSchema, listReceiptsSchema, stockSchema } from "~/schemas";
import { inventoryService } from "~/services";
import { auditContext } from "~/utils/audit";
import { buildListParams } from "~/utils/pagination";

const INVENTORY_MESSAGES: Record<number, [typeof badRequestResponse, string]> = {
    [INVENTORY_ERROR.RESTAURANT_REQUIRED]: [badRequestResponse, "inventory:restaurant_required"],
    [INVENTORY_ERROR.RESTAURANT_NOT_FOUND]: [notFoundResponse, "restaurant:not_found"],
    [INVENTORY_ERROR.INVALID_INGREDIENTS]: [badRequestResponse, "inventory:invalid_ingredients"],
    [INVENTORY_ERROR.INSUFFICIENT_STOCK]: [badRequestResponse, "inventory:insufficient_stock"],
    [INVENTORY_ERROR.NO_CHANGES]: [badRequestResponse, "inventory:no_changes"],
    [INVENTORY_ERROR.RECEIPT_NOT_FOUND]: [notFoundResponse, "inventory:receipt_not_found"],
};

const INGREDIENT_MESSAGES: Record<number, [typeof badRequestResponse, string]> = {
    [INGREDIENT_ERROR.NOT_FOUND]: [notFoundResponse, "inventory:ingredient_not_found"],
    [INGREDIENT_ERROR.DUPLICATE_NAME]: [badRequestResponse, "inventory:ingredient_duplicate"],
    [INGREDIENT_ERROR.IN_STOCK]: [badRequestResponse, "inventory:ingredient_in_stock"],
    [INGREDIENT_ERROR.UNIT_LOCKED]: [badRequestResponse, "inventory:unit_locked"],
    [INGREDIENT_ERROR.IN_RECIPE]: [badRequestResponse, "inventory:ingredient_in_recipe"],
};

const handle = async (
    req: Request,
    res: Response,
    key: string,
    kind: "get" | "create" | "update",
    messages: Record<number, [typeof badRequestResponse, string]>,
    run: () => Promise<unknown>,
) => {
    try {
        const result = await run();
        if (typeof result === "number") {
            const [respond, msg] = messages[result] ?? [createErrorResponse, `inventory:${key}_failed`];
            return respond(res, req.t(msg));
        }
        const message = req.t(`inventory:${key}_successfully`);
        if (kind === "create") return createSuccessResponse(res, message, result);
        if (kind === "get") return getSuccessResponse(res, message, result);
        return successResponse(res, message, result);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

const id = (req: Request) => Number(req.params.id);

// ---- Nguyên liệu ----

export const getIngredients = (req: Request, res: Response) => {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
    const status = req.query.status === "active" || req.query.status === "inactive" ? req.query.status : undefined;
    return handle(req, res, "get", "get", INGREDIENT_MESSAGES, () => inventoryService.getIngredients(search, status));
};
export const createIngredient = (req: Request, res: Response) =>
    handle(req, res, "ingredient_create", "create", INGREDIENT_MESSAGES, () => inventoryService.createIngredient(req.body));
export const updateIngredient = (req: Request, res: Response) =>
    handle(req, res, "ingredient_update", "update", INGREDIENT_MESSAGES, () => inventoryService.updateIngredient(id(req), req.body));
export const deleteIngredient = (req: Request, res: Response) =>
    handle(req, res, "ingredient_delete", "update", INGREDIENT_MESSAGES, () => inventoryService.deleteIngredient(id(req)));

// ---- Tồn kho ----

/** Express 5 parse lại `req.query` mỗi lần đọc -> parse lại bằng schema (đã qua `validate`) để có đúng kiểu */
export const getStock = (req: Request, res: Response) => {
    const q = stockSchema.shape.query.parse(req.query);
    return handle(req, res, "get", "get", INVENTORY_MESSAGES, () => inventoryService.getStock(req.restaurantScope, q));
};

export const setMinQuantity = (req: Request, res: Response) =>
    handle(req, res, "setting", "update", INVENTORY_MESSAGES, () => inventoryService.setMinQuantity(req.restaurantScope, req.body));

// ---- Phiếu kho ----

export const createReceipt = (req: Request, res: Response) =>
    handle(req, res, `receipt_${req.body.type}`, "create", INVENTORY_MESSAGES, () =>
        inventoryService.createReceipt(req.body, req.restaurantScope, auditContext(req)),
    );

export const getReceiptById = (req: Request, res: Response) =>
    handle(req, res, "get", "get", INVENTORY_MESSAGES, () => inventoryService.getReceiptById(id(req), req.restaurantScope));

export const getReceipts = (req: Request, res: Response) => {
    const query = req.query as IGetQuery;
    const extra = listReceiptsSchema.shape.query.parse(req.query);
    const filters = withRestaurantScope(query.filters, "restaurant_id", req.restaurantScope ?? extra.restaurant_id);
    if (extra.type) filters.push({ field: "type", value: extra.type });
    if (extra.from) filters.push({ field: "created_at", operator: FilterOperatorEnum.GREATER_THAN, value: extra.from });
    if (extra.to) filters.push({ field: "created_at", operator: FilterOperatorEnum.LESS_THAN, value: extra.to });
    const params = buildListParams({ ...query, filters });
    return handle(req, res, "get", "get", INVENTORY_MESSAGES, () => inventoryService.getReceipts(params));
};

export const getTransactions = (req: Request, res: Response) => {
    const query = req.query as IGetQuery;
    const extra = listInventoryTransactionsSchema.shape.query.parse(req.query);
    const filters = withRestaurantScope(query.filters, "restaurant_id", req.restaurantScope ?? extra.restaurant_id);
    if (extra.ingredient_id) filters.push({ field: "ingredient_id", value: extra.ingredient_id });
    if (extra.type) filters.push({ field: "type", value: extra.type });
    if (extra.from) filters.push({ field: "created_at", operator: FilterOperatorEnum.GREATER_THAN, value: extra.from });
    if (extra.to) filters.push({ field: "created_at", operator: FilterOperatorEnum.LESS_THAN, value: extra.to });
    const params = buildListParams({ ...query, filters });
    return handle(req, res, "get", "get", INVENTORY_MESSAGES, () => inventoryService.getTransactions(params));
};
