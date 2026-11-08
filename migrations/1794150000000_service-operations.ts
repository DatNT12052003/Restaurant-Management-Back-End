import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Giai đoạn 9: hoàn thiện vận hành phục vụ.
 *
 * - `restaurants.reservation_hold_minutes`: bàn tự chuyển sang `reserved` trước giờ hẹn bao nhiêu phút (0 = tắt).
 *   `restaurants.no_show_after_minutes`: khách trễ quá bao nhiêu phút thì tự đánh dấu `no_show` (0 = tắt). Câu hỏi 8.
 * - `tables.held_reservation_id`: reservation đang giữ bàn (bàn do job tự chuyển sang `reserved`). Job chỉ trả lại
 *   những bàn do chính nó giữ, không đụng tới bàn nhân viên đặt `reserved` bằng tay.
 * - `orders`: trạng thái mới `merged` (đã gộp vào order khác, `merged_into_order_id`). Câu hỏi 3.
 * - `order_combos.items_snapshot`: thành phần combo tại thời điểm gọi món. Dòng cũ được chép từ công thức hiện tại.
 * - `payments.tip_amount`, `tip_staff_id`: tiền tip ghi riêng, không tính vào `amount` / doanh thu. Câu hỏi 5.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
    pgm.addColumns("restaurants", {
        reservation_hold_minutes: { type: "integer", notNull: true, default: 30 },
        no_show_after_minutes: { type: "integer", notNull: true, default: 15 },
    });
    pgm.addConstraint(
        "restaurants",
        "restaurants_reservation_timing_check",
        "CHECK (reservation_hold_minutes BETWEEN 0 AND 240 AND no_show_after_minutes BETWEEN 0 AND 240)",
    );

    pgm.addColumn("tables", {
        held_reservation_id: { type: "integer", references: "reservations", onDelete: "SET NULL" },
    });
    pgm.createIndex("tables", "held_reservation_id", { where: "held_reservation_id IS NOT NULL" });

    pgm.dropConstraint("orders", "orders_status_check");
    pgm.addConstraint(
        "orders",
        "orders_status_check",
        "CHECK (status IN ('pending', 'confirmed', 'serving', 'completed', 'cancelled', 'merged'))",
    );
    pgm.addColumn("orders", {
        merged_into_order_id: { type: "integer", references: "orders", onDelete: "SET NULL" },
    });
    pgm.createIndex("orders", "merged_into_order_id", { where: "merged_into_order_id IS NOT NULL" });

    pgm.addColumn("order_combos", { items_snapshot: { type: "jsonb" } });
    pgm.sql(`
        UPDATE order_combos oc SET items_snapshot = COALESCE((
            SELECT jsonb_agg(jsonb_build_object('dish_id', ci.dish_id, 'name', d.name, 'quantity', ci.quantity)
                ORDER BY d.name)
            FROM combo_items ci JOIN dishes d ON d.id = ci.dish_id
            WHERE ci.combo_id = oc.combo_id
        ), '[]'::jsonb)
    `);

    pgm.addColumns("payments", {
        tip_amount: { type: "numeric(12,2)", notNull: true, default: 0 },
        tip_staff_id: { type: "integer", references: "users", onDelete: "SET NULL" },
    });
    pgm.addConstraint("payments", "payments_tip_check", "CHECK (tip_amount >= 0 AND (tip_amount = 0 OR type = 'payment'))");
    pgm.createIndex("payments", ["tip_staff_id", "paid_at"], { where: "tip_amount > 0" });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropColumns("payments", ["tip_amount", "tip_staff_id"]);
    pgm.dropColumn("order_combos", "items_snapshot");
    pgm.sql("UPDATE orders SET status = 'cancelled' WHERE status = 'merged'");
    pgm.dropColumn("orders", "merged_into_order_id");
    pgm.dropConstraint("orders", "orders_status_check");
    pgm.addConstraint(
        "orders",
        "orders_status_check",
        "CHECK (status IN ('pending', 'confirmed', 'serving', 'completed', 'cancelled'))",
    );
    pgm.dropColumn("tables", "held_reservation_id");
    pgm.dropConstraint("restaurants", "restaurants_reservation_timing_check");
    pgm.dropColumns("restaurants", ["reservation_hold_minutes", "no_show_after_minutes"]);
}
