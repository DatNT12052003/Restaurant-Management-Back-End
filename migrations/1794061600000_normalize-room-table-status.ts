import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Đặc tả mục 8.3: tách trạng thái hoạt động (khóa/mở) khỏi trạng thái sử dụng.
 * - rooms.is_active: thay cho status 'blocked' / 'unblocked'
 * - rooms.status, tables.status: chỉ còn available | reserved | occupied | cleaning
 * - rooms.type: public | private | private_pro
 * - tables.capacity: số ghế; tên bàn là duy nhất trong một phòng
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
    // ---- rooms ----
    pgm.addColumn("rooms", {
        is_active: { type: "boolean", notNull: true, default: true },
    });

    pgm.sql(`UPDATE rooms SET status = lower(trim(status))`);
    pgm.sql(`UPDATE rooms SET is_active = false WHERE status = 'blocked'`);
    pgm.sql(`UPDATE rooms SET status = 'available' WHERE status IN ('blocked', 'unblocked')`);
    // "Private Pro", "private-pro" ... -> private_pro
    pgm.sql(`UPDATE rooms SET type = lower(regexp_replace(trim(type), '[[:space:]-]+', '_', 'g'))`);

    pgm.addConstraint("rooms", "rooms_type_check", "CHECK (type IN ('public', 'private', 'private_pro'))");
    pgm.addConstraint(
        "rooms",
        "rooms_status_check",
        "CHECK (status IN ('available', 'reserved', 'occupied', 'cleaning'))",
    );
    pgm.createIndex("rooms", "is_active");

    // ---- tables ----
    pgm.addColumn("tables", {
        capacity: { type: "integer", notNull: true, default: 4 },
    });
    pgm.sql(`UPDATE tables SET status = lower(trim(status))`);

    pgm.addConstraint("tables", "tables_capacity_check", "CHECK (capacity > 0)");
    pgm.addConstraint(
        "tables",
        "tables_status_check",
        "CHECK (status IN ('available', 'reserved', 'occupied', 'cleaning'))",
    );
    pgm.createIndex("tables", ["room_id", "name"], {
        name: "tables_room_id_name_unique",
        unique: true,
        where: "deleted_at IS NULL",
    });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropIndex("tables", ["room_id", "name"], { name: "tables_room_id_name_unique" });
    pgm.dropConstraint("tables", "tables_status_check");
    pgm.dropConstraint("tables", "tables_capacity_check");
    pgm.dropColumn("tables", "capacity");

    pgm.dropIndex("rooms", "is_active");
    pgm.dropConstraint("rooms", "rooms_status_check");
    pgm.dropConstraint("rooms", "rooms_type_check");
    pgm.sql(`UPDATE rooms SET status = 'blocked' WHERE is_active = false`);
    pgm.dropColumn("rooms", "is_active");
}
