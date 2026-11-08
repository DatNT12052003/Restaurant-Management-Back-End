import { Router } from "express";
import { PaymentPermissionEnum } from "~/common/permission-enum";
import { paymentController } from "~/controllers";
import { auditRoute, authMiddleware, checkPermission, restrictToRestaurant, validate } from "~/middlewares";
import { AUDIT_BEFORE } from "~/utils/audit-loaders";
import { listPaymentsSchema, paymentIdSchema, refundPaymentSchema } from "~/schemas";

/**
 * Giao dịch thanh toán (đặc tả 4.8). Thu tiền cho order qua `POST /api/orders/:id/payments`;
 * ở đây là lịch sử giao dịch và các thao tác trên một giao dịch.
 */
const router = Router();

const CREATE = checkPermission(PaymentPermissionEnum.CREATE);

router.use(authMiddleware);

router.get("/", checkPermission(PaymentPermissionEnum.VIEW), validate(listPaymentsSchema), restrictToRestaurant, paymentController.getPayments);
router.post(
    "/:id/confirm",
    CREATE,
    validate(paymentIdSchema),
    restrictToRestaurant,
    auditRoute("payment.confirm", "payment", { before: AUDIT_BEFORE.payment }),
    paymentController.confirmPayment,
);
router.post(
    "/:id/cancel",
    CREATE,
    validate(paymentIdSchema),
    restrictToRestaurant,
    auditRoute("payment.cancel", "payment", { before: AUDIT_BEFORE.payment }),
    paymentController.cancelPayment,
);
router.post(
    "/:id/fail",
    CREATE,
    validate(paymentIdSchema),
    restrictToRestaurant,
    auditRoute("payment.fail", "payment", { before: AUDIT_BEFORE.payment }),
    paymentController.failPayment,
);
router.post(
    "/:id/refund",
    checkPermission(PaymentPermissionEnum.REFUND),
    validate(refundPaymentSchema),
    restrictToRestaurant,
    paymentController.refundPayment,
);

export default router;
