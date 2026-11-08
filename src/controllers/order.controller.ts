import { Request, Response } from "express";
import { FilterOperatorEnum } from "~/common/enum";
import { ORDER_ERROR } from "~/common/error-code/order";
import {
    authorizationErrorResponse,
    badRequestResponse,
    createErrorResponse,
    notFoundResponse,
    serverErrorResponse,
} from "~/common/responses/error";
import { createSuccessResponse, getSuccessResponse, successResponse } from "~/common/responses/success";
import { IGetQuery, OrderLineKind } from "~/interfaces";
import { withRestaurantScope } from "~/middlewares/restaurantScope.middleware";
import { activeOrdersSchema, kitchenQueueSchema, listOrdersSchema } from "~/schemas";
import { orderService } from "~/services";
import { auditContext } from "~/utils/audit";
import { buildListParams } from "~/utils/pagination";

/** Mã lỗi service -> hàm response và key i18n */
const ERROR_MESSAGES: Record<number, [typeof badRequestResponse, string]> = {
    [ORDER_ERROR.NOT_FOUND]: [notFoundResponse, "order:not_found"],
    [ORDER_ERROR.RESTAURANT_REQUIRED]: [badRequestResponse, "order:restaurant_required"],
    [ORDER_ERROR.RESTAURANT_NOT_FOUND]: [notFoundResponse, "restaurant:not_found"],
    [ORDER_ERROR.INVALID_TABLES]: [badRequestResponse, "order:invalid_tables"],
    [ORDER_ERROR.TABLE_BUSY]: [badRequestResponse, "order:table_busy"],
    [ORDER_ERROR.ORDER_CLOSED]: [badRequestResponse, "order:order_closed"],
    [ORDER_ERROR.TABLE_NOT_IN_ORDER]: [badRequestResponse, "order:table_not_in_order"],
    [ORDER_ERROR.LAST_TABLE]: [badRequestResponse, "order:last_table"],
    [ORDER_ERROR.ITEM_UNAVAILABLE]: [badRequestResponse, "order:item_unavailable"],
    [ORDER_ERROR.ITEM_NOT_FOUND]: [notFoundResponse, "order:item_not_found"],
    [ORDER_ERROR.INVALID_TRANSITION]: [badRequestResponse, "order:invalid_transition"],
    [ORDER_ERROR.TRANSITION_FORBIDDEN]: [authorizationErrorResponse, "order:transition_forbidden"],
    [ORDER_ERROR.ITEMS_NOT_SERVED]: [badRequestResponse, "order:items_not_served"],
    [ORDER_ERROR.HAS_SERVED_ITEMS]: [badRequestResponse, "order:has_served_items"],
    [ORDER_ERROR.RESERVATION_NOT_FOUND]: [notFoundResponse, "reservation:not_found"],
    [ORDER_ERROR.RESERVATION_CLOSED]: [badRequestResponse, "order:reservation_closed"],
    [ORDER_ERROR.RESERVATION_HAS_ORDER]: [badRequestResponse, "order:reservation_has_order"],
    [ORDER_ERROR.GUEST_NOT_FOUND]: [notFoundResponse, "reservation:guest_not_found"],
    [ORDER_ERROR.STAFF_NOT_FOUND]: [notFoundResponse, "order:staff_not_found"],
    [ORDER_ERROR.NOT_FULLY_PAID]: [badRequestResponse, "order:not_fully_paid"],
    [ORDER_ERROR.PENDING_PAYMENTS]: [badRequestResponse, "order:pending_payments"],
    [ORDER_ERROR.HAS_PAYMENTS]: [badRequestResponse, "order:has_payments"],
};

type Action = "get" | "create" | "update" | "round" | "table" | "item" | "complete" | "cancel";

const handle = async (req: Request, res: Response, action: Action, run: () => Promise<unknown>) => {
    try {
        const result = await run();
        if (typeof result === "number") {
            const [respond, key] = ERROR_MESSAGES[result] ?? [createErrorResponse, `order:${action}_failed`];
            return respond(res, req.t(key));
        }
        const message = req.t(`order:${action}_successfully`);
        if (action === "create" || action === "round") return createSuccessResponse(res, message, result);
        if (action === "get") return getSuccessResponse(res, message, result);
        return successResponse(res, message, result);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

const id = (req: Request) => Number(req.params.id);

/** Express 5 parse lại `req.query` mỗi lần đọc -> parse lại bằng schema (đã qua `validate`) để có đúng kiểu */
export const getOrders = (req: Request, res: Response) => {
    const query = req.query as IGetQuery;
    const extra = listOrdersSchema.shape.query.parse(req.query);
    const filters = withRestaurantScope(query.filters, "restaurant_id", req.restaurantScope ?? extra.restaurant_id);
    if (extra.from) filters.push({ field: "created_at", operator: FilterOperatorEnum.GREATER_THAN, value: extra.from });
    if (extra.to) filters.push({ field: "created_at", operator: FilterOperatorEnum.LESS_THAN, value: extra.to });
    const params = buildListParams({ ...query, filters });
    return handle(req, res, "get", () => orderService.getOrders(params, extra.table_id));
};

export const getActiveOrders = (req: Request, res: Response) => {
    const q = activeOrdersSchema.shape.query.parse(req.query);
    return handle(req, res, "get", () => orderService.getActiveOrders(req.restaurantScope, q.restaurant_id));
};

export const getKitchenQueue = (req: Request, res: Response) => {
    const q = kitchenQueueSchema.shape.query.parse(req.query);
    return handle(req, res, "get", () => orderService.getKitchenQueue(req.restaurantScope, q.restaurant_id, q.station));
};

export const getOrderById = (req: Request, res: Response) =>
    handle(req, res, "get", () => orderService.getOrderById(id(req), req.restaurantScope));

export const createOrder = (req: Request, res: Response) =>
    handle(req, res, "create", () => orderService.createOrder(req.body, req.restaurantScope, req.user?.id));

export const updateOrder = (req: Request, res: Response) =>
    handle(req, res, "update", () => orderService.updateOrder(id(req), req.body, req.restaurantScope));

export const addRound = (req: Request, res: Response) =>
    handle(req, res, "round", () => orderService.addRound(id(req), req.body, req.restaurantScope, req.user?.id));

export const addTables = (req: Request, res: Response) =>
    handle(req, res, "table", () => orderService.addTables(id(req), req.body.table_ids, req.restaurantScope));

export const transferTable = (req: Request, res: Response) =>
    handle(req, res, "table", () =>
        orderService.transferTable(id(req), req.body.from_table_id, req.body.to_table_id, req.restaurantScope),
    );

export const releaseTable = (req: Request, res: Response) =>
    handle(req, res, "table", () => orderService.releaseTable(id(req), Number(req.params.tableId), req.restaurantScope));

export const completeOrder = (req: Request, res: Response) =>
    handle(req, res, "complete", () => orderService.completeOrder(id(req), req.restaurantScope));

export const cancelOrder = (req: Request, res: Response) =>
    handle(req, res, "cancel", () =>
        orderService.cancelOrder(id(req), req.body.cancel_reason, req.restaurantScope, auditContext(req)),
    );

const updateLine = (kind: OrderLineKind) => (req: Request, res: Response) =>
    handle(req, res, "item", () =>
        orderService.updateLineStatus(kind, id(req), req.body, req.restaurantScope, {
            id: req.user!.id,
            permissions: req.permissions || [],
            audit: auditContext(req),
        }),
    );

export const updateDishLineStatus = updateLine("dish");
export const updateComboLineStatus = updateLine("combo");
