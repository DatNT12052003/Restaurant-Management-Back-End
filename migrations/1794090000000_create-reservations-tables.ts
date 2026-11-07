import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/** Trạng thái còn giữ bàn (dùng cho kiểm tra trùng lịch) */
const ACTIVE_STATUSES = "('pending', 'confirmed', 'arrived')";

/**
 * Giai đoạn 3 — đặt bàn (đặc tả 4.6, 8.4).
 *
 * Chống trùng lịch bằng exclusion constraint: `reservation_tables` lưu lại khoảng thời gian (`period`) và cờ
 * `is_active` của reservation cha, rồi cấm hai dòng cùng `table_id` có `period` chồng nhau khi cả hai còn hiệu lực.
 * Hai cột này do trigger đồng bộ từ `reservations`, service không ghi trực tiếp.
 *
 * Thời gian dùng `timestamptz` để so khoảng thời gian không phụ thuộc múi giờ của client.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
    // Cho phép dùng toán tử `=` trên cột integer trong index GiST
    pgm.sql("CREATE EXTENSION IF NOT EXISTS btree_gist");

    pgm.createTable("reservations", {
        id: "id",
        restaurant_id: { type: "integer", notNull: true, references: "restaurants", onDelete: "CASCADE" },
        // Khách có tài khoản (có thể null với khách vãng lai)
        guest_user_id: { type: "integer", references: "users", onDelete: "SET NULL" },
        // Thông tin liên hệ tại thời điểm đặt
        contact_name: { type: "varchar(255)", notNull: true },
        contact_phone: { type: "varchar(20)", notNull: true },
        guest_count: { type: "integer", notNull: true },
        start_time: { type: "timestamptz", notNull: true },
        end_time: { type: "timestamptz", notNull: true },
        status: { type: "varchar(20)", notNull: true, default: "pending" },
        note: { type: "text" },
        cancel_reason: { type: "text" },
        arrived_at: { type: "timestamptz" },
        completed_at: { type: "timestamptz" },
        cancelled_at: { type: "timestamptz" },
        created_by: { type: "integer", references: "users", onDelete: "SET NULL" },
        created_at: { type: "timestamp", notNull: true, default: pgm.func("now()") },
        updated_at: { type: "timestamp", notNull: true, default: pgm.func("now()") },
        deleted_at: { type: "timestamp" },
    });
    pgm.addConstraint("reservations", "reservations_guest_count_check", "CHECK (guest_count > 0)");
    pgm.addConstraint("reservations", "reservations_time_check", "CHECK (end_time > start_time)");
    pgm.addConstraint(
        "reservations",
        "reservations_status_check",
        "CHECK (status IN ('pending', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show'))",
    );
    pgm.createIndex("reservations", ["restaurant_id", "start_time"], { where: "deleted_at IS NULL" });
    pgm.createIndex("reservations", "status");
    pgm.createIndex("reservations", "end_time");
    pgm.createIndex("reservations", "guest_user_id");
    pgm.createIndex("reservations", "created_by");
    pgm.createIndex("reservations", "contact_phone");

    pgm.createTable("reservation_tables", {
        reservation_id: {
            type: "integer",
            notNull: true,
            references: "reservations",
            onDelete: "CASCADE",
            primaryKey: true,
        },
        table_id: { type: "integer", notNull: true, references: "tables", onDelete: "CASCADE", primaryKey: true },
        // Sao chép từ reservations (trigger), chỉ để phục vụ exclusion constraint
        period: { type: "tstzrange", notNull: true },
        is_active: { type: "boolean", notNull: true, default: true },
    });
    pgm.createIndex("reservation_tables", "table_id");
    pgm.sql(`
        ALTER TABLE reservation_tables
        ADD CONSTRAINT reservation_tables_no_overlap
        EXCLUDE USING gist (table_id WITH =, period WITH &&) WHERE (is_active)
    `);

    // Dòng mới của reservation_tables: lấy period / is_active từ reservation cha
    pgm.sql(`
        CREATE FUNCTION reservation_tables_fill() RETURNS trigger AS $$
        BEGIN
            SELECT tstzrange(r.start_time, r.end_time, '[)'),
                   r.status IN ${ACTIVE_STATUSES} AND r.deleted_at IS NULL
            INTO NEW.period, NEW.is_active
            FROM reservations r
            WHERE r.id = NEW.reservation_id;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    `);
    pgm.sql(`
        CREATE TRIGGER reservation_tables_fill
        BEFORE INSERT ON reservation_tables
        FOR EACH ROW EXECUTE FUNCTION reservation_tables_fill()
    `);

    // Đổi giờ / trạng thái / xóa reservation: cập nhật lại các dòng bàn
    pgm.sql(`
        CREATE FUNCTION reservations_sync_tables() RETURNS trigger AS $$
        BEGIN
            UPDATE reservation_tables
            SET period = tstzrange(NEW.start_time, NEW.end_time, '[)'),
                is_active = NEW.status IN ${ACTIVE_STATUSES} AND NEW.deleted_at IS NULL
            WHERE reservation_id = NEW.id;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    `);
    pgm.sql(`
        CREATE TRIGGER reservations_sync_tables
        AFTER UPDATE OF start_time, end_time, status, deleted_at ON reservations
        FOR EACH ROW EXECUTE FUNCTION reservations_sync_tables()
    `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropTable("reservation_tables");
    pgm.dropTable("reservations");
    pgm.sql("DROP FUNCTION IF EXISTS reservation_tables_fill()");
    pgm.sql("DROP FUNCTION IF EXISTS reservations_sync_tables()");
    // Không DROP EXTENSION btree_gist: có thể đang được dùng ở nơi khác
}
