import { Request, Response } from "express";
import { FilterOperatorEnum } from "~/common/enum";
import { AUDIT_LOG_ERROR } from "~/common/error-code/report";
import { badRequestResponse, createErrorResponse, notFoundResponse, serverErrorResponse } from "~/common/responses/error";
import { getSuccessResponse } from "~/common/responses/success";
import { IGetQuery, IReportRange, ReportGroupBy, RevenueBasis } from "~/interfaces";
import { withRestaurantScope } from "~/middlewares/restaurantScope.middleware";
import { listAuditLogsSchema, MAX_REPORT_DAYS, reportQuerySchema } from "~/schemas";
import { auditLogService, reportService } from "~/services";
import { buildListParams } from "~/utils/pagination";

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 30;

/** Hôm nay theo giờ Việt Nam, dạng "YYYY-MM-DD" */
const todayVN = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * Đọc khoảng báo cáo từ query (đã qua `validate`). Mặc định 30 ngày gần nhất.
 * Phạm vi nhà hàng: admin chọn `restaurant_id` (bỏ trống = cả chuỗi), người khác luôn là nhà hàng của mình.
 */
const readRange = (req: Request) => {
    const q = reportQuerySchema.shape.query.parse(req.query);
    const to = q.to ?? (q.from ? shift(q.from, DEFAULT_DAYS - 1) : todayVN());
    const from = q.from ?? shift(to, -(DEFAULT_DAYS - 1));
    const span = (Date.parse(to) - Date.parse(from)) / DAY_MS;
    const range: IReportRange = { from, to, restaurantId: req.restaurantScope ?? q.restaurant_id ?? null };
    return {
        range,
        valid: span >= 0 && span < MAX_REPORT_DAYS,
        groupBy: (q.group_by ?? "day") as ReportGroupBy,
        limit: q.limit ?? 10,
        category: q.category ?? null,
        basis: (q.basis ?? "paid") as RevenueBasis,
    };
};

const respond = async (req: Request, res: Response, run: () => Promise<unknown>) => {
    try {
        const result = await run();
        if (typeof result === "number") return createErrorResponse(res, req.t("report:get_failed"));
        return getSuccessResponse(res, req.t("report:get_successfully"), result);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

const withRange =
    (run: (ctx: ReturnType<typeof readRange>) => Promise<unknown>) =>
    (req: Request, res: Response) => {
        const ctx = readRange(req);
        if (!ctx.valid) return badRequestResponse(res, req.t("validation:report.range.invalid"));
        return respond(req, res, () => run(ctx));
    };

export const getOverview = withRange(({ range }) => reportService.getOverview(range));
export const getRevenue = withRange(({ range, groupBy, basis }) => reportService.getRevenue(range, groupBy, basis));
export const getProfitReport = withRange(({ range, groupBy, limit }) => reportService.getProfitReport(range, groupBy, limit));
export const getVarianceReport = withRange(({ range }) => reportService.getVarianceReport(range));
export const getTopItems = withRange(({ range, limit, category }) => reportService.getTopItems(range, limit, category));
export const getTableOccupancy = withRange(({ range }) => reportService.getTableOccupancy(range));
export const getTipsReport = withRange(({ range, groupBy }) => reportService.getTipsReport(range, groupBy));
export const getInventoryReport = withRange(({ range, groupBy, limit }) => reportService.getInventoryReport(range, groupBy, limit));

// ---------------------------------------------------------------------------
// Nhật ký hoạt động
// ---------------------------------------------------------------------------

/** Danh sách nhật ký (mới nhất trước). Express 5 parse lại `req.query` mỗi lần đọc -> parse lại bằng schema. */
export const getAuditLogs = async (req: Request, res: Response) => {
    try {
        const query = req.query as IGetQuery;
        const extra = listAuditLogsSchema.shape.query.parse(req.query);
        const filters = withRestaurantScope(query.filters, "restaurant_id", req.restaurantScope ?? extra.restaurant_id);
        if (extra.action) filters.push({ field: "action", value: extra.action });
        if (extra.module) filters.push({ field: "action", operator: FilterOperatorEnum.ILIKE, value: `${extra.module}.` });
        if (extra.entity_type) filters.push({ field: "entity_type", value: extra.entity_type });
        if (extra.entity_id) filters.push({ field: "entity_id", value: extra.entity_id });
        if (extra.user_id) filters.push({ field: "user_id", value: extra.user_id });
        if (extra.from) filters.push({ field: "created_at", operator: FilterOperatorEnum.GREATER_THAN, value: extra.from });
        if (extra.to) filters.push({ field: "created_at", operator: FilterOperatorEnum.LESS_THAN, value: extra.to });
        const params = buildListParams({ ...query, filters });
        const result = await auditLogService.getAuditLogs(params);
        if (typeof result === "number") return createErrorResponse(res, req.t("audit_log:get_failed"));
        return getSuccessResponse(res, req.t("audit_log:get_successfully"), result);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const getAuditLogById = async (req: Request, res: Response) => {
    try {
        const result = await auditLogService.getAuditLogById(Number(req.params.id), req.restaurantScope);
        if (result === AUDIT_LOG_ERROR.NOT_FOUND) return notFoundResponse(res, req.t("audit_log:not_found"));
        if (typeof result === "number") return createErrorResponse(res, req.t("audit_log:get_failed"));
        return getSuccessResponse(res, req.t("audit_log:get_successfully"), result);
    } catch (error) {
        return serverErrorResponse(res);
    }
};

export const getAuditFacets = async (req: Request, res: Response) => {
    try {
        const restaurantId = req.restaurantScope ?? (req.query.restaurant_id ? Number(req.query.restaurant_id) : null);
        const result = await auditLogService.getFacets(restaurantId);
        if (typeof result === "number") return createErrorResponse(res, req.t("audit_log:get_failed"));
        return getSuccessResponse(res, req.t("audit_log:get_successfully"), result);
    } catch (error) {
        return serverErrorResponse(res);
    }
};
