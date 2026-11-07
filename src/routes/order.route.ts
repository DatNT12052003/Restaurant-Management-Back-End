import { Router } from "express";
import { OrderPermissionEnum } from "~/common/permission-enum";
import { orderController } from "~/controllers";
import { authMiddleware, checkPermission, restrictToRestaurant, validate } from "~/middlewares";
import {
    activeOrdersSchema,
    addOrderTablesSchema,
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
router.delete(
    "/:id/tables/:tableId",
    UPDATE,
    validate(releaseOrderTableSchema),
    restrictToRestaurant,
    orderController.releaseTable,
);
router.post("/:id/complete", UPDATE, validate(orderIdSchema), restrictToRestaurant, orderController.completeOrder);
router.post(
    "/:id/cancel",
    checkPermission(OrderPermissionEnum.CANCEL),
    validate(cancelOrderSchema),
    restrictToRestaurant,
    orderController.cancelOrder,
);

export default router;
