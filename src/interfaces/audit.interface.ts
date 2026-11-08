import { IPagination } from "./common.interface";

/** Ngữ cảnh ghi audit log: người thao tác, IP, trình duyệt */
export interface IAuditContext {
    accountId?: number | null;
    /** Bỏ trống thì tự tìm theo `accountId` */
    userId?: number | null;
    ip?: string | null;
    userAgent?: string | null;
}

/** Một dòng nhật ký cần ghi */
export interface IAuditEntry {
    action: string;
    entity_type: string;
    entity_id?: number | null;
    restaurant_id?: number | null;
    before?: unknown;
    after?: unknown;
    /** Tên hiển thị khi không xác định được người thao tác (ví dụ đăng nhập sai với username không tồn tại) */
    actor_name?: string | null;
}

export interface IAuditLog {
    id: string;
    account_id: number | null;
    user_id: number | null;
    actor_name: string | null;
    restaurant_id: number | null;
    restaurant_name: string | null;
    action: string;
    entity_type: string;
    entity_id: number | null;
    /** Chỉ có ở API chi tiết */
    before?: unknown;
    after?: unknown;
    ip: string | null;
    user_agent: string | null;
    created_at: Date;
}

export interface IGetAuditLogs {
    audit_logs: IAuditLog[];
    pagination: IPagination;
}

export interface IAuditFacets {
    actions: string[];
    entity_types: string[];
}
