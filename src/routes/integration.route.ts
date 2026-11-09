import { Router } from "express";
import { EInvoicePermissionEnum, PaymentPermissionEnum } from "~/common/permission-enum";
import { integrationController as c } from "~/controllers";
import { authMiddleware, checkPermission, restrictToRestaurant, validate } from "~/middlewares";
import {
    applyGatewayTransactionSchema,
    cancelEInvoiceSchema,
    eInvoiceIdSchema,
    ignoreGatewayTransactionSchema,
    listEInvoicesSchema,
    listGatewayTransactionsSchema,
} from "~/schemas";

/** Giai đoạn 14: kiểm tra sức khỏe (không cần đăng nhập, không ghi log request) */
export const healthRouter = Router();
healthRouter.get("/", c.liveness);
healthRouter.get("/ready", c.readiness);

/**
 * Cổng thanh toán (`/api/payment-gateway`):
 * - Webhook SePay xác thực bằng header `Authorization: Apikey ...` (không dùng token đăng nhập).
 * - Đối soát giao dịch ngân hàng: `payment.reconcile`.
 */
export const paymentGatewayRouter = Router();
paymentGatewayRouter.post("/webhooks/sepay", c.sepayWebhook);

const RECONCILE = checkPermission(PaymentPermissionEnum.RECONCILE);
paymentGatewayRouter.get(
    "/transactions",
    authMiddleware,
    RECONCILE,
    validate(listGatewayTransactionsSchema),
    restrictToRestaurant,
    c.getTransactions,
);
paymentGatewayRouter.post(
    "/transactions/:id/apply",
    authMiddleware,
    RECONCILE,
    validate(applyGatewayTransactionSchema),
    restrictToRestaurant,
    c.applyTransaction,
);
paymentGatewayRouter.post(
    "/transactions/:id/ignore",
    authMiddleware,
    RECONCILE,
    validate(ignoreGatewayTransactionSchema),
    restrictToRestaurant,
    c.ignoreTransaction,
);

/** Hóa đơn điện tử (`/api/e-invoices`). Phát hành cho order qua `POST /api/orders/:id/e-invoice`. */
export const eInvoiceRouter = Router();
eInvoiceRouter.use(authMiddleware);
eInvoiceRouter.get("/", checkPermission(EInvoicePermissionEnum.VIEW), validate(listEInvoicesSchema), restrictToRestaurant, c.getEInvoices);
eInvoiceRouter.get("/:id", checkPermission(EInvoicePermissionEnum.VIEW), validate(eInvoiceIdSchema), restrictToRestaurant, c.getEInvoice);
eInvoiceRouter.post(
    "/:id/retry",
    checkPermission(EInvoicePermissionEnum.ISSUE),
    validate(eInvoiceIdSchema),
    restrictToRestaurant,
    c.retryEInvoice,
);
eInvoiceRouter.post(
    "/:id/cancel",
    checkPermission(EInvoicePermissionEnum.CANCEL),
    validate(cancelEInvoiceSchema),
    restrictToRestaurant,
    c.cancelEInvoice,
);
