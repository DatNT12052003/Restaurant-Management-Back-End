import { OrderTypeEnum } from "~/common/enum";
import { db } from "~/config/db";
import { IAuditFacets, IAuditLog, ISelectQuery } from "~/interfaces";
import { buildSelectAllQuery } from "~/utils/query-builder";

/** Danh sách không trả `before` / `after` (có thể lớn); xem ở API chi tiết */
const LIST_FIELDS = [
    "a.id",
    "a.account_id",
    "a.user_id",
    "a.actor_name",
    "a.restaurant_id",
    "(SELECT r.name FROM restaurants r WHERE r.id = a.restaurant_id) AS restaurant_name",
    "a.action",
    "a.entity_type",
    "a.entity_id",
    "a.ip",
    "a.user_agent",
    "a.created_at",
];

const FIELD_MAP: Record<string, string> = {
    action: "a.action",
    entity_type: "a.entity_type",
    entity_id: "a.entity_id",
    user_id: "a.user_id",
    account_id: "a.account_id",
    restaurant_id: "a.restaurant_id",
    actor_name: "a.actor_name",
    ip: "a.ip",
    created_at: "a.created_at",
};

const mapFields = <T extends { field: string }>(list: T[] = []) =>
    list.map((item) => ({ ...item, field: FIELD_MAP[item.field] })).filter((item) => item.field);

export const getAuditLogs = async (params: ISelectQuery): Promise<{ rows: IAuditLog[]; totalCount: number }> => {
    const orderBy = mapFields(params.orderBy);
    const { query, values } = buildSelectAllQuery("audit_logs a", Object.values(FIELD_MAP), {
        ...params,
        search: params.search ? { ...params.search, fields: params.search.fields.map((f) => FIELD_MAP[f]).filter(Boolean) } : undefined,
        filters: mapFields(params.filters),
        orderBy: orderBy.length
            ? orderBy
            : [
                  { field: "a.created_at", direction: OrderTypeEnum.DESC },
                  { field: "a.id", direction: OrderTypeEnum.DESC },
              ],
        returning: LIST_FIELDS,
        noSoftDelete: true,
    });
    const result = await db().query(query, values);
    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
    return { rows: result.rows.map(({ total_count, ...data }) => data), totalCount };
};

export const getAuditLogById = async (id: number): Promise<IAuditLog | undefined> => {
    const result = await db().query(`SELECT ${LIST_FIELDS.join(", ")}, a.before, a.after FROM audit_logs a WHERE a.id = $1`, [id]);
    return result.rows[0];
};

/** Các hành động / loại đối tượng đã xuất hiện (dùng cho bộ lọc) */
export const getFacets = async (restaurantId: number | null): Promise<IAuditFacets> => {
    const result = await db().query(
        `SELECT
            COALESCE(ARRAY(SELECT DISTINCT action FROM audit_logs WHERE ($1::int IS NULL OR restaurant_id = $1::int) ORDER BY 1), '{}') AS actions,
            COALESCE(ARRAY(SELECT DISTINCT entity_type FROM audit_logs WHERE ($1::int IS NULL OR restaurant_id = $1::int) ORDER BY 1), '{}') AS entity_types`,
        [restaurantId],
    );
    return result.rows[0];
};

/**
 * Chuyển tối đa `batch` dòng cũ hơn `months` tháng sang `audit_logs_archive`. Phải gọi trong transaction:
 * trigger chỉ cho DELETE trên `audit_logs` khi transaction bật `app.audit_archive`. Trả về số dòng đã chuyển.
 */
export const archiveOlderThan = async (months: number, batch: number): Promise<number> => {
    await db().query("SET LOCAL app.audit_archive = 'on'");
    const result = await db().query(
        `WITH moved AS (
            DELETE FROM audit_logs
            WHERE id IN (
                SELECT id FROM audit_logs WHERE created_at < NOW() - make_interval(months => $1) ORDER BY id LIMIT $2
            )
            RETURNING *
        )
        INSERT INTO audit_logs_archive SELECT moved.*, NOW() FROM moved
        RETURNING id`,
        [months, batch],
    );
    return result.rowCount ?? 0;
};
