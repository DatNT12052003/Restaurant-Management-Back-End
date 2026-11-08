import { Request, Response } from "express";
import { FilterOperatorEnum } from "~/common/enum";
import { PAYMENT_ERROR } from "~/common/error-code/payment";
import { badRequestResponse, createErrorResponse, notFoundResponse, serverErrorResponse } from "~/common/responses/error";
import { createSuccessResponse, getSuccessResponse, successResponse } from "~/common/responses/success";
import { IGetQuery } from "~/interfaces";
import { withRestaurantScope } from "~/middlewares/restaurantScope.middleware";
import { listPaymentsSchema } from "~/schemas";
import { paymentService } from "~/services";
import { auditContext } from "~/utils/audit";
import { buildListParams } from "~/utils/pagination";

const ERROR_MESSAGES: Record<number, [typeof badRequestResponse, string]> = {
    [PAYMENT_ERROR.NOT_FOUND]: [notFoundResponse, "payment:not_found"],
    [PAYMENT_ERROR.ORDER_NOT_FOUND]: [notFoundResponse, "order:not_found"],
    [PAYMENT_ERROR.ORDER_CLOSED]: [badRequestResponse, "order:order_closed"],
    [PAYMENT_ERROR.NOTHING_DUE]: [badRequestResponse, "payment:nothing_due"],
    [PAYMENT_ERROR.AMOUNT_EXCEEDS_DUE]: [badRequestResponse, "payment:amount_exceeds_due"],
    [PAYMENT_ERROR.RECEIVED_TOO_LOW]: [badRequestResponse, "payment:received_too_low"],
    [PAYMENT_ERROR.PENDING_CASH]: [badRequestResponse, "payment:pending_cash"],
    [PAYMENT_ERROR.INVALID_STATUS]: [badRequestResponse, "payment:invalid_status"],
    [PAYMENT_ERROR.REFUND_EXCEEDS]: [badRequestResponse, "payment:refund_exceeds"],
    [PAYMENT_ERROR.TIP_STAFF_NOT_FOUND]: [notFoundResponse, "payment:tip_staff_not_found"],
};

type Action = "get" | "create" | "confirm" | "cancel" | "fail" | "refund";

const handle = async (req: Request, res: Response, action: Action, run: () => Promise<unknown>) => {
    try {
        const result = await run();
        if (typeof result === "number") {
            const [respond, key] = ERROR_MESSAGES[result] ?? [createErrorResponse, `payment:${action}_failed`];
            return respond(res, req.t(key));
        }
        const message = req.t(`payment:${action}_successfully`);
        if (action === "create" || action === "refund") return createSuccessResponse(res, message, result);
        if (action === "get") return getSuccessResponse(res, message, result);
        return successResponse(res, message, result);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

const id = (req: Request) => Number(req.params.id);

/** Lịch sử giao dịch. Express 5 parse lại `req.query` mỗi lần đọc -> parse lại bằng schema để có đúng kiểu. */
export const getPayments = (req: Request, res: Response) => {
    const query = req.query as IGetQuery;
    const extra = listPaymentsSchema.shape.query.parse(req.query);
    const filters = withRestaurantScope(query.filters, "restaurant_id", req.restaurantScope ?? extra.restaurant_id);
    if (extra.order_id) filters.push({ field: "order_id", value: extra.order_id });
    if (extra.method) filters.push({ field: "method", value: extra.method });
    if (extra.status) filters.push({ field: "status", value: extra.status });
    if (extra.type) filters.push({ field: "type", value: extra.type });
    if (extra.from) filters.push({ field: "created_at", operator: FilterOperatorEnum.GREATER_THAN, value: extra.from });
    if (extra.to) filters.push({ field: "created_at", operator: FilterOperatorEnum.LESS_THAN, value: extra.to });
    const params = buildListParams({ ...query, filters });
    return handle(req, res, "get", () => paymentService.getPayments(params));
};

export const getInvoice = (req: Request, res: Response) =>
    handle(req, res, "get", () => paymentService.getInvoice(id(req), req.restaurantScope));

export const createPayment = (req: Request, res: Response) =>
    handle(req, res, "create", () => paymentService.createPayment(id(req), req.body, req.restaurantScope, req.user?.id));

export const confirmPayment = (req: Request, res: Response) =>
    handle(req, res, "confirm", () => paymentService.confirmPayment(id(req), req.restaurantScope, req.user?.id));

export const cancelPayment = (req: Request, res: Response) =>
    handle(req, res, "cancel", () => paymentService.cancelPayment(id(req), req.restaurantScope, req.user?.id));

export const failPayment = (req: Request, res: Response) =>
    handle(req, res, "fail", () => paymentService.failPayment(id(req), req.restaurantScope, req.user?.id));

export const refundPayment = (req: Request, res: Response) =>
    handle(req, res, "refund", () => paymentService.refundPayment(id(req), req.body, req.restaurantScope, auditContext(req)));
