import { Request, Response } from "express";
import { FilterOperatorEnum } from "~/common/enum";
import { EINVOICE_ERROR, GATEWAY_ERROR, PAYMENT_ERROR } from "~/common/error-code/payment";
import {
    authenticationErrorResponse,
    badRequestResponse,
    conflictResponse,
    createErrorResponse,
    notFoundResponse,
    serverErrorResponse,
} from "~/common/responses/error";
import { createSuccessResponse, getSuccessResponse, successResponse } from "~/common/responses/success";
import { pool } from "~/config/db";
import { IGetQuery } from "~/interfaces";
import { withRestaurantScope } from "~/middlewares/restaurantScope.middleware";
import { listEInvoicesSchema, listGatewayTransactionsSchema } from "~/schemas";
import { eInvoiceService, paymentGatewayService } from "~/services";
import { auditContext } from "~/utils/audit";
import { buildListParams } from "~/utils/pagination";

/** Giai đoạn 14: chuyển khoản QR + webhook SePay, đối soát, hóa đơn điện tử, kiểm tra sức khỏe */

type Respond = typeof badRequestResponse;

const QR_ERRORS: Record<number, [Respond, string]> = {
    [PAYMENT_ERROR.ORDER_NOT_FOUND]: [notFoundResponse, "order:not_found"],
    [PAYMENT_ERROR.ORDER_CLOSED]: [badRequestResponse, "order:order_closed"],
    [PAYMENT_ERROR.NOTHING_DUE]: [badRequestResponse, "payment:nothing_due"],
    [PAYMENT_ERROR.AMOUNT_EXCEEDS_DUE]: [badRequestResponse, "payment:amount_exceeds_due"],
    [PAYMENT_ERROR.QR_NOT_CONFIGURED]: [badRequestResponse, "payment:qr_not_configured"],
};

const GATEWAY_ERRORS: Record<number, [Respond, string]> = {
    [GATEWAY_ERROR.NOT_FOUND]: [notFoundResponse, "payment:transaction_not_found"],
    [GATEWAY_ERROR.UNAUTHORIZED]: [authenticationErrorResponse, "payment:webhook_unauthorized"],
    [GATEWAY_ERROR.INVALID_PAYLOAD]: [badRequestResponse, "payment:webhook_invalid"],
    [GATEWAY_ERROR.ALREADY_RESOLVED]: [conflictResponse, "payment:transaction_resolved"],
    [GATEWAY_ERROR.ORDER_NOT_FOUND]: [notFoundResponse, "order:not_found"],
    [GATEWAY_ERROR.ORDER_CLOSED]: [badRequestResponse, "order:order_closed"],
    [GATEWAY_ERROR.AMOUNT_EXCEEDS_DUE]: [badRequestResponse, "payment:amount_exceeds_due"],
    [GATEWAY_ERROR.RESTAURANT_MISMATCH]: [badRequestResponse, "payment:transaction_restaurant_mismatch"],
};

const EINVOICE_ERRORS: Record<number, [Respond, string]> = {
    [EINVOICE_ERROR.NOT_FOUND]: [notFoundResponse, "payment:einvoice_not_found"],
    [EINVOICE_ERROR.ORDER_NOT_FOUND]: [notFoundResponse, "order:not_found"],
    [EINVOICE_ERROR.ORDER_NOT_COMPLETED]: [badRequestResponse, "payment:einvoice_order_not_completed"],
    [EINVOICE_ERROR.ALREADY_ISSUED]: [conflictResponse, "payment:einvoice_already_issued"],
    [EINVOICE_ERROR.SELLER_NOT_CONFIGURED]: [badRequestResponse, "payment:einvoice_seller_not_configured"],
    [EINVOICE_ERROR.INVALID_STATUS]: [badRequestResponse, "payment:einvoice_invalid_status"],
    [EINVOICE_ERROR.BUYER_REQUIRED]: [badRequestResponse, "payment:einvoice_buyer_required"],
    [EINVOICE_ERROR.PROVIDER_ERROR]: [badRequestResponse, "payment:einvoice_provider_error"],
};

type Kind = "create" | "get" | "update";

const handle = async (
    req: Request,
    res: Response,
    errors: Record<number, [Respond, string]>,
    kind: Kind,
    messageKey: string,
    run: () => Promise<unknown>,
) => {
    try {
        const result = await run();
        if (typeof result === "number") {
            const [respond, key] = errors[result] ?? [createErrorResponse, "payment:integration_failed"];
            return respond(res, req.t(key));
        }
        const message = req.t(`payment:${messageKey}`);
        if (kind === "create") return createSuccessResponse(res, message, result);
        if (kind === "get") return getSuccessResponse(res, message, result);
        return successResponse(res, message, result);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

const id = (req: Request) => Number(req.params.id);

// ---- Chuyển khoản QR ----

export const createQrPayment = (req: Request, res: Response) =>
    handle(req, res, QR_ERRORS, "create", "qr_created", () =>
        paymentGatewayService.createQrPayment(id(req), req.body?.amount, req.restaurantScope, req.user?.id),
    );

/** Trang bàn công khai: khách tạo mã chuyển khoản cho số còn lại */
export const createTableQr = (req: Request, res: Response) =>
    handle(req, res, QR_ERRORS, "create", "qr_created", () => paymentGatewayService.createQrForTable(req.params.token as string));

/** SePay: luôn trả 200 khi đã nhận (kể cả giao dịch không khớp) để SePay không gửi lại */
export const sepayWebhook = (req: Request, res: Response) =>
    handle(req, res, GATEWAY_ERRORS, "update", "webhook_received", () =>
        paymentGatewayService.handleSepayWebhook(req.headers.authorization, req.body),
    );

// ---- Đối soát ----

export const getTransactions = (req: Request, res: Response) => {
    const query = req.query as IGetQuery;
    const extra = listGatewayTransactionsSchema.shape.query.parse(req.query);
    const scope = req.restaurantScope ?? extra.restaurant_id ?? null;
    const filters = withRestaurantScope(query.filters, "restaurant_id", scope);
    if (extra.status === "open") filters.push({ field: "status", operator: FilterOperatorEnum.IN, value: ["unmatched", "mismatch"] });
    else if (extra.status) filters.push({ field: "status", value: extra.status });
    if (extra.from) filters.push({ field: "created_at", operator: FilterOperatorEnum.GREATER_THAN, value: extra.from });
    if (extra.to) filters.push({ field: "created_at", operator: FilterOperatorEnum.LESS_THAN, value: extra.to });
    const params = buildListParams({ ...query, filters });
    return handle(req, res, GATEWAY_ERRORS, "get", "transactions_fetched", () => paymentGatewayService.getTransactions(params, scope));
};

export const applyTransaction = (req: Request, res: Response) =>
    handle(req, res, GATEWAY_ERRORS, "update", "transaction_applied", () =>
        paymentGatewayService.applyTransaction(id(req), Number(req.body.order_id), req.restaurantScope, auditContext(req)),
    );

export const ignoreTransaction = (req: Request, res: Response) =>
    handle(req, res, GATEWAY_ERRORS, "update", "transaction_ignored", () =>
        paymentGatewayService.ignoreTransaction(id(req), req.body?.note, req.restaurantScope, auditContext(req)),
    );

// ---- Hóa đơn điện tử ----

export const issueEInvoice = (req: Request, res: Response) =>
    handle(req, res, EINVOICE_ERRORS, "create", "einvoice_issued", () =>
        eInvoiceService.issueForOrder(id(req), req.body, req.restaurantScope, auditContext(req)),
    );

export const getEInvoices = (req: Request, res: Response) => {
    const query = req.query as IGetQuery;
    const extra = listEInvoicesSchema.shape.query.parse(req.query);
    const filters = withRestaurantScope(query.filters, "restaurant_id", req.restaurantScope ?? extra.restaurant_id);
    if (extra.order_id) filters.push({ field: "order_id", value: extra.order_id });
    if (extra.status) filters.push({ field: "status", value: extra.status });
    if (extra.from) filters.push({ field: "created_at", operator: FilterOperatorEnum.GREATER_THAN, value: extra.from });
    if (extra.to) filters.push({ field: "created_at", operator: FilterOperatorEnum.LESS_THAN, value: extra.to });
    const params = buildListParams({ ...query, filters });
    return handle(req, res, EINVOICE_ERRORS, "get", "einvoices_fetched", () => eInvoiceService.getEInvoices(params));
};

export const getEInvoice = (req: Request, res: Response) =>
    handle(req, res, EINVOICE_ERRORS, "get", "einvoices_fetched", () => eInvoiceService.getEInvoice(id(req), req.restaurantScope));

export const retryEInvoice = (req: Request, res: Response) =>
    handle(req, res, EINVOICE_ERRORS, "update", "einvoice_retried", () => eInvoiceService.retryEInvoice(id(req), req.restaurantScope));

export const cancelEInvoice = (req: Request, res: Response) =>
    handle(req, res, EINVOICE_ERRORS, "update", "einvoice_cancelled", () =>
        eInvoiceService.cancelEInvoice(id(req), req.body.reason, req.restaurantScope, auditContext(req)),
    );

// ---- Kiểm tra sức khỏe (load balancer, Docker healthcheck, giám sát) ----

const startedAt = Date.now();

/** Tiến trình còn sống */
export const liveness = (_req: Request, res: Response) =>
    res.status(200).json({ status: "ok", uptime_seconds: Math.round((Date.now() - startedAt) / 1000), version: process.env.APP_VERSION ?? null });

/** Sẵn sàng nhận request: kết nối được DB */
export const readiness = async (_req: Request, res: Response) => {
    try {
        await pool.query("SELECT 1");
        return res.status(200).json({ status: "ok", database: "ok" });
    } catch (error) {
        return res.status(503).json({ status: "unavailable", database: "error" });
    }
};
