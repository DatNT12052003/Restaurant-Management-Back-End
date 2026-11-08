import { Router } from "express";
import { TablePermissionEnum } from "~/common/permission-enum";
import { tableController } from "~/controllers";
import { auditRoute, authMiddleware, checkPermission, restrictToRestaurant, validate } from "~/middlewares";
import { AUDIT_BEFORE } from "~/utils/audit-loaders";
import { createTableSchema, tableIdSchema, updateTableSchema } from "~/schemas";

const router = Router();

router.use(authMiddleware);

router.get("/all", checkPermission(TablePermissionEnum.VIEW), restrictToRestaurant, tableController.getAllTables);
router.get("/", checkPermission(TablePermissionEnum.VIEW), restrictToRestaurant, tableController.getTables);
router.get(
    "/:id",
    checkPermission(TablePermissionEnum.VIEW),
    validate(tableIdSchema),
    restrictToRestaurant,
    tableController.getTableById,
);
router.post(
    "/",
    checkPermission(TablePermissionEnum.CREATE),
    validate(createTableSchema),
    restrictToRestaurant,
    auditRoute("table.create", "table"),
    tableController.createTable,
);
// Cũng dùng để đổi trạng thái bàn: PATCH /tables/:id { status }
router.patch(
    "/:id",
    checkPermission(TablePermissionEnum.UPDATE),
    validate(updateTableSchema),
    restrictToRestaurant,
    auditRoute("table.update", "table", { before: AUDIT_BEFORE.table }),
    tableController.updateTable,
);
router.delete(
    "/:id",
    checkPermission(TablePermissionEnum.DELETE),
    validate(tableIdSchema),
    restrictToRestaurant,
    auditRoute("table.delete", "table", { before: AUDIT_BEFORE.table, isDelete: true }),
    tableController.deleteTable,
);

export default router;
