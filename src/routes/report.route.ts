import { Router } from "express";
import { AuditLogPermissionEnum, ReportPermissionEnum } from "~/common/permission-enum";
import { reportController } from "~/controllers";
import { authMiddleware, checkPermission, restrictToRestaurant, validate } from "~/middlewares";
import { auditFacetsSchema, auditLogIdSchema, listAuditLogsSchema, reportQuerySchema } from "~/schemas";

/** Báo cáo (đặc tả mục 9, 6.3). Manager chỉ xem chi nhánh của mình. */
export const reportRouter = Router();

const VIEW = checkPermission(ReportPermissionEnum.VIEW);
const query = validate(reportQuerySchema);

reportRouter.use(authMiddleware);
reportRouter.get("/overview", VIEW, query, restrictToRestaurant, reportController.getOverview);
reportRouter.get("/revenue", VIEW, query, restrictToRestaurant, reportController.getRevenue);
reportRouter.get("/top-items", VIEW, query, restrictToRestaurant, reportController.getTopItems);
reportRouter.get("/table-occupancy", VIEW, query, restrictToRestaurant, reportController.getTableOccupancy);
reportRouter.get("/inventory", VIEW, query, restrictToRestaurant, reportController.getInventoryReport);

/** Nhật ký hoạt động (đặc tả 4.11): chỉ đọc, không có API sửa / xóa */
export const auditLogRouter = Router();

const AUDIT_VIEW = checkPermission(AuditLogPermissionEnum.VIEW);

auditLogRouter.use(authMiddleware);
auditLogRouter.get("/", AUDIT_VIEW, validate(listAuditLogsSchema), restrictToRestaurant, reportController.getAuditLogs);
auditLogRouter.get("/facets", AUDIT_VIEW, validate(auditFacetsSchema), restrictToRestaurant, reportController.getAuditFacets);
auditLogRouter.get("/:id", AUDIT_VIEW, validate(auditLogIdSchema), restrictToRestaurant, reportController.getAuditLogById);
