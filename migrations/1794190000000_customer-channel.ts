import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Giai đoạn 13: kênh khách hàng (câu hỏi 7 và 11 đã chốt).
 *
 * - Nhà hàng: số điện thoại, cấu hình đặt bàn online (bật / tắt, thời lượng, đặt trước tối thiểu / tối đa, số khách tối đa)
 *   và bật / tắt gọi món QR.
 * - Đặt bàn online: khách nhập email nhận OTP (`booking_verifications`), đơn ở trạng thái chờ, lễ tân xác nhận.
 *   `reservations.source` = staff | online, `lookup_code` để khách tra cứu / hủy, `contact_email`.
 * - Gọi món QR: mỗi bàn một `qr_token` (đổi được). Khách gửi `order_requests`, nhân viên duyệt mới thành đợt gọi món.
 * - Điểm thưởng: `loyalty_settings` (một dòng, chung cả chuỗi), `users.loyalty_points`, sổ `loyalty_transactions`.
 *   Order lưu số điểm đổi (`points_redeemed`, tiền giảm `points_discount`, nằm trong `discount_amount`) và điểm đã cộng.
 * - Phản hồi sau bữa ăn: `order_feedbacks` (mỗi order một phản hồi), quản lý trả lời.
 */
const PERMISSIONS: [string, string][] = [
    ["order_request.handle", "Duyệt món khách gọi qua mã QR tại bàn"],
    ["feedback.view", "Xem phản hồi, đánh giá của khách"],
    ["feedback.reply", "Trả lời và xử lý phản hồi, khiếu nại"],
    ["loyalty.view", "Tra cứu khách và điểm thưởng"],
    ["loyalty.manage", "Cấu hình điểm thưởng, điều chỉnh điểm"],
];
const ALL = PERMISSIONS.map(([p]) => p);
const ROLE_PERMISSIONS: Record<string, string[]> = {
    admin: ALL,
    manager: ALL,
    supervisor: ["order_request.handle", "feedback.view", "feedback.reply", "loyalty.view"],
    cashier: ["order_request.handle", "loyalty.view", "feedback.view"],
    receptionist: ["loyalty.view", "feedback.view"],
    waitstaff: ["order_request.handle"],
};

const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export async function up(pgm: MigrationBuilder): Promise<void> {
    const stamps = {
        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
        updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    };

    // ---- Nhà hàng ----
    pgm.addColumns("restaurants", {
        phone: { type: "varchar(30)" },
        online_booking_enabled: { type: "boolean", notNull: true, default: true },
        /** Thời lượng mặc định của một lượt đặt online */
        online_booking_minutes: { type: "integer", notNull: true, default: 120 },
        /** Phải đặt trước giờ đến ít nhất bao nhiêu phút */
        online_booking_lead_minutes: { type: "integer", notNull: true, default: 60 },
        /** Đặt trước tối đa bao nhiêu ngày */
        online_booking_max_days: { type: "integer", notNull: true, default: 30 },
        online_booking_max_guests: { type: "integer", notNull: true, default: 20 },
        qr_ordering_enabled: { type: "boolean", notNull: true, default: true },
    });
    pgm.addConstraint(
        "restaurants",
        "restaurants_online_booking_check",
        `CHECK (online_booking_minutes BETWEEN 30 AND 720 AND online_booking_lead_minutes BETWEEN 0 AND 10080
            AND online_booking_max_days BETWEEN 1 AND 365 AND online_booking_max_guests BETWEEN 1 AND 500)`,
    );

    // ---- Đặt bàn online ----
    pgm.addColumns("reservations", {
        source: { type: "varchar(10)", notNull: true, default: "staff" },
        contact_email: { type: "varchar(255)" },
        /** Mã tra cứu cho khách (chỉ đơn online) */
        lookup_code: { type: "varchar(12)" },
    });
    pgm.addConstraint("reservations", "reservations_source_check", "CHECK (source IN ('staff', 'online'))");
    pgm.sql("CREATE UNIQUE INDEX reservations_lookup_code_unique ON reservations (lookup_code) WHERE lookup_code IS NOT NULL");
    pgm.createIndex("reservations", "source");

    pgm.createTable("booking_verifications", {
        id: "id",
        email: { type: "varchar(255)", notNull: true },
        hash_code: { type: "varchar(255)", notNull: true },
        expires_at: { type: "timestamptz", notNull: true },
        attempts: { type: "integer", notNull: true, default: 0 },
        used_at: { type: "timestamptz" },
        ip: { type: "varchar(64)" },
        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    });
    pgm.sql("CREATE INDEX booking_verifications_email_idx ON booking_verifications (lower(email), created_at)");

    // ---- Gọi món QR ----
    pgm.addColumns("tables", {
        qr_token: { type: "varchar(32)", notNull: true, default: pgm.func("substr(md5(random()::text || clock_timestamp()::text), 1, 24)") },
    });
    pgm.addConstraint("tables", "tables_qr_token_unique", "UNIQUE (qr_token)");

    pgm.createTable("order_requests", {
        id: "id",
        restaurant_id: { type: "integer", notNull: true, references: "restaurants", onDelete: "CASCADE" },
        table_id: { type: "integer", notNull: true, references: "tables", onDelete: "CASCADE" },
        /** Order nhận các món khi được duyệt */
        order_id: { type: "integer", references: "orders", onDelete: "SET NULL" },
        round_id: { type: "integer", references: "order_rounds", onDelete: "SET NULL" },
        /** Khách đã đăng nhập (nếu có) */
        guest_user_id: { type: "integer", references: "users", onDelete: "SET NULL" },
        /** Mã ngẫu nhiên lưu ở trình duyệt của khách để xem trạng thái yêu cầu của mình */
        client_token: { type: "varchar(64)", notNull: true },
        guest_count: { type: "integer" },
        /** { dishes: [{ dish_id, quantity, note }], combos: [{ combo_id, quantity, note }] } */
        items: { type: "jsonb", notNull: true },
        note: { type: "text" },
        status: { type: "varchar(10)", notNull: true, default: "pending" },
        reject_reason: { type: "text" },
        decided_by: { type: "integer", references: "users", onDelete: "SET NULL" },
        decided_at: { type: "timestamptz" },
        ip: { type: "varchar(64)" },
        ...stamps,
    });
    pgm.addConstraint(
        "order_requests",
        "order_requests_check",
        "CHECK (status IN ('pending', 'accepted', 'rejected') AND (guest_count IS NULL OR guest_count BETWEEN 1 AND 100))",
    );
    pgm.createIndex("order_requests", ["restaurant_id", "status"]);
    pgm.createIndex("order_requests", ["table_id", "status"]);
    pgm.createIndex("order_requests", "client_token");
    pgm.createIndex("order_requests", "order_id");
    pgm.createIndex("order_requests", "round_id");
    pgm.createIndex("order_requests", "guest_user_id");
    pgm.createIndex("order_requests", "decided_by");

    // ---- Điểm thưởng ----
    pgm.createTable("loyalty_settings", {
        id: { type: "integer", primaryKey: true, default: 1 },
        enabled: { type: "boolean", notNull: true, default: true },
        /** Mỗi `earn_amount` đồng thực trả được 1 điểm */
        earn_amount: { type: "integer", notNull: true, default: 10000 },
        /** Giá trị 1 điểm khi đổi (đồng) */
        point_value: { type: "integer", notNull: true, default: 1000 },
        /** Đổi điểm tối đa bao nhiêu % số tiền (sau mã giảm giá) */
        max_redeem_percent: { type: "integer", notNull: true, default: 50 },
        /** Số order hoàn tất trong `regular_window_months` tháng để thành khách thân thiết */
        regular_visit_count: { type: "integer", notNull: true, default: 5 },
        regular_window_months: { type: "integer", notNull: true, default: 12 },
        updated_by: { type: "integer", references: "users", onDelete: "SET NULL" },
        updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    });
    pgm.addConstraint(
        "loyalty_settings",
        "loyalty_settings_check",
        `CHECK (id = 1 AND earn_amount BETWEEN 1000 AND 10000000 AND point_value BETWEEN 1 AND 10000000
            AND max_redeem_percent BETWEEN 0 AND 100 AND regular_visit_count BETWEEN 1 AND 1000 AND regular_window_months BETWEEN 1 AND 120)`,
    );
    pgm.sql("INSERT INTO loyalty_settings (id) VALUES (1)");

    pgm.addColumns("users", { loyalty_points: { type: "integer", notNull: true, default: 0 } });
    pgm.addConstraint("users", "users_loyalty_points_check", "CHECK (loyalty_points >= 0)");

    pgm.addColumns("orders", {
        points_redeemed: { type: "integer", notNull: true, default: 0 },
        points_discount: { type: "numeric(12,2)", notNull: true, default: 0 },
        /** Điểm đã cộng khi order hoàn tất (trừ dần nếu hoàn tiền) */
        points_awarded: { type: "integer", notNull: true, default: 0 },
    });
    pgm.addConstraint("orders", "orders_points_check", "CHECK (points_redeemed >= 0 AND points_discount >= 0 AND points_awarded >= 0)");

    pgm.createTable("loyalty_transactions", {
        id: "id",
        user_id: { type: "integer", notNull: true, references: "users", onDelete: "CASCADE" },
        order_id: { type: "integer", references: "orders", onDelete: "SET NULL" },
        /** earn = cộng khi order hoàn tất; redeem = đổi điểm; revoke = trừ lại khi hoàn tiền; adjust = điều chỉnh tay */
        type: { type: "varchar(10)", notNull: true },
        points: { type: "integer", notNull: true },
        balance_after: { type: "integer", notNull: true },
        note: { type: "text" },
        created_by: { type: "integer", references: "users", onDelete: "SET NULL" },
        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    });
    pgm.addConstraint("loyalty_transactions", "loyalty_transactions_check", "CHECK (type IN ('earn', 'redeem', 'revoke', 'adjust') AND points <> 0)");
    pgm.createIndex("loyalty_transactions", ["user_id", "created_at"]);
    pgm.createIndex("loyalty_transactions", "order_id");
    pgm.createIndex("loyalty_transactions", "created_by");

    // ---- Phản hồi ----
    pgm.createTable("order_feedbacks", {
        id: "id",
        order_id: { type: "integer", notNull: true, unique: true, references: "orders", onDelete: "CASCADE" },
        restaurant_id: { type: "integer", notNull: true, references: "restaurants", onDelete: "CASCADE" },
        guest_user_id: { type: "integer", references: "users", onDelete: "SET NULL" },
        food_rating: { type: "integer", notNull: true },
        service_rating: { type: "integer", notNull: true },
        ambience_rating: { type: "integer", notNull: true },
        comment: { type: "text" },
        is_complaint: { type: "boolean", notNull: true, default: false },
        contact_phone: { type: "varchar(20)" },
        /** new = chưa xử lý; in_progress = đang xử lý; resolved = đã xử lý */
        status: { type: "varchar(12)", notNull: true, default: "new" },
        reply: { type: "text" },
        replied_by: { type: "integer", references: "users", onDelete: "SET NULL" },
        replied_at: { type: "timestamptz" },
        ...stamps,
    });
    pgm.addConstraint(
        "order_feedbacks",
        "order_feedbacks_check",
        `CHECK (food_rating BETWEEN 1 AND 5 AND service_rating BETWEEN 1 AND 5 AND ambience_rating BETWEEN 1 AND 5
            AND status IN ('new', 'in_progress', 'resolved'))`,
    );
    pgm.createIndex("order_feedbacks", ["restaurant_id", "created_at"]);
    pgm.createIndex("order_feedbacks", "status");
    pgm.createIndex("order_feedbacks", "guest_user_id");
    pgm.createIndex("order_feedbacks", "replied_by");

    // ---- Quyền ----
    pgm.sql(`
        INSERT INTO permissions (name, type_name)
        SELECT v.name, v.type_name
        FROM (VALUES ${PERMISSIONS.map(([p, n]) => `(${lit(n)}, ${lit(p)})`).join(", ")}) AS v(name, type_name)
        WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.type_name = v.type_name AND p.deleted_at IS NULL)
    `);
    const matrix = Object.entries(ROLE_PERMISSIONS)
        .flatMap(([role, perms]) => perms.map((p) => `(${lit(role)}, ${lit(p)})`))
        .join(", ");
    pgm.sql(`
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM (VALUES ${matrix}) AS m(role_type, permission_type)
        JOIN roles r ON r.type_name = m.role_type AND r.deleted_at IS NULL
        JOIN permissions p ON p.type_name = m.permission_type AND p.deleted_at IS NULL
        WHERE NOT EXISTS (
            SELECT 1 FROM role_permissions rp
            WHERE rp.role_id = r.id AND rp.permission_id = p.id AND rp.deleted_at IS NULL
        )
    `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    const list = ALL.map(lit).join(", ");
    pgm.sql(`DELETE FROM user_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE type_name IN (${list}))`);
    pgm.sql(`DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE type_name IN (${list}))`);
    pgm.sql(`DELETE FROM permissions WHERE type_name IN (${list})`);

    pgm.dropTable("order_feedbacks");
    pgm.dropTable("loyalty_transactions");
    pgm.dropConstraint("orders", "orders_points_check");
    pgm.dropColumns("orders", ["points_redeemed", "points_discount", "points_awarded"]);
    pgm.dropConstraint("users", "users_loyalty_points_check");
    pgm.dropColumns("users", ["loyalty_points"]);
    pgm.dropTable("loyalty_settings");
    pgm.dropTable("order_requests");
    pgm.dropConstraint("tables", "tables_qr_token_unique");
    pgm.dropColumns("tables", ["qr_token"]);
    pgm.dropTable("booking_verifications");
    pgm.dropIndex("reservations", "source");
    pgm.sql("DROP INDEX IF EXISTS reservations_lookup_code_unique");
    pgm.dropConstraint("reservations", "reservations_source_check");
    pgm.dropColumns("reservations", ["source", "contact_email", "lookup_code"]);
    pgm.dropConstraint("restaurants", "restaurants_online_booking_check");
    pgm.dropColumns("restaurants", [
        "phone",
        "online_booking_enabled",
        "online_booking_minutes",
        "online_booking_lead_minutes",
        "online_booking_max_days",
        "online_booking_max_guests",
        "qr_ordering_enabled",
    ]);
}
