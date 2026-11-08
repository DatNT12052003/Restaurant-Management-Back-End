import { Request, Response } from "express";
import { FilterOperatorEnum } from "~/common/enum";
import { PAYABLE_ERROR, PURCHASE_ERROR, SUPPLIER_ERROR, TRANSFER_ERROR } from "~/common/error-code/purchasing";
import { INVENTORY_ERROR } from "~/common/error-code/inventory";
import {
    authorizationErrorResponse,
    badRequestResponse,
    createErrorResponse,
    notFoundResponse,
    serverErrorResponse,
} from "~/common/responses/error";
import { createSuccessResponse, getSuccessResponse, successResponse } from "~/common/responses/success";
import { IGetQuery } from "~/interfaces";
import { withRestaurantScope } from "~/middlewares/restaurantScope.middleware";
import {
    listBillsSchema,
    listPurchaseOrdersSchema,
    listSuppliersSchema,
    listTransfersSchema,
    purchaseSuggestionsSchema,
} from "~/schemas";
import { purchasingService, transferService } from "~/services";
import { auditContext } from "~/utils/audit";
import { buildListParams } from "~/utils/pagination";

type Responder = typeof badRequestResponse;
type Action = "get" | "create" | "update" | "delete" | "send" | "cancel" | "close" | "receive" | "pay";

/** Lỗi từ phiếu nhập kho (khi nhận hàng theo đơn) dùng chung mã của kho */
const INVENTORY_MESSAGES: Record<number, [Responder, string]> = {
    [INVENTORY_ERROR.INVALID_INGREDIENTS]: [badRequestResponse, "inventory:invalid_ingredients"],
    [INVENTORY_ERROR.EXPIRY_REQUIRED]: [badRequestResponse, "inventory:expiry_required"],
};

const MESSAGES: Record<string, Record<number, [Responder, string]>> = {
    supplier: {
        [SUPPLIER_ERROR.NOT_FOUND]: [notFoundResponse, "purchasing:supplier_not_found"],
        [SUPPLIER_ERROR.DUPLICATE_NAME]: [badRequestResponse, "purchasing:supplier_duplicate"],
        [SUPPLIER_ERROR.IN_USE]: [badRequestResponse, "purchasing:supplier_in_use"],
        [SUPPLIER_ERROR.INVALID_INGREDIENTS]: [badRequestResponse, "inventory:invalid_ingredients"],
    },
    purchase: {
        [PURCHASE_ERROR.NOT_FOUND]: [notFoundResponse, "purchasing:order_not_found"],
        [PURCHASE_ERROR.RESTAURANT_REQUIRED]: [badRequestResponse, "inventory:restaurant_required"],
        [PURCHASE_ERROR.RESTAURANT_NOT_FOUND]: [notFoundResponse, "restaurant:not_found"],
        [PURCHASE_ERROR.SUPPLIER_INVALID]: [badRequestResponse, "purchasing:supplier_invalid"],
        [PURCHASE_ERROR.INVALID_INGREDIENTS]: [badRequestResponse, "inventory:invalid_ingredients"],
        [PURCHASE_ERROR.INVALID_STATUS]: [badRequestResponse, "purchasing:order_invalid_status"],
        [PURCHASE_ERROR.INVALID_LINES]: [badRequestResponse, "purchasing:order_invalid_lines"],
        [PURCHASE_ERROR.EXPIRY_REQUIRED]: [badRequestResponse, "inventory:expiry_required"],
        [PURCHASE_ERROR.HAS_RECEIPTS]: [badRequestResponse, "purchasing:order_has_receipts"],
    },
    transfer: {
        [TRANSFER_ERROR.NOT_FOUND]: [notFoundResponse, "purchasing:transfer_not_found"],
        [TRANSFER_ERROR.RESTAURANT_REQUIRED]: [badRequestResponse, "inventory:restaurant_required"],
        [TRANSFER_ERROR.INVALID_DESTINATION]: [badRequestResponse, "purchasing:transfer_invalid_destination"],
        [TRANSFER_ERROR.INVALID_INGREDIENTS]: [badRequestResponse, "inventory:invalid_ingredients"],
        [TRANSFER_ERROR.INSUFFICIENT_STOCK]: [badRequestResponse, "inventory:insufficient_stock"],
        [TRANSFER_ERROR.INVALID_STATUS]: [badRequestResponse, "purchasing:transfer_invalid_status"],
        [TRANSFER_ERROR.WRONG_BRANCH]: [authorizationErrorResponse, "purchasing:transfer_wrong_branch"],
        [TRANSFER_ERROR.INVALID_LINES]: [badRequestResponse, "purchasing:transfer_invalid_lines"],
    },
    payable: {
        [PAYABLE_ERROR.NOT_FOUND]: [notFoundResponse, "purchasing:bill_not_found"],
        [PAYABLE_ERROR.ALREADY_PAID]: [badRequestResponse, "purchasing:bill_already_paid"],
        [PAYABLE_ERROR.AMOUNT_EXCEEDS]: [badRequestResponse, "purchasing:bill_amount_exceeds"],
    },
};

const handle = async (req: Request, res: Response, group: string, action: Action, run: () => Promise<unknown>) => {
    try {
        const result = await run();
        if (typeof result === "number") {
            // Nhận hàng theo đơn đi qua phiếu nhập kho: mã lỗi có thể là của kho
            const fromInventory = action === "receive" && group === "purchase" ? INVENTORY_MESSAGES[result] : undefined;
            const [respond, key] = fromInventory ?? MESSAGES[group][result] ?? [createErrorResponse, `purchasing:${group}_${action}_failed`];
            return respond(res, req.t(key));
        }
        const message = req.t(`purchasing:${group}_${action}_successfully`);
        if (action === "get") return getSuccessResponse(res, message, result);
        if (action === "create") return createSuccessResponse(res, message, result);
        return successResponse(res, message, result);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

const id = (req: Request) => Number(req.params.id);

// ---- Nhà cung cấp ----

export const getSuppliers = (req: Request, res: Response) => {
    const q = listSuppliersSchema.shape.query.parse(req.query);
    return handle(req, res, "supplier", "get", () =>
        purchasingService.getSuppliers({ search: q.search ?? undefined, status: q.status }, req.restaurantScope),
    );
};
export const getSupplier = (req: Request, res: Response) => handle(req, res, "supplier", "get", () => purchasingService.getSupplier(id(req)));
export const createSupplier = (req: Request, res: Response) =>
    handle(req, res, "supplier", "create", () => purchasingService.createSupplier(req.body));
export const updateSupplier = (req: Request, res: Response) =>
    handle(req, res, "supplier", "update", () => purchasingService.updateSupplier(id(req), req.body));
export const deleteSupplier = (req: Request, res: Response) =>
    handle(req, res, "supplier", "delete", () => purchasingService.deleteSupplier(id(req)));
export const updateSupplierPrices = (req: Request, res: Response) =>
    handle(req, res, "supplier", "update", () => purchasingService.updateSupplierPrices(id(req), req.body));
export const getIngredientPrices = (req: Request, res: Response) =>
    handle(req, res, "supplier", "get", () => purchasingService.getIngredientPrices(id(req)));

// ---- Đơn đặt hàng ----

export const getPurchaseOrders = (req: Request, res: Response) => {
    const query = req.query as IGetQuery;
    const extra = listPurchaseOrdersSchema.shape.query.parse(req.query);
    const filters = withRestaurantScope(query.filters, "restaurant_id", req.restaurantScope ?? extra.restaurant_id);
    if (extra.supplier_id) filters.push({ field: "supplier_id", operator: FilterOperatorEnum.EQUAL, value: extra.supplier_id });
    if (extra.status) filters.push({ field: "status", operator: FilterOperatorEnum.EQUAL, value: extra.status });
    return handle(req, res, "purchase", "get", () => purchasingService.getPurchaseOrders(buildListParams({ ...query, filters })));
};
export const getPurchaseOrder = (req: Request, res: Response) =>
    handle(req, res, "purchase", "get", () => purchasingService.getPurchaseOrder(id(req), req.restaurantScope));
export const getSuggestions = (req: Request, res: Response) => {
    const q = purchaseSuggestionsSchema.shape.query.parse(req.query);
    return handle(req, res, "purchase", "get", () => purchasingService.getSuggestions(req.restaurantScope, q));
};
export const createPurchaseOrder = (req: Request, res: Response) =>
    handle(req, res, "purchase", "create", () => purchasingService.createPurchaseOrder(req.body, req.restaurantScope, req.user?.id));
export const updatePurchaseOrder = (req: Request, res: Response) =>
    handle(req, res, "purchase", "update", () => purchasingService.updatePurchaseOrder(id(req), req.body, req.restaurantScope));
const changeStatus = (action: "send" | "cancel" | "close") => (req: Request, res: Response) =>
    handle(req, res, "purchase", action, () =>
        purchasingService.changePurchaseOrderStatus(id(req), action, req.restaurantScope, auditContext(req), req.body?.reason),
    );
export const sendPurchaseOrder = changeStatus("send");
export const cancelPurchaseOrder = changeStatus("cancel");
export const closePurchaseOrder = changeStatus("close");
export const receivePurchaseOrder = (req: Request, res: Response) =>
    handle(req, res, "purchase", "receive", () =>
        purchasingService.receivePurchaseOrder(id(req), req.body, req.restaurantScope, auditContext(req)),
    );

// ---- Chuyển kho ----

export const getTransfers = (req: Request, res: Response) => {
    const query = req.query as IGetQuery;
    const extra = listTransfersSchema.shape.query.parse(req.query);
    const filters = [...(query.filters || [])];
    if (extra.status) filters.push({ field: "status", operator: FilterOperatorEnum.EQUAL, value: extra.status });
    return handle(req, res, "transfer", "get", () =>
        transferService.getTransfers(buildListParams({ ...query, filters }), req.restaurantScope, extra.restaurant_id),
    );
};
export const getTransferDestinations = (req: Request, res: Response) => {
    const extra = listTransfersSchema.shape.query.parse(req.query);
    return handle(req, res, "transfer", "get", () => transferService.getDestinations(req.restaurantScope, extra.restaurant_id));
};
export const getTransfer = (req: Request, res: Response) =>
    handle(req, res, "transfer", "get", () => transferService.getTransfer(id(req), req.restaurantScope));
export const createTransfer = (req: Request, res: Response) =>
    handle(req, res, "transfer", "create", () => transferService.createTransfer(req.body, req.restaurantScope, auditContext(req)));
export const receiveTransfer = (req: Request, res: Response) =>
    handle(req, res, "transfer", "receive", () => transferService.receiveTransfer(id(req), req.body, req.restaurantScope, auditContext(req)));
export const cancelTransfer = (req: Request, res: Response) =>
    handle(req, res, "transfer", "cancel", () => transferService.cancelTransfer(id(req), req.restaurantScope, auditContext(req)));

// ---- Công nợ ----

export const getBills = (req: Request, res: Response) => {
    const query = req.query as IGetQuery;
    const extra = listBillsSchema.shape.query.parse(req.query);
    const filters = withRestaurantScope(query.filters, "restaurant_id", req.restaurantScope ?? extra.restaurant_id);
    if (extra.supplier_id) filters.push({ field: "supplier_id", operator: FilterOperatorEnum.EQUAL, value: extra.supplier_id });
    if (extra.status) filters.push({ field: "status", operator: FilterOperatorEnum.EQUAL, value: extra.status });
    return handle(req, res, "payable", "get", () => transferService.getBills(buildListParams({ ...query, filters }), !!extra.overdue));
};
export const getBill = (req: Request, res: Response) =>
    handle(req, res, "payable", "get", () => transferService.getBill(id(req), req.restaurantScope));
export const payBill = (req: Request, res: Response) =>
    handle(req, res, "payable", "pay", () => transferService.payBill(id(req), req.body, req.restaurantScope, auditContext(req)));
