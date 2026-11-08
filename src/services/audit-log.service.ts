import { AUDIT_LOG_ERROR } from "~/common/error-code/report";
import { IAuditFacets, IAuditLog, IGetAuditLogs, ISelectQuery } from "~/interfaces";
import { auditLogRepository } from "~/repositories";
import { buildPagination } from "~/utils/pagination";

type Scope = number | null | undefined;

/** Nhật ký chỉ đọc. Người bị giới hạn nhà hàng chỉ thấy dòng gắn nhà hàng của mình. */
export const getAuditLogs = async (params: ISelectQuery): Promise<IGetAuditLogs | number> => {
    try {
        const result = await auditLogRepository.getAuditLogs(params);
        return { audit_logs: result.rows, pagination: buildPagination(params, result.totalCount) };
    } catch (error) {
        return AUDIT_LOG_ERROR.FAILED;
    }
};

export const getAuditLogById = async (id: number, scope: Scope): Promise<IAuditLog | number> => {
    try {
        const log = await auditLogRepository.getAuditLogById(id);
        if (!log) return AUDIT_LOG_ERROR.NOT_FOUND;
        if (scope !== null && scope !== undefined && log.restaurant_id !== scope) return AUDIT_LOG_ERROR.NOT_FOUND;
        return log;
    } catch (error) {
        return AUDIT_LOG_ERROR.FAILED;
    }
};

export const getFacets = async (restaurantId: number | null): Promise<IAuditFacets | number> => {
    try {
        return await auditLogRepository.getFacets(restaurantId);
    } catch (error) {
        return AUDIT_LOG_ERROR.FAILED;
    }
};
