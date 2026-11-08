import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Giai đoạn 7: audit log và báo cáo.
 *
 * - `audit_logs`: thêm `actor_name` (chụp lại tên người thao tác, vẫn đọc được khi người đó bị xóa) và index
 *   theo thời gian / người thao tác. Trigger chặn UPDATE / DELETE / TRUNCATE (đặc tả 4.11: nhật ký được bảo vệ khỏi
 *   chỉnh sửa). Ngoại lệ duy nhất: khóa ngoại `ON DELETE SET NULL` được phép đưa `account_id` / `user_id` /
 *   `restaurant_id` về NULL khi bản ghi gốc bị xóa cứng.
 * - `restaurants`: giờ mở / đóng cửa, dùng để tính tỷ lệ lấp đầy bàn. Đóng cửa <= mở cửa nghĩa là mở qua đêm.
 * - Index phục vụ báo cáo (doanh thu theo `paid_at`, order theo `completed_at`).
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
    pgm.addColumn("audit_logs", { actor_name: { type: "varchar(255)" } });
    pgm.createIndex("audit_logs", "created_at");
    pgm.createIndex("audit_logs", "user_id");

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
    pgm.sql(`
        CREATE TRIGGER audit_logs_protect_row
        BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION audit_logs_protect();
    `);
    pgm.sql(`
        CREATE TRIGGER audit_logs_protect_truncate
        BEFORE TRUNCATE ON audit_logs
        FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_protect();
    `);

    pgm.addColumns("restaurants", {
        open_time: { type: "time", notNull: true, default: "08:00" },
        close_time: { type: "time", notNull: true, default: "22:00" },
    });

    pgm.createIndex("payments", ["restaurant_id", "paid_at"]);
    pgm.createIndex("orders", ["restaurant_id", "completed_at"]);
    pgm.createIndex("order_tables", ["table_id", "assigned_at"]);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropIndex("order_tables", ["table_id", "assigned_at"]);
    pgm.dropIndex("orders", ["restaurant_id", "completed_at"]);
    pgm.dropIndex("payments", ["restaurant_id", "paid_at"]);
    pgm.dropColumns("restaurants", ["open_time", "close_time"]);
    pgm.sql("DROP TRIGGER IF EXISTS audit_logs_protect_truncate ON audit_logs");
    pgm.sql("DROP TRIGGER IF EXISTS audit_logs_protect_row ON audit_logs");
    pgm.sql("DROP FUNCTION IF EXISTS audit_logs_protect()");
    pgm.dropIndex("audit_logs", "user_id");
    pgm.dropIndex("audit_logs", "created_at");
    pgm.dropColumn("audit_logs", "actor_name");
}
