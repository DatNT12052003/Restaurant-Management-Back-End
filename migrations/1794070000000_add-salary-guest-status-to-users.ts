import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Đặc tả 4.2:
 * - Nhân viên: mức lương (`salary`). Trạng thái làm việc dùng cột `status` sẵn có (active = đang làm, inactive = đã nghỉ).
 * - Khách hàng: trạng thái khách (`guest_status`: new | regular). Null với nhân viên.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
    pgm.addColumns("users", {
        salary: { type: "numeric(12,2)" },
        guest_status: { type: "varchar(20)" },
    });
    pgm.addConstraint("users", "users_salary_check", "CHECK (salary IS NULL OR salary >= 0)");
    pgm.addConstraint(
        "users",
        "users_guest_status_check",
        "CHECK (guest_status IS NULL OR guest_status IN ('new', 'regular'))",
    );

    pgm.sql(`
        UPDATE users u SET guest_status = 'new'
        WHERE u.guest_status IS NULL AND EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
            WHERE ur.user_id = u.id AND ur.deleted_at IS NULL AND r.type_name = 'guest'
        )
    `);

    pgm.createIndex("users", "restaurant_id", { name: "users_restaurant_id_idx", ifNotExists: true });
    pgm.createIndex("user_roles", ["user_id", "role_id"], { name: "user_roles_user_role_idx", ifNotExists: true });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropIndex("user_roles", ["user_id", "role_id"], { name: "user_roles_user_role_idx", ifExists: true });
    pgm.dropIndex("users", "restaurant_id", { name: "users_restaurant_id_idx", ifExists: true });
    pgm.dropConstraint("users", "users_guest_status_check");
    pgm.dropConstraint("users", "users_salary_check");
    pgm.dropColumns("users", ["salary", "guest_status"]);
}
