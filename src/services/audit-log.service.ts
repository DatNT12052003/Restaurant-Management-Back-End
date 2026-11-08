import { AUDIT_RETENTION_MONTHS } from "~/common/constant";
import { AUDIT_LOG_ERROR } from "~/common/error-code/report";
import { withTransaction } from "~/config/db";
import { IAuditFacets, IAuditLog, IGetAuditLogs, ISelectQuery } from "~/interfaces";
import { auditLogRepository } from "~/repositories";
import { AUDIT_ACTION, writeAuditSafe } from "~/utils/audit";
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

const ARCHIVE_BATCH = 5000;

/**
 * Chuyển nhật ký cũ hơn `AUDIT_RETENTION_MONTHS` tháng sang bảng lưu trữ (không xóa). Mỗi lô một transaction để
 * không giữ khóa lâu. Ghi một dòng `audit.archive` cho lần chạy có chuyển dữ liệu.
 */
export const archiveOldAuditLogs = async (months = AUDIT_RETENTION_MONTHS): Promise<number> => {
    let total = 0;
    for (;;) {
        const moved = await withTransaction(() => auditLogRepository.archiveOlderThan(months, ARCHIVE_BATCH));
        total += moved;
        if (moved < ARCHIVE_BATCH) break;
    }
    if (total > 0) {
        await writeAuditSafe(
            {},
            { action: AUDIT_ACTION.AUDIT_ARCHIVE, entity_type: "audit_log", restaurant_id: null, actor_name: "system", after: { moved: total, months } },
        );
    }
    return total;
};
