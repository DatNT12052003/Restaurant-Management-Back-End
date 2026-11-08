import { Router } from "express";
import { DiscountPermissionEnum, OrderPermissionEnum, PaymentPermissionEnum } from "~/common/permission-enum";
import { discountController, orderController, paymentController } from "~/controllers";
import {
    auditRoute,
    authMiddleware,
    checkAnyPermission,
    checkPermission,
    restrictToRestaurant,
    validate,
} from "~/middlewares";
import {
    activeOrdersSchema,
    addOrderTablesSchema,
    batchLineStatusSchema,
    mergeOrderSchema,
    splitOrderSchema,
    applyDiscountSchema,
    createPaymentSchema,
    cancelOrderSchema,
    createOrderSchema,
    createRoundSchema,
    kitchenQueueSchema,
    listOrdersSchema,
    orderIdSchema,
    releaseOrderTableSchema,
    transferOrderTableSchema,
    updateLineStatusSchema,
    updateOrderSchema,
} from "~/schemas";

/**
 * Order và quy trình phục vụ (đặc tả 4.7). `restrictToRestaurant` chặn chỉ định nhà hàng khác;
 * với `/:id`, service kiểm tra order thuộc phạm vi.
 */
const router = Router();

const VIEW = checkPermission(OrderPermissionEnum.VIEW);
const UPDATE = checkPermission(OrderPermissionEnum.UPDATE);

router.use(authMiddleware);

router.get("/", VIEW, validate(listOrdersSchema), restrictToRestaurant, orderController.getOrders);
// Order đang mở (sơ đồ phục vụ)
router.get("/active", VIEW, validate(activeOrdersSchema), restrictToRestaurant, orderController.getActiveOrders);
// Hàng chờ bếp / pha chế (?station=kitchen|bar)
router.get("/kitchen-queue", VIEW, validate(kitchenQueueSchema), restrictToRestaurant, orderController.getKitchenQueue);
// Đổi trạng thái món: quyền cụ thể (order_item.prepare / serve, order.update / cancel) được kiểm tra ở service
router.patch("/dishes/:id/status", VIEW, validate(updateLineStatusSchema), restrictToRestaurant, orderController.updateDishLineStatus);
router.patch("/combos/:id/status", VIEW, validate(updateLineStatusSchema), restrictToRestaurant, orderController.updateComboLineStatus);
// Đổi trạng thái hàng loạt (cả đợt gọi món, "phục vụ tất cả"); quyền từng bước vẫn kiểm tra ở service
router.patch("/lines/status", VIEW, validate(batchLineStatusSchema), restrictToRestaurant, orderController.updateLinesStatus);

router.get("/:id", VIEW, validate(orderIdSchema), restrictToRestaurant, orderController.getOrderById);
router.post(
    "/",
    checkPermission(OrderPermissionEnum.CREATE),
    validate(createOrderSchema),
    restrictToRestaurant,
    orderController.createOrder,
);
router.patch("/:id", UPDATE, validate(updateOrderSchema), restrictToRestaurant, orderController.updateOrder);
router.post("/:id/rounds", UPDATE, validate(createRoundSchema), restrictToRestaurant, orderController.addRound);
router.post("/:id/tables", UPDATE, validate(addOrderTablesSchema), restrictToRestaurant, orderController.addTables);
router.post("/:id/transfer", UPDATE, validate(transferOrderTableSchema), restrictToRestaurant, orderController.transferTable);
// Gộp order này vào order khác / tách món sang order khác (câu hỏi 3)
router.post("/:id/merge", UPDATE, validate(mergeOrderSchema), restrictToRestaurant, orderController.mergeOrder);
router.post("/:id/split", UPDATE, validate(splitOrderSchema), restrictToRestaurant, orderController.splitOrder);
router.delete(
    "/:id/tables/:tableId",
    UPDATE,
    validate(releaseOrderTableSchema),
    restrictToRestaurant,
    orderController.releaseTable,
);
// Hoàn tất: phục vụ hoặc thu ngân (thường tự hoàn tất khi thu đủ tiền)
router.post(
    "/:id/complete",
    checkAnyPermission([OrderPermissionEnum.UPDATE, PaymentPermissionEnum.CREATE]),
    validate(orderIdSchema),
    restrictToRestaurant,
    orderController.completeOrder,
);
router.post(
    "/:id/cancel",
    checkPermission(OrderPermissionEnum.CANCEL),
    validate(cancelOrderSchema),
    restrictToRestaurant,
    orderController.cancelOrder,
);

// ---- Giai đoạn 5: giảm giá, thanh toán, hóa đơn ----
router.post(
    "/:id/discount",
    checkPermission(DiscountPermissionEnum.APPLY),
    validate(applyDiscountSchema),
    restrictToRestaurant,
    auditRoute("order.discount_apply", "order"),
    discountController.applyDiscount,
);
router.delete(
    "/:id/discount",
    checkPermission(DiscountPermissionEnum.APPLY),
    validate(orderIdSchema),
    restrictToRestaurant,
    auditRoute("order.discount_remove", "order"),
    discountController.removeDiscount,
);
router.post(
    "/:id/payments",
    checkPermission(PaymentPermissionEnum.CREATE),
    validate(createPaymentSchema),
    restrictToRestaurant,
    paymentController.createPayment,
);
router.get(
    "/:id/invoice",
    checkAnyPermission([OrderPermissionEnum.VIEW, PaymentPermissionEnum.VIEW]),
    validate(orderIdSchema),
    restrictToRestaurant,
    paymentController.getInvoice,
);

export default router;
