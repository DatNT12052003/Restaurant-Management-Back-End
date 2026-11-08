import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Giai đoạn 8: khóa tài khoản khi đăng nhập sai nhiều lần, và lưu trữ nhật ký cũ.
 *
 * - `accounts`: đếm số lần sai trong cửa sổ thời gian (`failed_login_count`, `first_failed_at`), thời điểm hết khóa
 *   (`locked_until`), lần đăng nhập gần nhất (`last_login_at`).
 * - `audit_logs_archive`: cùng cột với `audit_logs` (thêm `archived_at`), cũng chỉ cho thêm. Job định kỳ chuyển các
 *   dòng cũ hơn 12 tháng sang đây (câu hỏi 13).
 * - Trigger bảo vệ `audit_logs` cho phép DELETE chỉ khi transaction bật `app.audit_archive = 'on'` (job lưu trữ),
 *   và chỉ trên bảng `audit_logs`; bảng lưu trữ không bao giờ xóa được.
 * - Manager được `account.update` để mở khóa, đăng xuất từ xa, đặt lại mật khẩu cho nhân viên cấp dưới.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
    pgm.addColumns("accounts", {
        failed_login_count: { type: "integer", notNull: true, default: 0 },
        first_failed_at: { type: "timestamptz" },
        locked_until: { type: "timestamptz" },
        last_login_at: { type: "timestamptz" },
    });

    pgm.sql("CREATE TABLE audit_logs_archive (LIKE audit_logs INCLUDING DEFAULTS)");
    pgm.sql("ALTER TABLE audit_logs_archive ADD PRIMARY KEY (id)");
    pgm.addColumn("audit_logs_archive", {
        archived_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    });
    pgm.createIndex("audit_logs_archive", "created_at");
    pgm.createIndex("audit_logs_archive", ["restaurant_id", "created_at"]);
    pgm.createIndex("audit_logs_archive", ["entity_type", "entity_id"]);

    pgm.sql(`
        CREATE OR REPLACE FUNCTION audit_logs_protect() RETURNS trigger AS $$
        BEGIN
            IF TG_OP = 'DELETE' AND TG_TABLE_NAME = 'audit_logs'
                AND current_setting('app.audit_archive', true) = 'on' THEN
                RETURN OLD;
            END IF;
            IF TG_OP = 'UPDATE'
                AND NEW.id = OLD.id
                AND NEW.action = OLD.action
                AND NEW.entity_type = OLD.entity_type
                AND NEW.entity_id IS NOT DISTINCT FROM OLD.entity_id
                AND NEW.before IS NOT DISTINCT FROM OLD.before
                AND NEW.after IS NOT DISTINCT FROM OLD.after
                AND NEW.ip IS NOT DISTINCT FROM OLD.ip
                AND NEW.user_agent IS NOT DISTINCT FROM OLD.user_agent
                AND NEW.actor_name IS NOT DISTINCT FROM OLD.actor_name
                AND NEW.created_at = OLD.created_at
                AND (NEW.account_id IS NOT DISTINCT FROM OLD.account_id OR NEW.account_id IS NULL)
                AND (NEW.user_id IS NOT DISTINCT FROM OLD.user_id OR NEW.user_id IS NULL)
                AND (NEW.restaurant_id IS NOT DISTINCT FROM OLD.restaurant_id OR NEW.restaurant_id IS NULL)
            THEN
                RETURN NEW;
            END IF;
            RAISE EXCEPTION '% is append-only (% not allowed)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
        END;
        $$ LANGUAGE plpgsql;
    `);
    pgm.sql(`
        CREATE TRIGGER audit_logs_archive_protect_row
        BEFORE UPDATE OR DELETE ON audit_logs_archive
        FOR EACH ROW EXECUTE FUNCTION audit_logs_protect();
    `);
    pgm.sql(`
        CREATE TRIGGER audit_logs_archive_protect_truncate
        BEFORE TRUNCATE ON audit_logs_archive
        FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_protect();
    `);

    pgm.sql(`
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id FROM roles r, permissions p
        WHERE r.type_name = 'manager' AND r.deleted_at IS NULL
            AND p.type_name = 'account.update' AND p.deleted_at IS NULL
        ON CONFLICT (role_id, permission_id) DO UPDATE SET deleted_at = NULL, updated_at = NOW()
    `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.sql(`
        DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE type_name = 'manager')
            AND permission_id IN (SELECT id FROM permissions WHERE type_name = 'account.update')
    `);
    pgm.sql("DROP TABLE audit_logs_archive");
    // Trả hàm bảo vệ về bản của giai đoạn 7 (không có ngoại lệ lưu trữ)
    pgm.sql(`
        CREATE OR REPLACE FUNCTION audit_logs_protect() RETURNS trigger AS $$
        BEGIN
            IF TG_OP = 'UPDATE'
                AND NEW.id = OLD.id
                AND NEW.action = OLD.action
                AND NEW.entity_type = OLD.entity_type
                AND NEW.entity_id IS NOT DISTINCT FROM OLD.entity_id
                AND NEW.before IS NOT DISTINCT FROM OLD.before
                AND NEW.after IS NOT DISTINCT FROM OLD.after
                AND NEW.ip IS NOT DISTINCT FROM OLD.ip
                AND NEW.user_agent IS NOT DISTINCT FROM OLD.user_agent
                AND NEW.actor_name IS NOT DISTINCT FROM OLD.actor_name
                AND NEW.created_at = OLD.created_at
                AND (NEW.account_id IS NOT DISTINCT FROM OLD.account_id OR NEW.account_id IS NULL)
                AND (NEW.user_id IS NOT DISTINCT FROM OLD.user_id OR NEW.user_id IS NULL)
                AND (NEW.restaurant_id IS NOT DISTINCT FROM OLD.restaurant_id OR NEW.restaurant_id IS NULL)
            THEN
                RETURN NEW;
            END IF;
            RAISE EXCEPTION 'audit_logs is append-only (% not allowed)', TG_OP USING ERRCODE = 'insufficient_privilege';
        END;
        $$ LANGUAGE plpgsql;
    `);
    pgm.dropColumns("accounts", ["failed_login_count", "first_failed_at", "locked_until", "last_login_at"]);
}
