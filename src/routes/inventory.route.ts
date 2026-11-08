import { NextFunction, Request, Response, Router } from "express";
import { InventoryReceiptTypeEnum } from "~/common/enum";
import { IngredientPermissionEnum, InventoryPermissionEnum } from "~/common/permission-enum";
import { inventoryController } from "~/controllers";
import { auditRoute, authMiddleware, checkPermission, restrictToRestaurant, validate } from "~/middlewares";
import { AUDIT_BEFORE } from "~/utils/audit-loaders";
import {
    createIngredientSchema,
    createReceiptSchema,
    ingredientIdSchema,
    listInventoryTransactionsSchema,
    listReceiptsSchema,
    receiptIdSchema,
    stockSchema,
    updateIngredientSchema,
    updateStockSettingSchema,
} from "~/schemas";

const VIEW = checkPermission(InventoryPermissionEnum.VIEW);

/** Quyền lập phiếu theo loại phiếu (đã qua `validate` nên `type` hợp lệ) */
const RECEIPT_PERMISSION: Record<InventoryReceiptTypeEnum, string> = {
    [InventoryReceiptTypeEnum.IMPORT]: InventoryPermissionEnum.IMPORT,
    [InventoryReceiptTypeEnum.EXPORT]: InventoryPermissionEnum.EXPORT,
    [InventoryReceiptTypeEnum.ADJUST]: InventoryPermissionEnum.ADJUST,
};
const checkReceiptPermission = (req: Request, res: Response, next: NextFunction) =>
    checkPermission(RECEIPT_PERMISSION[req.body.type as InventoryReceiptTypeEnum])(req, res, next);

/** Kho theo nhà hàng (đặc tả 4.5): tồn kho, phiếu nhập / xuất / kiểm kê, sổ biến động */
export const inventoryRouter = Router();

inventoryRouter.use(authMiddleware);
inventoryRouter.get("/", VIEW, validate(stockSchema), restrictToRestaurant, inventoryController.getStock);
inventoryRouter.patch(
    "/settings",
    checkPermission(InventoryPermissionEnum.ADJUST),
    validate(updateStockSettingSchema),
    restrictToRestaurant,
    auditRoute("inventory.set_min", "ingredient", { entityId: (r) => r.body.ingredient_id }),
    inventoryController.setMinQuantity,
);
inventoryRouter.get("/receipts", VIEW, validate(listReceiptsSchema), restrictToRestaurant, inventoryController.getReceipts);
inventoryRouter.get("/receipts/:id", VIEW, validate(receiptIdSchema), restrictToRestaurant, inventoryController.getReceiptById);
inventoryRouter.post(
    "/receipts",
    validate(createReceiptSchema),
    checkReceiptPermission,
    restrictToRestaurant,
    inventoryController.createReceipt,
);
inventoryRouter.get(
    "/transactions",
    VIEW,
    validate(listInventoryTransactionsSchema),
    restrictToRestaurant,
    inventoryController.getTransactions,
);

/** Danh mục nguyên liệu dùng chung cả chuỗi */
export const ingredientRouter = Router();

ingredientRouter.use(authMiddleware);
ingredientRouter.get("/", VIEW, inventoryController.getIngredients);
ingredientRouter.post(
    "/",
    checkPermission(IngredientPermissionEnum.CREATE),
    validate(createIngredientSchema),
    auditRoute("ingredient.create", "ingredient"),
    inventoryController.createIngredient,
);
ingredientRouter.patch(
    "/:id",
    checkPermission(IngredientPermissionEnum.UPDATE),
    validate(updateIngredientSchema),
    auditRoute("ingredient.update", "ingredient", { before: AUDIT_BEFORE.ingredient }),
    inventoryController.updateIngredient,
);
ingredientRouter.delete(
    "/:id",
    checkPermission(IngredientPermissionEnum.DELETE),
    validate(ingredientIdSchema),
    auditRoute("ingredient.delete", "ingredient", { before: AUDIT_BEFORE.ingredient, isDelete: true }),
    inventoryController.deleteIngredient,
);
