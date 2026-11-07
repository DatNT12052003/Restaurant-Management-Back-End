import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Giai đoạn 5 — thanh toán và khuyến mãi (đặc tả 4.8, 4.9, 8.7).
 *
 * - Phí dịch vụ / thuế: tỷ lệ (%) cấu hình ở nhà hàng, chụp lại vào order lúc mở (đổi cấu hình không ảnh hưởng order cũ).
 *   total = (subtotal - discount) + service_fee + tax, với service_fee = net × rate, tax = (net + service_fee) × rate.
 * - Mỗi order tối đa một mã giảm giá (`order_discounts.order_id` UNIQUE).
 * - Một order có nhiều payment; hoàn tiền là một dòng `type = 'refund'` trỏ về payment gốc (`refund_of_payment_id`).
 * - `audit_logs`: bảng nhật ký dùng chung (đặc tả 4.11), dùng trước cho hoàn tiền; giai đoạn 7 mở rộng.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
    // ---- Cấu hình phí / thuế theo nhà hàng ----
    pgm.addColumns("restaurants", {
        service_fee_percent: { type: "numeric(5,2)", notNull: true, default: 0 },
        tax_percent: { type: "numeric(5,2)", notNull: true, default: 0 },
    });
    pgm.addConstraint(
        "restaurants",
        "restaurants_fee_check",
        "CHECK (service_fee_percent BETWEEN 0 AND 100 AND tax_percent BETWEEN 0 AND 100)",
    );

    pgm.addColumns("orders", {
        service_fee_rate: { type: "numeric(5,2)", notNull: true, default: 0 },
        tax_rate: { type: "numeric(5,2)", notNull: true, default: 0 },
        service_fee: { type: "numeric(12,2)", notNull: true, default: 0 },
        tax: { type: "numeric(12,2)", notNull: true, default: 0 },
    });
    pgm.dropConstraint("orders", "orders_money_check");
    pgm.addConstraint(
        "orders",
        "orders_money_check",
        "CHECK (subtotal >= 0 AND discount_amount >= 0 AND service_fee >= 0 AND tax >= 0 AND total >= 0)",
    );

    // ---- Mã giảm giá ----
    pgm.createTable("discounts", {
        id: "id",
        code: { type: "varchar(50)", notNull: true },
        name: { type: "varchar(255)", notNull: true },
        description: { type: "text" },
        // null = áp dụng cho cả chuỗi
        restaurant_id: { type: "integer", references: "restaurants", onDelete: "CASCADE" },
        type: { type: "varchar(10)", notNull: true },
        value: { type: "numeric(12,2)", notNull: true },
        min_order_value: { type: "numeric(12,2)", notNull: true, default: 0 },
        // Chỉ dùng với type = percent; null = không giới hạn
        max_discount: { type: "numeric(12,2)" },
        start_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
        end_at: { type: "timestamptz" },
        usage_limit: { type: "integer" },
        per_user_limit: { type: "integer" },
        used_count: { type: "integer", notNull: true, default: 0 },
        status: { type: "varchar(10)", notNull: true, default: "active" },
        created_by: { type: "integer", references: "users", onDelete: "SET NULL" },
        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
        updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
        deleted_at: { type: "timestamptz" },
    });
    pgm.addConstraint("discounts", "discounts_type_check", "CHECK (type IN ('percent', 'fixed'))");
    pgm.addConstraint("discounts", "discounts_status_check", "CHECK (status IN ('active', 'inactive'))");
    pgm.addConstraint(
        "discounts",
        "discounts_value_check",
        "CHECK (value > 0 AND (type <> 'percent' OR value <= 100) AND min_order_value >= 0 AND (max_discount IS NULL OR max_discount > 0))",
    );
    pgm.addConstraint(
        "discounts",
        "discounts_limit_check",
        "CHECK ((usage_limit IS NULL OR usage_limit > 0) AND (per_user_limit IS NULL OR per_user_limit > 0) AND used_count >= 0)",
    );
    pgm.addConstraint("discounts", "discounts_time_check", "CHECK (end_at IS NULL OR end_at > start_at)");
    // Mã không trùng (không phân biệt hoa thường) giữa các bản ghi chưa xóa
    pgm.sql("CREATE UNIQUE INDEX discounts_code_unique ON discounts (upper(code)) WHERE deleted_at IS NULL");
    pgm.createIndex("discounts", "restaurant_id");
    pgm.createIndex("discounts", ["status", "start_at", "end_at"]);

    pgm.createTable("order_discounts", {
        id: "id",
        order_id: { type: "integer", notNull: true, unique: true, references: "orders", onDelete: "CASCADE" },
        discount_id: { type: "integer", notNull: true, references: "discounts", onDelete: "RESTRICT" },
        amount_applied: { type: "numeric(12,2)", notNull: true, default: 0 },
        applied_by: { type: "integer", references: "users", onDelete: "SET NULL" },
        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
        updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    });
    pgm.addConstraint("order_discounts", "order_discounts_amount_check", "CHECK (amount_applied >= 0)");
    pgm.createIndex("order_discounts", "discount_id");

    // ---- Thanh toán ----
    pgm.createTable("payments", {
        id: "id",
        order_id: { type: "integer", notNull: true, references: "orders", onDelete: "RESTRICT" },
        restaurant_id: { type: "integer", notNull: true, references: "restaurants", onDelete: "RESTRICT" },
        // payment: thu tiền; refund: hoàn tiền cho payment gốc
        type: { type: "varchar(10)", notNull: true, default: "payment" },
        method: { type: "varchar(10)", notNull: true },
        amount: { type: "numeric(12,2)", notNull: true },
        status: { type: "varchar(12)", notNull: true, default: "pending" },
        // Tiền mặt: khách đưa / tiền thối lại
        received_amount: { type: "numeric(12,2)" },
        change_amount: { type: "numeric(12,2)" },
        // Mã giao dịch thẻ / chuyển khoản
        reference: { type: "varchar(100)" },
        note: { type: "text" },
        refund_of_payment_id: { type: "integer", references: "payments", onDelete: "RESTRICT" },
        cashier_id: { type: "integer", references: "users", onDelete: "SET NULL" },
        paid_at: { type: "timestamptz" },
        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
        updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    });
    pgm.addConstraint("payments", "payments_type_check", "CHECK (type IN ('payment', 'refund'))");
    pgm.addConstraint("payments", "payments_method_check", "CHECK (method IN ('cash', 'card', 'transfer'))");
    pgm.addConstraint(
        "payments",
        "payments_status_check",
        "CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'cancelled', 'refunded'))",
    );
    pgm.addConstraint("payments", "payments_amount_check", "CHECK (amount > 0)");
    pgm.addConstraint(
        "payments",
        "payments_refund_check",
        "CHECK ((type = 'refund') = (refund_of_payment_id IS NOT NULL))",
    );
    pgm.createIndex("payments", "order_id");
    pgm.createIndex("payments", ["restaurant_id", "created_at"]);
    pgm.createIndex("payments", "status");
    pgm.createIndex("payments", "refund_of_payment_id");
    pgm.createIndex("payments", "cashier_id");

    // ---- Nhật ký thao tác (đặc tả 4.11) ----
    pgm.createTable("audit_logs", {
        id: { type: "bigserial", primaryKey: true },
        account_id: { type: "integer", references: "accounts", onDelete: "SET NULL" },
        user_id: { type: "integer", references: "users", onDelete: "SET NULL" },
        restaurant_id: { type: "integer", references: "restaurants", onDelete: "SET NULL" },
        action: { type: "varchar(100)", notNull: true },
        entity_type: { type: "varchar(50)", notNull: true },
        entity_id: { type: "integer" },
        before: { type: "jsonb" },
        after: { type: "jsonb" },
        ip: { type: "varchar(64)" },
        user_agent: { type: "text" },
        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    });
    pgm.createIndex("audit_logs", ["entity_type", "entity_id"]);
    pgm.createIndex("audit_logs", "account_id");
    pgm.createIndex("audit_logs", ["restaurant_id", "created_at"]);
    pgm.createIndex("audit_logs", "action");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropTable("audit_logs");
    pgm.dropTable("payments");
    pgm.dropTable("order_discounts");
    pgm.dropTable("discounts");
    pgm.dropConstraint("orders", "orders_money_check");
    pgm.dropColumns("orders", ["service_fee_rate", "tax_rate", "service_fee", "tax"]);
    pgm.addConstraint("orders", "orders_money_check", "CHECK (subtotal >= 0 AND discount_amount >= 0 AND total >= 0)");
    pgm.dropConstraint("restaurants", "restaurants_fee_check");
    pgm.dropColumns("restaurants", ["service_fee_percent", "tax_percent"]);
}
