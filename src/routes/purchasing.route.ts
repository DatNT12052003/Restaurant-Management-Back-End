import { Router } from "express";
import {
    InventoryPermissionEnum,
    PayablePermissionEnum,
    PurchasePermissionEnum,
    SupplierPermissionEnum,
} from "~/common/permission-enum";
import { purchasingController as c } from "~/controllers";
import { auditRoute, authMiddleware, checkAnyPermission, checkPermission, restrictToRestaurant, validate } from "~/middlewares";
import {
    billIdSchema,
    createPurchaseOrderSchema,
    createSupplierSchema,
    createTransferSchema,
    ingredientPricesSchema,
    listBillsSchema,
    listPurchaseOrdersSchema,
    listSuppliersSchema,
    listTransfersSchema,
    payBillSchema,
    purchaseOrderActionSchema,
    purchaseOrderIdSchema,
    purchaseSuggestionsSchema,
    receivePurchaseOrderSchema,
    receiveTransferSchema,
    supplierIdSchema,
    supplierPricesSchema,
    transferIdSchema,
    updatePurchaseOrderSchema,
    updateSupplierSchema,
} from "~/schemas";

/** Giai đoạn 11: nhà cung cấp (danh mục chung cả chuỗi) */
export const supplierRouter = Router();
const SUPPLIER_VIEW = checkPermission(SupplierPermissionEnum.VIEW);
const SUPPLIER_MANAGE = checkPermission(SupplierPermissionEnum.MANAGE);

supplierRouter.use(authMiddleware);
supplierRouter.get("/", SUPPLIER_VIEW, validate(listSuppliersSchema), restrictToRestaurant, c.getSuppliers);
// Giá các nhà cung cấp chào cho một nguyên liệu (chọn nhà cung cấp khi lập đơn)
supplierRouter.get("/ingredients/:id/prices", SUPPLIER_VIEW, validate(ingredientPricesSchema), c.getIngredientPrices);
supplierRouter.get("/:id", SUPPLIER_VIEW, validate(supplierIdSchema), c.getSupplier);
supplierRouter.post("/", SUPPLIER_MANAGE, validate(createSupplierSchema), auditRoute("supplier.create", "supplier"), c.createSupplier);
supplierRouter.patch("/:id", SUPPLIER_MANAGE, validate(updateSupplierSchema), auditRoute("supplier.update", "supplier"), c.updateSupplier);
supplierRouter.put(
    "/:id/prices",
    SUPPLIER_MANAGE,
    validate(supplierPricesSchema),
    auditRoute("supplier.prices_update", "supplier"),
    c.updateSupplierPrices,
);
supplierRouter.delete(
    "/:id",
    SUPPLIER_MANAGE,
    validate(supplierIdSchema),
    auditRoute("supplier.delete", "supplier", { isDelete: true }),
    c.deleteSupplier,
);

/** Đơn đặt hàng nguyên liệu theo chi nhánh */
export const purchaseOrderRouter = Router();
const PO_VIEW = checkPermission(PurchasePermissionEnum.VIEW);
const PO_CREATE = checkPermission(PurchasePermissionEnum.CREATE);

purchaseOrderRouter.use(authMiddleware);
purchaseOrderRouter.get("/", PO_VIEW, validate(listPurchaseOrdersSchema), restrictToRestaurant, c.getPurchaseOrders);
purchaseOrderRouter.get("/suggestions", PO_VIEW, validate(purchaseSuggestionsSchema), restrictToRestaurant, c.getSuggestions);
purchaseOrderRouter.get("/:id", PO_VIEW, validate(purchaseOrderIdSchema), restrictToRestaurant, c.getPurchaseOrder);
purchaseOrderRouter.post(
    "/",
    PO_CREATE,
    validate(createPurchaseOrderSchema),
    restrictToRestaurant,
    auditRoute("purchase_order.create", "purchase_order", { restaurantId: (_r, d) => d?.restaurant_id }),
    c.createPurchaseOrder,
);
purchaseOrderRouter.patch("/:id", PO_CREATE, validate(updatePurchaseOrderSchema), restrictToRestaurant, c.updatePurchaseOrder);
purchaseOrderRouter.post("/:id/send", PO_CREATE, validate(purchaseOrderIdSchema), restrictToRestaurant, c.sendPurchaseOrder);
purchaseOrderRouter.post("/:id/cancel", PO_CREATE, validate(purchaseOrderActionSchema), restrictToRestaurant, c.cancelPurchaseOrder);
purchaseOrderRouter.post("/:id/close", PO_CREATE, validate(purchaseOrderActionSchema), restrictToRestaurant, c.closePurchaseOrder);
purchaseOrderRouter.post(
    "/:id/receive",
    checkPermission(PurchasePermissionEnum.RECEIVE),
    validate(receivePurchaseOrderSchema),
    restrictToRestaurant,
    auditRoute("purchase_order.receive", "purchase_order", { restaurantId: (_r, d) => d?.restaurant_id }),
    c.receivePurchaseOrder,
);

/** Chuyển kho giữa các chi nhánh */
export const stockTransferRouter = Router();
stockTransferRouter.use(authMiddleware);
stockTransferRouter.get(
    "/",
    checkPermission(InventoryPermissionEnum.VIEW),
    validate(listTransfersSchema),
    restrictToRestaurant,
    c.getTransfers,
);
// Danh sách chi nhánh nhận (id, tên) cho người có quyền chuyển kho
stockTransferRouter.get(
    "/destinations",
    checkPermission(InventoryPermissionEnum.TRANSFER),
    validate(listTransfersSchema),
    restrictToRestaurant,
    c.getTransferDestinations,
);
stockTransferRouter.get(
    "/:id",
    checkPermission(InventoryPermissionEnum.VIEW),
    validate(transferIdSchema),
    restrictToRestaurant,
    c.getTransfer,
);
// Người bị giới hạn nhà hàng luôn gửi từ chi nhánh của mình (service dùng restaurantScope, bỏ qua from_restaurant_id)
stockTransferRouter.post(
    "/",
    checkPermission(InventoryPermissionEnum.TRANSFER),
    validate(createTransferSchema),
    restrictToRestaurant,
    c.createTransfer,
);
// Chi nhánh nhận xác nhận: người chuyển kho hoặc người nhập kho của chi nhánh đó
stockTransferRouter.post(
    "/:id/receive",
    checkAnyPermission([InventoryPermissionEnum.TRANSFER, InventoryPermissionEnum.IMPORT]),
    validate(receiveTransferSchema),
    restrictToRestaurant,
    c.receiveTransfer,
);
stockTransferRouter.post(
    "/:id/cancel",
    checkPermission(InventoryPermissionEnum.TRANSFER),
    validate(transferIdSchema),
    restrictToRestaurant,
    c.cancelTransfer,
);

/** Công nợ nhà cung cấp */
export const payableRouter = Router();
payableRouter.use(authMiddleware);
payableRouter.get("/", checkPermission(PayablePermissionEnum.VIEW), validate(listBillsSchema), restrictToRestaurant, c.getBills);
payableRouter.get("/:id", checkPermission(PayablePermissionEnum.VIEW), validate(billIdSchema), restrictToRestaurant, c.getBill);
payableRouter.post(
    "/:id/payments",
    checkPermission(PayablePermissionEnum.PAY),
    validate(payBillSchema),
    restrictToRestaurant,
    c.payBill,
);
