import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

const ITEM_STATUSES = "('pending', 'confirmed', 'cooking', 'ready', 'served', 'cancelled')";

/**
 * Giai đoạn 4 — order và quy trình phục vụ (đặc tả 4.7, 8.5).
 *
 * - `order_tables` giữ cả lịch sử chuyển bàn: dòng đang dùng có `released_at IS NULL`.
 *   Unique index một phần đảm bảo mỗi bàn chỉ thuộc tối đa một order đang mở.
 * - `order_items` / `order_combos` lưu `current_price` tại thời điểm gọi (đặc tả 4.7) và `station`
 *   (kitchen | bar) để chia món cho bếp / quầy pha chế.
 * - Các mốc thời gian dùng `timestamptz` để tính thời gian chờ chính xác.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
    const stamps = {
        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
        updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    };

    pgm.createTable("orders", {
        id: "id",
        // Mã dễ đọc, ví dụ R1-20261108-0012
        code: { type: "varchar(30)", notNull: true, unique: true },
        // Order là dữ liệu tài chính: không cho xóa cứng nhà hàng còn order
        restaurant_id: { type: "integer", notNull: true, references: "restaurants", onDelete: "RESTRICT" },
        reservation_id: { type: "integer", references: "reservations", onDelete: "SET NULL" },
        guest_user_id: { type: "integer", references: "users", onDelete: "SET NULL" },
        guest_count: { type: "integer", notNull: true, default: 1 },
        created_by: { type: "integer", references: "users", onDelete: "SET NULL" },
        assigned_staff_id: { type: "integer", references: "users", onDelete: "SET NULL" },
        status: { type: "varchar(20)", notNull: true, default: "confirmed" },
        subtotal: { type: "numeric(12,2)", notNull: true, default: 0 },
        discount_amount: { type: "numeric(12,2)", notNull: true, default: 0 },
        total: { type: "numeric(12,2)", notNull: true, default: 0 },
        note: { type: "text" },
        cancel_reason: { type: "text" },
        cancelled_by: { type: "integer", references: "users", onDelete: "SET NULL" },
        completed_at: { type: "timestamptz" },
        cancelled_at: { type: "timestamptz" },
        ...stamps,
        deleted_at: { type: "timestamptz" },
    });
    pgm.addConstraint("orders", "orders_guest_count_check", "CHECK (guest_count > 0)");
    pgm.addConstraint(
        "orders",
        "orders_status_check",
        "CHECK (status IN ('pending', 'confirmed', 'serving', 'completed', 'cancelled'))",
    );
    pgm.addConstraint(
        "orders",
        "orders_money_check",
        "CHECK (subtotal >= 0 AND discount_amount >= 0 AND total >= 0)",
    );
    pgm.createIndex("orders", ["restaurant_id", "created_at"], { where: "deleted_at IS NULL" });
    pgm.createIndex("orders", "status");
    // Mỗi reservation tạo tối đa một order
    pgm.createIndex("orders", "reservation_id", {
        name: "orders_reservation_id_unique",
        unique: true,
        where: "reservation_id IS NOT NULL AND deleted_at IS NULL",
    });
    pgm.createIndex("orders", "guest_user_id");
    pgm.createIndex("orders", "created_by");
    pgm.createIndex("orders", "assigned_staff_id");

    pgm.createTable("order_tables", {
        id: "id",
        order_id: { type: "integer", notNull: true, references: "orders", onDelete: "CASCADE" },
        table_id: { type: "integer", notNull: true, references: "tables", onDelete: "CASCADE" },
        assigned_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
        // null = bàn đang thuộc order; có giá trị = đã chuyển đi / order đã đóng
        released_at: { type: "timestamptz" },
    });
    pgm.createIndex("order_tables", "order_id");
    pgm.createIndex("order_tables", "table_id", {
        name: "order_tables_one_open_order_per_table",
        unique: true,
        where: "released_at IS NULL",
    });

    pgm.createTable("order_rounds", {
        id: "id",
        order_id: { type: "integer", notNull: true, references: "orders", onDelete: "CASCADE" },
        table_id: { type: "integer", references: "tables", onDelete: "SET NULL" },
        round_no: { type: "integer", notNull: true },
        note: { type: "text" },
        created_by: { type: "integer", references: "users", onDelete: "SET NULL" },
        sent_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    });
    pgm.addConstraint("order_rounds", "order_rounds_order_round_unique", "UNIQUE (order_id, round_no)");
    pgm.createIndex("order_rounds", "table_id");
    pgm.createIndex("order_rounds", "created_by");

    for (const [table, ref, col] of [
        ["order_items", "dishes", "dish_id"],
        ["order_combos", "combos", "combo_id"],
    ] as const) {
        pgm.createTable(table, {
            id: "id",
            order_id: { type: "integer", notNull: true, references: "orders", onDelete: "CASCADE" },
            round_id: { type: "integer", notNull: true, references: "order_rounds", onDelete: "CASCADE" },
            [col]: { type: "integer", notNull: true, references: ref, onDelete: "RESTRICT" },
            quantity: { type: "integer", notNull: true },
            current_price: { type: "numeric(12,2)", notNull: true },
            note: { type: "text" },
            station: { type: "varchar(10)", notNull: true, default: "kitchen" },
            status: { type: "varchar(20)", notNull: true, default: "pending" },
            confirmed_at: { type: "timestamptz" },
            cooking_at: { type: "timestamptz" },
            ready_at: { type: "timestamptz" },
            served_at: { type: "timestamptz" },
            cancelled_at: { type: "timestamptz" },
            cancel_reason: { type: "text" },
            cancelled_by: { type: "integer", references: "users", onDelete: "SET NULL" },
            ...stamps,
        });
        pgm.addConstraint(table, `${table}_quantity_check`, "CHECK (quantity > 0 AND quantity <= 99)");
        pgm.addConstraint(table, `${table}_price_check`, "CHECK (current_price >= 0)");
        pgm.addConstraint(table, `${table}_station_check`, "CHECK (station IN ('kitchen', 'bar'))");
        pgm.addConstraint(table, `${table}_status_check`, `CHECK (status IN ${ITEM_STATUSES})`);
        pgm.createIndex(table, "order_id");
        pgm.createIndex(table, "round_id");
        pgm.createIndex(table, col);
        pgm.createIndex(table, ["station", "status"]);
    }
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropTable("order_combos");
    pgm.dropTable("order_items");
    pgm.dropTable("order_rounds");
    pgm.dropTable("order_tables");
    pgm.dropTable("orders");
}
