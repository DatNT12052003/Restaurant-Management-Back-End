import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Giai đoạn 12: nhân sự — ca làm, chấm công, nghỉ phép, lương (câu hỏi 10 đã chốt).
 *
 * - `hr_settings`: cấu hình nhân sự theo chi nhánh (không có dòng = giá trị mặc định): 26 ngày công chuẩn, 8 giờ / ngày,
 *   ân hạn đi muộn / về sớm, ngưỡng và hệ số tăng ca, mức phạt đi muộn, khóa ký mã QR chấm công.
 * - `shift_templates` (ca mẫu) và `shift_assignments` (lịch làm việc): mỗi ca một nhân viên một khoảng thời gian,
 *   không chồng lấn với ca khác của cùng người (ràng buộc EXCLUDE).
 * - `shift_swap_requests`: đổi ca / nhường ca. Người nhận đồng ý rồi quản lý duyệt.
 * - `attendance_records`: vào / ra ca bằng mã QR của chi nhánh (hoặc quản lý ghi tay). Tính đi muộn, về sớm,
 *   số phút làm, số phút tăng ca (chờ duyệt).
 * - `leave_requests`: đơn nghỉ có lương / không lương, quản lý duyệt.
 * - `employee_compensations`: lịch sử lương (theo tháng hoặc theo giờ, áp dụng từ ngày). `users.salary` giữ mức hiện hành.
 * - `employee_allowances` (phụ cấp cố định theo tháng) và `employee_adjustments` (thưởng / phạt từng lần, phạt đi muộn tự động).
 * - `payroll_periods` / `payroll_items`: bảng lương theo tháng và chi nhánh. Đã chốt thì DB chặn sửa / xóa.
 * - `employee_reviews`: đánh giá nhân viên theo tháng.
 */
const PERMISSIONS: [string, string][] = [
    ["hr.self", "Xem lịch làm của mình, chấm công, xin đổi ca / nghỉ phép"],
    ["shift.view", "Xem lịch làm việc của chi nhánh"],
    ["shift.manage", "Xếp ca, ca mẫu, duyệt đổi ca"],
    ["attendance.view", "Xem chấm công của chi nhánh"],
    ["attendance.manage", "Sửa chấm công, duyệt tăng ca"],
    ["attendance.kiosk", "Hiển thị mã QR chấm công của chi nhánh"],
    ["leave.approve", "Duyệt đơn nghỉ phép"],
    ["staff_review.manage", "Đánh giá nhân viên"],
    ["payroll.view", "Xem lương, phụ cấp, thưởng phạt, bảng lương"],
    ["payroll.manage", "Điều chỉnh lương, phụ cấp, thưởng phạt; tính và chốt bảng lương; cấu hình nhân sự"],
];
const ALL = PERMISSIONS.map(([p]) => p);
const STAFF_ROLES = [
    "manager",
    "supervisor",
    "cashier",
    "receptionist",
    "waitstaff",
    "barista",
    "head_chef",
    "sous_chef",
    "commis_chef",
    "clean_staff",
    "guard",
];
const ROLE_PERMISSIONS: Record<string, string[]> = {
    admin: ALL,
    manager: ALL,
    supervisor: ["hr.self", "shift.view", "shift.manage", "attendance.view", "attendance.manage", "attendance.kiosk", "leave.approve", "staff_review.manage"],
    cashier: ["hr.self", "attendance.kiosk"],
    receptionist: ["hr.self", "attendance.kiosk"],
    head_chef: ["hr.self", "shift.view"],
    ...Object.fromEntries(
        STAFF_ROLES.filter((r) => !["manager", "supervisor", "cashier", "receptionist", "head_chef"].includes(r)).map((r) => [r, ["hr.self"]]),
    ),
};

const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export async function up(pgm: MigrationBuilder): Promise<void> {
    const stamps = {
        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
        updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    };
    const user = (notNull = true) => ({ type: "integer", notNull, references: "users", onDelete: notNull ? "RESTRICT" : "SET NULL" }) as const;
    const restaurant = { type: "integer", notNull: true, references: "restaurants", onDelete: "RESTRICT" } as const;

    // ---- Cấu hình ----
    pgm.createTable("hr_settings", {
        restaurant_id: { type: "integer", primaryKey: true, references: "restaurants", onDelete: "CASCADE" },
        standard_work_days: { type: "integer", notNull: true, default: 26 },
        standard_hours_per_day: { type: "numeric(4,2)", notNull: true, default: 8 },
        late_grace_minutes: { type: "integer", notNull: true, default: 5 },
        early_leave_grace_minutes: { type: "integer", notNull: true, default: 5 },
        /** Phạt mỗi lần đi muộn (0 = không phạt tự động) */
        late_penalty_amount: { type: "numeric(14,2)", notNull: true, default: 0 },
        /** Giờ ngoài ca từ ngưỡng này trở lên mới tính tăng ca */
        overtime_threshold_minutes: { type: "integer", notNull: true, default: 15 },
        overtime_multiplier: { type: "numeric(4,2)", notNull: true, default: 1.5 },
        /** Được vào ca sớm nhất bao nhiêu phút trước giờ bắt đầu ca */
        early_clock_in_minutes: { type: "integer", notNull: true, default: 60 },
        /** Khóa ký mã QR chấm công; đổi khóa thì mã cũ hết hiệu lực */
        qr_secret: { type: "varchar(64)", notNull: true, default: pgm.func("md5(random()::text || clock_timestamp()::text)") },
        ...stamps,
    });
    pgm.addConstraint(
        "hr_settings",
        "hr_settings_check",
        `CHECK (standard_work_days BETWEEN 1 AND 31 AND standard_hours_per_day > 0 AND standard_hours_per_day <= 24
            AND late_grace_minutes BETWEEN 0 AND 240 AND early_leave_grace_minutes BETWEEN 0 AND 240
            AND late_penalty_amount >= 0 AND overtime_threshold_minutes BETWEEN 0 AND 600
            AND overtime_multiplier BETWEEN 1 AND 5 AND early_clock_in_minutes BETWEEN 0 AND 720)`,
    );

    // ---- Ca làm ----
    pgm.createTable("shift_templates", {
        id: "id",
        restaurant_id: restaurant,
        name: { type: "varchar(100)", notNull: true },
        start_time: { type: "time", notNull: true },
        /** end_time <= start_time: ca qua đêm (kết thúc ngày hôm sau) */
        end_time: { type: "time", notNull: true },
        break_minutes: { type: "integer", notNull: true, default: 0 },
        status: { type: "varchar(10)", notNull: true, default: "active" },
        ...stamps,
        deleted_at: { type: "timestamptz" },
    });
    pgm.addConstraint("shift_templates", "shift_templates_check", "CHECK (status IN ('active', 'inactive') AND break_minutes BETWEEN 0 AND 480 AND start_time <> end_time)");
    pgm.createIndex("shift_templates", "restaurant_id");
    pgm.sql("CREATE UNIQUE INDEX shift_templates_name_unique ON shift_templates (restaurant_id, lower(name)) WHERE deleted_at IS NULL");

    pgm.createTable("shift_assignments", {
        id: "id",
        restaurant_id: restaurant,
        user_id: user(),
        shift_template_id: { type: "integer", references: "shift_templates", onDelete: "SET NULL" },
        /** Ngày làm (theo giờ Việt Nam) của giờ bắt đầu ca */
        work_date: { type: "date", notNull: true },
        start_at: { type: "timestamptz", notNull: true },
        end_at: { type: "timestamptz", notNull: true },
        break_minutes: { type: "integer", notNull: true, default: 0 },
        note: { type: "text" },
        created_by: user(false),
        ...stamps,
        deleted_at: { type: "timestamptz" },
    });
    pgm.addConstraint(
        "shift_assignments",
        "shift_assignments_check",
        "CHECK (end_at > start_at AND end_at - start_at <= interval '24 hours' AND break_minutes >= 0)",
    );
    // Một người không có hai ca chồng lấn nhau. DEFERRABLE: đổi ca hoán đổi người của hai ca trong cùng transaction
    pgm.sql(`ALTER TABLE shift_assignments ADD CONSTRAINT shift_assignments_no_overlap
        EXCLUDE USING gist (user_id WITH =, tstzrange(start_at, end_at) WITH &&) WHERE (deleted_at IS NULL)
        DEFERRABLE INITIALLY IMMEDIATE`);
    pgm.createIndex("shift_assignments", ["restaurant_id", "work_date"]);
    pgm.createIndex("shift_assignments", ["user_id", "work_date"]);
    pgm.createIndex("shift_assignments", "shift_template_id");
    pgm.createIndex("shift_assignments", "created_by");

    pgm.createTable("shift_swap_requests", {
        id: "id",
        restaurant_id: restaurant,
        /** Ca của người xin đổi */
        assignment_id: { type: "integer", notNull: true, references: "shift_assignments", onDelete: "CASCADE" },
        requester_id: user(),
        target_user_id: user(),
        /** Ca của người nhận để đổi lại; NULL = nhường ca */
        target_assignment_id: { type: "integer", references: "shift_assignments", onDelete: "CASCADE" },
        status: { type: "varchar(20)", notNull: true, default: "pending_target" },
        reason: { type: "text" },
        target_responded_at: { type: "timestamptz" },
        decided_by: user(false),
        decided_at: { type: "timestamptz" },
        decision_note: { type: "text" },
        ...stamps,
    });
    pgm.addConstraint(
        "shift_swap_requests",
        "shift_swap_requests_status_check",
        "CHECK (status IN ('pending_target', 'pending_approval', 'approved', 'rejected', 'declined', 'cancelled'))",
    );
    pgm.addConstraint("shift_swap_requests", "shift_swap_requests_users_check", "CHECK (requester_id <> target_user_id)");
    pgm.createIndex("shift_swap_requests", ["restaurant_id", "status"]);
    pgm.createIndex("shift_swap_requests", "assignment_id");
    pgm.createIndex("shift_swap_requests", "target_assignment_id");
    pgm.createIndex("shift_swap_requests", "requester_id");
    pgm.createIndex("shift_swap_requests", "target_user_id");
    pgm.createIndex("shift_swap_requests", "decided_by");

    // ---- Chấm công ----
    pgm.createTable("attendance_records", {
        id: "id",
        restaurant_id: restaurant,
        user_id: user(),
        assignment_id: { type: "integer", references: "shift_assignments", onDelete: "SET NULL" },
        work_date: { type: "date", notNull: true },
        clock_in_at: { type: "timestamptz", notNull: true },
        clock_out_at: { type: "timestamptz" },
        /** qr = nhân viên tự quét mã; manual = quản lý ghi / sửa tay */
        method: { type: "varchar(10)", notNull: true, default: "qr" },
        late_minutes: { type: "integer", notNull: true, default: 0 },
        early_leave_minutes: { type: "integer", notNull: true, default: 0 },
        /** Số phút làm (đã trừ giờ nghỉ của ca), tính khi ra ca */
        worked_minutes: { type: "integer", notNull: true, default: 0 },
        /** Số phút ngoài ca (gồm cả giờ làm khi không có ca) */
        overtime_minutes: { type: "integer", notNull: true, default: 0 },
        overtime_status: { type: "varchar(10)", notNull: true, default: "none" },
        overtime_decided_by: user(false),
        note: { type: "text" },
        created_by: user(false),
        ...stamps,
        deleted_at: { type: "timestamptz" },
    });
    pgm.addConstraint(
        "attendance_records",
        "attendance_records_check",
        `CHECK (method IN ('qr', 'manual') AND overtime_status IN ('none', 'pending', 'approved', 'rejected')
            AND (clock_out_at IS NULL OR clock_out_at > clock_in_at)
            AND late_minutes >= 0 AND early_leave_minutes >= 0 AND worked_minutes >= 0 AND overtime_minutes >= 0)`,
    );
    // Mỗi người chỉ có một lượt đang trong ca; mỗi ca chỉ một lượt chấm công
    pgm.sql("CREATE UNIQUE INDEX attendance_records_open_unique ON attendance_records (user_id) WHERE clock_out_at IS NULL AND deleted_at IS NULL");
    pgm.sql("CREATE UNIQUE INDEX attendance_records_assignment_unique ON attendance_records (assignment_id) WHERE assignment_id IS NOT NULL AND deleted_at IS NULL");
    pgm.createIndex("attendance_records", ["restaurant_id", "work_date"]);
    pgm.createIndex("attendance_records", ["user_id", "work_date"]);
    pgm.createIndex("attendance_records", "overtime_status");
    pgm.createIndex("attendance_records", "overtime_decided_by");
    pgm.createIndex("attendance_records", "created_by");

    // ---- Nghỉ phép ----
    pgm.createTable("leave_requests", {
        id: "id",
        restaurant_id: restaurant,
        user_id: user(),
        start_date: { type: "date", notNull: true },
        end_date: { type: "date", notNull: true },
        type: { type: "varchar(10)", notNull: true },
        reason: { type: "text" },
        status: { type: "varchar(10)", notNull: true, default: "pending" },
        decided_by: user(false),
        decided_at: { type: "timestamptz" },
        decision_note: { type: "text" },
        ...stamps,
    });
    pgm.addConstraint(
        "leave_requests",
        "leave_requests_check",
        `CHECK (type IN ('paid', 'unpaid') AND status IN ('pending', 'approved', 'rejected', 'cancelled')
            AND end_date >= start_date AND end_date - start_date < 60)`,
    );
    pgm.createIndex("leave_requests", ["restaurant_id", "status"]);
    pgm.createIndex("leave_requests", ["user_id", "start_date"]);
    pgm.createIndex("leave_requests", "decided_by");

    // ---- Lương, phụ cấp, thưởng phạt ----
    pgm.createTable("employee_compensations", {
        id: "id",
        user_id: { type: "integer", notNull: true, references: "users", onDelete: "CASCADE" },
        /** monthly: `amount` là lương tháng; hourly: `amount` là đơn giá một giờ */
        pay_type: { type: "varchar(10)", notNull: true },
        amount: { type: "numeric(14,2)", notNull: true },
        effective_from: { type: "date", notNull: true },
        note: { type: "text" },
        created_by: user(false),
        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    });
    pgm.addConstraint("employee_compensations", "employee_compensations_check", "CHECK (pay_type IN ('monthly', 'hourly') AND amount >= 0)");
    pgm.addConstraint("employee_compensations", "employee_compensations_unique", "UNIQUE (user_id, effective_from)");
    pgm.createIndex("employee_compensations", "created_by");

    pgm.createTable("employee_allowances", {
        id: "id",
        user_id: { type: "integer", notNull: true, references: "users", onDelete: "CASCADE" },
        name: { type: "varchar(100)", notNull: true },
        /** Số tiền mỗi tháng */
        amount: { type: "numeric(14,2)", notNull: true },
        status: { type: "varchar(10)", notNull: true, default: "active" },
        created_by: user(false),
        ...stamps,
        deleted_at: { type: "timestamptz" },
    });
    pgm.addConstraint("employee_allowances", "employee_allowances_check", "CHECK (amount > 0 AND status IN ('active', 'inactive'))");
    pgm.createIndex("employee_allowances", "user_id");
    pgm.createIndex("employee_allowances", "created_by");

    pgm.createTable("payroll_periods", {
        id: "id",
        restaurant_id: restaurant,
        /** Ngày đầu tháng của kỳ lương */
        period_month: { type: "date", notNull: true },
        status: { type: "varchar(10)", notNull: true, default: "draft" },
        total_net: { type: "numeric(16,2)", notNull: true, default: 0 },
        /** Chi phí nhân công = tổng thực lĩnh trừ tip (tip do khách trả, không phải chi phí của nhà hàng) */
        labor_cost: { type: "numeric(16,2)", notNull: true, default: 0 },
        employee_count: { type: "integer", notNull: true, default: 0 },
        note: { type: "text" },
        created_by: user(false),
        calculated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
        finalized_by: user(false),
        finalized_at: { type: "timestamptz" },
        ...stamps,
    });
    pgm.addConstraint(
        "payroll_periods",
        "payroll_periods_check",
        "CHECK (status IN ('draft', 'finalized') AND period_month = date_trunc('month', period_month)::date)",
    );
    pgm.addConstraint("payroll_periods", "payroll_periods_unique", "UNIQUE (restaurant_id, period_month)");
    pgm.createIndex("payroll_periods", "period_month");
    pgm.createIndex("payroll_periods", "created_by");
    pgm.createIndex("payroll_periods", "finalized_by");

    pgm.createTable("payroll_items", {
        id: "id",
        payroll_id: { type: "integer", notNull: true, references: "payroll_periods", onDelete: "RESTRICT" },
        user_id: user(),
        full_name: { type: "varchar(255)", notNull: true },
        /** Kiểu lương / mức lương áp dụng cuối kỳ (chi tiết từng mức trong `details`) */
        pay_type: { type: "varchar(10)" },
        rate: { type: "numeric(14,2)" },
        work_days: { type: "integer", notNull: true, default: 0 },
        paid_leave_days: { type: "integer", notNull: true, default: 0 },
        unpaid_leave_days: { type: "integer", notNull: true, default: 0 },
        worked_minutes: { type: "integer", notNull: true, default: 0 },
        overtime_minutes: { type: "integer", notNull: true, default: 0 },
        late_count: { type: "integer", notNull: true, default: 0 },
        base_pay: { type: "numeric(14,2)", notNull: true, default: 0 },
        overtime_pay: { type: "numeric(14,2)", notNull: true, default: 0 },
        allowance_total: { type: "numeric(14,2)", notNull: true, default: 0 },
        bonus_total: { type: "numeric(14,2)", notNull: true, default: 0 },
        penalty_total: { type: "numeric(14,2)", notNull: true, default: 0 },
        tip_total: { type: "numeric(14,2)", notNull: true, default: 0 },
        net_pay: { type: "numeric(14,2)", notNull: true, default: 0 },
        /** Phụ cấp, thưởng / phạt, các mức lương đã dùng */
        details: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
        created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    });
    pgm.addConstraint("payroll_items", "payroll_items_unique", "UNIQUE (payroll_id, user_id)");
    pgm.createIndex("payroll_items", "user_id");

    pgm.createTable("employee_adjustments", {
        id: "id",
        restaurant_id: restaurant,
        user_id: user(),
        type: { type: "varchar(10)", notNull: true },
        amount: { type: "numeric(14,2)", notNull: true },
        reason: { type: "text", notNull: true },
        /** Ngày phát sinh: thuộc kỳ lương của tháng chứa ngày này */
        effective_date: { type: "date", notNull: true },
        /** manual = nhập tay; late = phạt đi muộn tự động */
        source: { type: "varchar(10)", notNull: true, default: "manual" },
        attendance_id: { type: "integer", references: "attendance_records", onDelete: "SET NULL" },
        /** Bảng lương đã chốt có khoản này: không sửa / xóa được nữa */
        payroll_id: { type: "integer", references: "payroll_periods", onDelete: "SET NULL" },
        created_by: user(false),
        ...stamps,
        deleted_at: { type: "timestamptz" },
    });
    pgm.addConstraint(
        "employee_adjustments",
        "employee_adjustments_check",
        "CHECK (type IN ('bonus', 'penalty') AND source IN ('manual', 'late') AND amount > 0)",
    );
    pgm.sql("CREATE UNIQUE INDEX employee_adjustments_attendance_unique ON employee_adjustments (attendance_id) WHERE attendance_id IS NOT NULL AND deleted_at IS NULL");
    pgm.createIndex("employee_adjustments", ["restaurant_id", "effective_date"]);
    pgm.createIndex("employee_adjustments", ["user_id", "effective_date"]);
    pgm.createIndex("employee_adjustments", "payroll_id");
    pgm.createIndex("employee_adjustments", "created_by");

    // ---- Đánh giá ----
    pgm.createTable("employee_reviews", {
        id: "id",
        restaurant_id: restaurant,
        user_id: user(),
        period_month: { type: "date", notNull: true },
        rating: { type: "integer", notNull: true },
        comment: { type: "text" },
        reviewer_id: user(false),
        ...stamps,
    });
    pgm.addConstraint(
        "employee_reviews",
        "employee_reviews_check",
        "CHECK (rating BETWEEN 1 AND 5 AND period_month = date_trunc('month', period_month)::date)",
    );
    pgm.addConstraint("employee_reviews", "employee_reviews_unique", "UNIQUE (user_id, period_month)");
    pgm.createIndex("employee_reviews", ["restaurant_id", "period_month"]);
    pgm.createIndex("employee_reviews", "reviewer_id");

    // ---- Bảng lương đã chốt: không sửa / xóa được (kể cả bằng SQL tay) ----
    pgm.sql(`
        CREATE FUNCTION payroll_protect_finalized() RETURNS trigger AS $$
        DECLARE pid integer;
        BEGIN
            IF TG_TABLE_NAME = 'payroll_periods' THEN
                IF OLD.status = 'finalized' THEN
                    RAISE EXCEPTION 'payroll % is finalized', OLD.id USING ERRCODE = 'P0001';
                END IF;
                IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
                RETURN NEW;
            END IF;
            IF TG_OP = 'INSERT' THEN pid := NEW.payroll_id; ELSE pid := OLD.payroll_id; END IF;
            IF EXISTS (SELECT 1 FROM payroll_periods WHERE id = pid AND status = 'finalized') THEN
                RAISE EXCEPTION 'payroll % is finalized', pid USING ERRCODE = 'P0001';
            END IF;
            IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    `);
    pgm.sql(`CREATE TRIGGER payroll_periods_protect BEFORE UPDATE OR DELETE ON payroll_periods
        FOR EACH ROW EXECUTE FUNCTION payroll_protect_finalized()`);
    pgm.sql(`CREATE TRIGGER payroll_items_protect BEFORE INSERT OR UPDATE OR DELETE ON payroll_items
        FOR EACH ROW EXECUTE FUNCTION payroll_protect_finalized()`);

    // ---- Lịch sử lương ban đầu từ cột users.salary hiện có (coi là lương tháng) ----
    pgm.sql(`
        INSERT INTO employee_compensations (user_id, pay_type, amount, effective_from, note)
        SELECT u.id, 'monthly', u.salary, (u.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'Khởi tạo từ mức lương hiện có'
        FROM users u WHERE u.salary IS NOT NULL AND u.deleted_at IS NULL
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

    pgm.dropTable("employee_reviews");
    pgm.dropTable("employee_adjustments");
    pgm.sql("DROP TRIGGER payroll_items_protect ON payroll_items");
    pgm.sql("DROP TRIGGER payroll_periods_protect ON payroll_periods");
    pgm.sql("DROP FUNCTION payroll_protect_finalized()");
    pgm.dropTable("payroll_items");
    pgm.dropTable("payroll_periods");
    pgm.dropTable("employee_allowances");
    pgm.dropTable("employee_compensations");
    pgm.dropTable("leave_requests");
    pgm.dropTable("attendance_records");
    pgm.dropTable("shift_swap_requests");
    pgm.dropTable("shift_assignments");
    pgm.dropTable("shift_templates");
    pgm.dropTable("hr_settings");
}
