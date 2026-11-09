import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Giai đoạn 14: tích hợp thanh toán, hóa đơn điện tử, hiệu năng báo cáo (câu hỏi 12 và 14 đã chốt).
 *
 * - Chuyển khoản VietQR + webhook SePay: nhà hàng khai báo tài khoản nhận (`bank_bin`, `bank_account_no`,
 *   `bank_account_name`) và bật `transfer_qr_enabled`. Payment QR là `transfer` ở trạng thái `processing`, có mã đối
 *   soát `gateway_ref` (nằm trong nội dung chuyển khoản) và hạn `expires_at`. Mỗi biến động số dư SePay báo về được lưu
 *   vào `gateway_transactions` (duy nhất theo provider + mã giao dịch, nên webhook gửi lại không bị cộng hai lần).
 * - Hóa đơn điện tử: `e_invoices` (một hóa đơn còn hiệu lực mỗi order), chụp lại người mua và các dòng lúc phát hành.
 *   Nhà hàng có thông tin người bán (`legal_name`, `tax_code`, `einvoice_series`) và cờ tự phát hành khi order hoàn tất.
 * - Báo cáo: `report_daily_payments` tổng hợp tiền thu / hoàn theo ngày, nhà hàng, phương thức cho các ngày đã qua.
 *   `report_summary_state.payments_through` là ngày cuối đã tổng hợp; trigger trên `payments` lùi mốc này khi có thay
 *   đổi rơi vào ngày đã tổng hợp, nên báo cáo luôn đúng (phần chưa tổng hợp đọc thẳng từ `payments`).
 * - `audit_logs` phân vùng theo tháng (`audit_logs_pYYYYMM`, cộng phân vùng `audit_logs_default`).
 *   `audit_logs_ensure_partitions(n)` tạo trước phân vùng cho n tháng tới, kèm trigger chặn TRUNCATE trên từng phân vùng.
 */
const PERMISSIONS: [string, string][] = [
    ["payment.reconcile", "Đối soát giao dịch chuyển khoản ngân hàng"],
    ["einvoice.view", "Xem hóa đơn điện tử"],
    ["einvoice.issue", "Phát hành hóa đơn điện tử"],
    ["einvoice.cancel", "Hủy hóa đơn điện tử"],
];
const ALL = PERMISSIONS.map(([p]) => p);
const ROLE_PERMISSIONS: Record<string, string[]> = {
    admin: ALL,
    manager: ALL,
    supervisor: ["payment.reconcile", "einvoice.view", "einvoice.issue"],
    cashier: ["payment.reconcile", "einvoice.view", "einvoice.issue"],
};

const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/** Hàm bảo vệ nhật ký: như GĐ8, nhưng phân vùng có tên riêng nên chỉ chặn DELETE trên bảng lưu trữ */
const PROTECT_FN = (deleteCheck: string) => `
    CREATE OR REPLACE FUNCTION audit_logs_protect() RETURNS trigger AS $$
    BEGIN
        IF TG_OP = 'DELETE' AND ${deleteCheck}
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
`;

export async function up(pgm: MigrationBuilder): Promise<void> {
    const stamps = {
        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
        updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    };

    // ---- Nhà hàng: tài khoản nhận chuyển khoản, thông tin người bán trên hóa đơn ----
    pgm.addColumns("restaurants", {
        /** Mã BIN ngân hàng theo NAPAS (6 số), ví dụ 970436 = Vietcombank */
        bank_bin: { type: "varchar(6)" },
        bank_account_no: { type: "varchar(30)" },
        bank_account_name: { type: "varchar(100)" },
        transfer_qr_enabled: { type: "boolean", notNull: true, default: false },
        legal_name: { type: "varchar(255)" },
        tax_code: { type: "varchar(20)" },
        /** Ký hiệu hóa đơn, ví dụ 1C26TAA */
        einvoice_series: { type: "varchar(20)" },
        einvoice_auto_issue: { type: "boolean", notNull: true, default: false },
    });
    pgm.addConstraint(
        "restaurants",
        "restaurants_bank_check",
        `CHECK (bank_bin IS NULL OR bank_bin ~ '^[0-9]{6}$')`,
    );
    pgm.createIndex("restaurants", "bank_account_no");

    // ---- Payment QR ----
    pgm.addColumns("payments", {
        /** Cổng xác nhận tự động (sepay); null = thu tay */
        provider: { type: "varchar(20)" },
        /** Mã đối soát trong nội dung chuyển khoản */
        gateway_ref: { type: "varchar(40)" },
        /** Tài khoản nhận lúc tạo QR (đổi cấu hình không làm sai QR đã phát) */
        gateway_data: { type: "jsonb" },
        expires_at: { type: "timestamptz" },
    });
    pgm.sql("CREATE UNIQUE INDEX payments_gateway_ref_unique ON payments (gateway_ref) WHERE gateway_ref IS NOT NULL");
    pgm.sql("CREATE INDEX payments_processing_expiry ON payments (expires_at) WHERE status = 'processing'");

    pgm.createTable("gateway_transactions", {
        id: "id",
        provider: { type: "varchar(20)", notNull: true },
        /** Mã giao dịch phía cổng (SePay `id`) */
        provider_txn_id: { type: "varchar(100)", notNull: true },
        restaurant_id: { type: "integer", references: "restaurants", onDelete: "SET NULL" },
        payment_id: { type: "integer", references: "payments", onDelete: "SET NULL" },
        /** Order được ghi nhận khi đối soát tay */
        order_id: { type: "integer", references: "orders", onDelete: "SET NULL" },
        account_number: { type: "varchar(30)" },
        amount: { type: "numeric(14,2)", notNull: true },
        content: { type: "text" },
        /** Mã tham chiếu của ngân hàng */
        bank_reference: { type: "varchar(100)" },
        /** Mã đối soát đọc được từ nội dung */
        matched_ref: { type: "varchar(40)" },
        transaction_at: { type: "timestamptz" },
        /**
         * matched: đã ghi nhận vào payment; unmatched: chưa biết của order nào (hoặc payment đã hết hạn / đã thu);
         * mismatch: đúng mã nhưng sai số tiền; ignored: bỏ qua (tiền ra, hoặc nhân viên đánh dấu)
         */
        status: { type: "varchar(12)", notNull: true },
        note: { type: "text" },
        raw: { type: "jsonb" },
        resolved_by: { type: "integer", references: "users", onDelete: "SET NULL" },
        resolved_at: { type: "timestamptz" },
        ...stamps,
    });
    pgm.addConstraint(
        "gateway_transactions",
        "gateway_transactions_status_check",
        "CHECK (status IN ('matched', 'unmatched', 'mismatch', 'ignored'))",
    );
    pgm.addConstraint("gateway_transactions", "gateway_transactions_unique", "UNIQUE (provider, provider_txn_id)");
    pgm.createIndex("gateway_transactions", ["restaurant_id", "created_at"]);
    pgm.createIndex("gateway_transactions", "status");
    pgm.createIndex("gateway_transactions", "payment_id");
    pgm.createIndex("gateway_transactions", "order_id");
    pgm.createIndex("gateway_transactions", "resolved_by");

    // ---- Hóa đơn điện tử ----
    pgm.createTable("e_invoices", {
        id: "id",
        order_id: { type: "integer", notNull: true, references: "orders", onDelete: "RESTRICT" },
        restaurant_id: { type: "integer", notNull: true, references: "restaurants", onDelete: "RESTRICT" },
        provider: { type: "varchar(20)", notNull: true },
        /** pending: chờ gửi; issued: đã cấp số; failed: gửi lỗi (sẽ thử lại); cancelled: đã hủy */
        status: { type: "varchar(10)", notNull: true, default: "pending" },
        /** auto: tự phát hành khi order hoàn tất; manual: thu ngân phát hành theo yêu cầu */
        source: { type: "varchar(10)", notNull: true, default: "manual" },
        buyer_type: { type: "varchar(10)", notNull: true, default: "individual" },
        buyer_name: { type: "varchar(255)" },
        buyer_company: { type: "varchar(255)" },
        buyer_tax_code: { type: "varchar(20)" },
        buyer_address: { type: "text" },
        buyer_email: { type: "varchar(255)" },
        buyer_phone: { type: "varchar(30)" },
        seller: { type: "jsonb", notNull: true },
        lines: { type: "jsonb", notNull: true },
        /** Tiền trước thuế (sau giảm giá, gồm phí dịch vụ), thuế, tổng thanh toán */
        amount_before_tax: { type: "numeric(14,2)", notNull: true },
        tax_rate: { type: "numeric(5,2)", notNull: true, default: 0 },
        tax_amount: { type: "numeric(14,2)", notNull: true, default: 0 },
        total: { type: "numeric(14,2)", notNull: true },
        series: { type: "varchar(20)" },
        invoice_no: { type: "varchar(30)" },
        lookup_code: { type: "varchar(60)" },
        lookup_url: { type: "text" },
        provider_ref: { type: "varchar(100)" },
        issued_at: { type: "timestamptz" },
        attempts: { type: "integer", notNull: true, default: 0 },
        next_retry_at: { type: "timestamptz" },
        error_message: { type: "text" },
        cancelled_at: { type: "timestamptz" },
        cancelled_by: { type: "integer", references: "users", onDelete: "SET NULL" },
        cancel_reason: { type: "text" },
        created_by: { type: "integer", references: "users", onDelete: "SET NULL" },
        ...stamps,
    });
    pgm.addConstraint(
        "e_invoices",
        "e_invoices_check",
        `CHECK (status IN ('pending', 'issued', 'failed', 'cancelled') AND source IN ('auto', 'manual')
            AND buyer_type IN ('individual', 'company') AND attempts >= 0)`,
    );
    // Mỗi order tối đa một hóa đơn còn hiệu lực (hủy rồi mới phát hành lại)
    pgm.sql("CREATE UNIQUE INDEX e_invoices_order_active ON e_invoices (order_id) WHERE status <> 'cancelled'");
    pgm.createIndex("e_invoices", ["restaurant_id", "created_at"]);
    pgm.createIndex("e_invoices", ["status", "next_retry_at"]);
    pgm.createIndex("e_invoices", "created_by");
    pgm.createIndex("e_invoices", "cancelled_by");

    // ---- Tổng hợp doanh thu theo ngày ----
    pgm.createTable("report_daily_payments", {
        day: { type: "date", notNull: true, primaryKey: true },
        restaurant_id: { type: "integer", notNull: true, primaryKey: true, references: "restaurants", onDelete: "CASCADE" },
        method: { type: "varchar(10)", notNull: true, primaryKey: true },
        collected: { type: "numeric(14,2)", notNull: true, default: 0 },
        refunded: { type: "numeric(14,2)", notNull: true, default: 0 },
        payment_count: { type: "integer", notNull: true, default: 0 },
        tips: { type: "numeric(14,2)", notNull: true, default: 0 },
    });
    pgm.createIndex("report_daily_payments", "restaurant_id");
    pgm.createTable("report_summary_state", {
        id: { type: "integer", primaryKey: true, default: 1 },
        /** Ngày cuối (giờ VN) đã tổng hợp vào report_daily_payments; null = chưa tổng hợp */
        payments_through: { type: "date" },
        refreshed_at: { type: "timestamptz" },
    });
    pgm.addConstraint("report_summary_state", "report_summary_state_single", "CHECK (id = 1)");
    pgm.sql("INSERT INTO report_summary_state (id) VALUES (1)");
    // Thay đổi payment rơi vào ngày đã tổng hợp -> lùi mốc để ngày đó đọc lại từ payments (job đêm tổng hợp lại)
    pgm.sql(`
        CREATE OR REPLACE FUNCTION report_payments_invalidate() RETURNS trigger AS $$
        DECLARE
            d date;
        BEGIN
            IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.paid_at IS NOT NULL THEN
                d := (OLD.paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
                UPDATE report_summary_state SET payments_through = d - 1 WHERE id = 1 AND payments_through >= d;
            END IF;
            IF TG_OP IN ('UPDATE', 'INSERT') AND NEW.paid_at IS NOT NULL THEN
                d := (NEW.paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
                UPDATE report_summary_state SET payments_through = d - 1 WHERE id = 1 AND payments_through >= d;
            END IF;
            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
    `);
    pgm.sql(`
        CREATE TRIGGER payments_report_invalidate
        AFTER INSERT OR UPDATE OR DELETE ON payments
        FOR EACH ROW EXECUTE FUNCTION report_payments_invalidate();
    `);
    pgm.sql(`
        CREATE OR REPLACE FUNCTION report_payments_truncate() RETURNS trigger AS $$
        BEGIN
            UPDATE report_summary_state SET payments_through = NULL WHERE id = 1;
            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
    `);
    pgm.sql(`
        CREATE TRIGGER payments_report_truncate
        AFTER TRUNCATE ON payments
        FOR EACH STATEMENT EXECUTE FUNCTION report_payments_truncate();
    `);

    // ---- Phân vùng audit_logs theo tháng ----
    pgm.sql(PROTECT_FN("TG_TABLE_NAME <> 'audit_logs_archive'"));
    pgm.sql("ALTER TABLE audit_logs RENAME TO audit_logs_unpartitioned");
    pgm.sql("ALTER SEQUENCE audit_logs_id_seq OWNED BY NONE");
    // LIKE giữ nguyên thứ tự cột (job lưu trữ chép `moved.*` sang audit_logs_archive)
    pgm.sql(`
        CREATE TABLE audit_logs (LIKE audit_logs_unpartitioned INCLUDING DEFAULTS INCLUDING CONSTRAINTS)
        PARTITION BY RANGE (created_at)
    `);
    pgm.sql("ALTER SEQUENCE audit_logs_id_seq OWNED BY audit_logs.id");
    pgm.sql("ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_pk PRIMARY KEY (id, created_at)");
    pgm.sql(`ALTER TABLE audit_logs
        ADD CONSTRAINT audit_logs_account_fk FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
        ADD CONSTRAINT audit_logs_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        ADD CONSTRAINT audit_logs_restaurant_fk FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE SET NULL`);
    pgm.sql("CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT");
    pgm.sql(`
        CREATE OR REPLACE FUNCTION audit_logs_ensure_partitions(months_ahead integer) RETURNS integer AS $$
        DECLARE
            m date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
            last date := (date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => months_ahead))::date;
            name text;
            created integer := 0;
        BEGIN
            WHILE m <= last LOOP
                name := 'audit_logs_p' || to_char(m, 'YYYYMM');
                IF to_regclass(name) IS NULL THEN
                    BEGIN
                        EXECUTE format(
                            'CREATE TABLE %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
                            name, (m::timestamp AT TIME ZONE 'UTC'), ((m + interval '1 month')::timestamp AT TIME ZONE 'UTC')
                        );
                        EXECUTE format(
                            'CREATE TRIGGER audit_logs_protect_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_protect()',
                            name
                        );
                        created := created + 1;
                    EXCEPTION WHEN check_violation THEN
                        -- Phân vùng mặc định đã có dòng của tháng này: để nguyên, dòng vẫn đọc được bình thường
                        RAISE NOTICE 'audit_logs: skip partition % (default partition has rows)', name;
                    END;
                END IF;
                m := (m + interval '1 month')::date;
            END LOOP;
            RETURN created;
        END;
        $$ LANGUAGE plpgsql;
    `);
    // Phân vùng cho các tháng đang có dữ liệu, rồi cho tháng hiện tại + 3 tháng tới
    pgm.sql(`
        DO $$
        DECLARE
            m date;
            name text;
        BEGIN
            FOR m IN SELECT DISTINCT date_trunc('month', created_at AT TIME ZONE 'UTC')::date FROM audit_logs_unpartitioned LOOP
                name := 'audit_logs_p' || to_char(m, 'YYYYMM');
                EXECUTE format(
                    'CREATE TABLE %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
                    name, (m::timestamp AT TIME ZONE 'UTC'), ((m + interval '1 month')::timestamp AT TIME ZONE 'UTC')
                );
                EXECUTE format(
                    'CREATE TRIGGER audit_logs_protect_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_protect()',
                    name
                );
            END LOOP;
        END $$;
    `);
    pgm.sql("SELECT audit_logs_ensure_partitions(3)");
    pgm.sql("INSERT INTO audit_logs SELECT * FROM audit_logs_unpartitioned");
    pgm.sql("DROP TABLE audit_logs_unpartitioned");
    pgm.sql("CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id)");
    pgm.sql("CREATE INDEX audit_logs_account_idx ON audit_logs (account_id)");
    pgm.sql("CREATE INDEX audit_logs_user_idx ON audit_logs (user_id)");
    pgm.sql("CREATE INDEX audit_logs_restaurant_created_idx ON audit_logs (restaurant_id, created_at)");
    pgm.sql("CREATE INDEX audit_logs_action_idx ON audit_logs (action)");
    pgm.sql("CREATE INDEX audit_logs_created_idx ON audit_logs (created_at)");
    pgm.sql("CREATE INDEX audit_logs_id_idx ON audit_logs (id)");
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
    pgm.sql(`
        CREATE TRIGGER audit_logs_protect_truncate
        BEFORE TRUNCATE ON audit_logs_default
        FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_protect();
    `);

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

    // audit_logs trở lại bảng thường
    pgm.sql("ALTER TABLE audit_logs RENAME TO audit_logs_partitioned");
    pgm.sql("ALTER SEQUENCE audit_logs_id_seq OWNED BY NONE");
    pgm.sql("CREATE TABLE audit_logs (LIKE audit_logs_partitioned INCLUDING DEFAULTS INCLUDING CONSTRAINTS)");
    pgm.sql("ALTER SEQUENCE audit_logs_id_seq OWNED BY audit_logs.id");
    pgm.sql("INSERT INTO audit_logs SELECT * FROM audit_logs_partitioned");
    pgm.sql("DROP TABLE audit_logs_partitioned CASCADE");
    pgm.sql("DROP FUNCTION IF EXISTS audit_logs_ensure_partitions(integer)");
    pgm.sql("ALTER TABLE audit_logs ADD PRIMARY KEY (id)");
    pgm.sql(`ALTER TABLE audit_logs
        ADD FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
        ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        ADD FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE SET NULL`);
    pgm.sql("CREATE INDEX audit_logs_entity_type_entity_id_index ON audit_logs (entity_type, entity_id)");
    pgm.sql("CREATE INDEX audit_logs_account_id_index ON audit_logs (account_id)");
    pgm.sql("CREATE INDEX audit_logs_user_id_index ON audit_logs (user_id)");
    pgm.sql("CREATE INDEX audit_logs_restaurant_id_created_at_index ON audit_logs (restaurant_id, created_at)");
    pgm.sql("CREATE INDEX audit_logs_action_index ON audit_logs (action)");
    pgm.sql("CREATE INDEX audit_logs_created_at_index ON audit_logs (created_at)");
    pgm.sql(PROTECT_FN("TG_TABLE_NAME = 'audit_logs'"));
    pgm.sql(`CREATE TRIGGER audit_logs_protect_row BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION audit_logs_protect()`);
    pgm.sql(`CREATE TRIGGER audit_logs_protect_truncate BEFORE TRUNCATE ON audit_logs
        FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_protect()`);

    pgm.sql("DROP TRIGGER IF EXISTS payments_report_truncate ON payments");
    pgm.sql("DROP TRIGGER IF EXISTS payments_report_invalidate ON payments");
    pgm.sql("DROP FUNCTION IF EXISTS report_payments_truncate()");
    pgm.sql("DROP FUNCTION IF EXISTS report_payments_invalidate()");
    pgm.dropTable("report_summary_state");
    pgm.dropTable("report_daily_payments");
    pgm.dropTable("e_invoices");
    pgm.dropTable("gateway_transactions");
    pgm.sql("DROP INDEX IF EXISTS payments_processing_expiry");
    pgm.sql("DROP INDEX IF EXISTS payments_gateway_ref_unique");
    pgm.dropColumns("payments", ["provider", "gateway_ref", "gateway_data", "expires_at"]);
    pgm.dropIndex("restaurants", "bank_account_no");
    pgm.dropConstraint("restaurants", "restaurants_bank_check");
    pgm.dropColumns("restaurants", [
        "bank_bin",
        "bank_account_no",
        "bank_account_name",
        "transfer_qr_enabled",
        "legal_name",
        "tax_code",
        "einvoice_series",
        "einvoice_auto_issue",
    ]);
}
