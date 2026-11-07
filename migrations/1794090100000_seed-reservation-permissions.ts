import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Seed quyền đặt bàn (giai đoạn 3). Chỉ thêm phần còn thiếu, giống các migration seed trước.
 * Giá trị được viết cứng (không import enum) để migration không đổi nghĩa nếu enum thay đổi sau này.
 */
const PERMISSIONS: [string, string][] = [
    ["reservation.create", "Tạo đặt bàn"],
    ["reservation.view", "Xem đặt bàn"],
    ["reservation.update", "Cập nhật đặt bàn"],
    ["reservation.delete", "Xóa đặt bàn"],
];

const ALL = PERMISSIONS.map(([p]) => p);
const OPERATE = ["reservation.create", "reservation.view", "reservation.update"];

const ROLE_PERMISSIONS: Record<string, string[]> = {
    admin: ALL,
    manager: ALL,
    supervisor: OPERATE,
    // Lễ tân tiếp nhận đặt bàn (đặc tả 4.6)
    receptionist: OPERATE,
    cashier: ["reservation.view"],
    waitstaff: ["reservation.view"],
};

const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export async function up(pgm: MigrationBuilder): Promise<void> {
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
    pgm.sql(`
        DELETE FROM user_permissions WHERE permission_id IN (
            SELECT id FROM permissions WHERE type_name IN (${ALL.map(lit).join(", ")})
        )
    `);
    pgm.sql(`
        DELETE FROM role_permissions WHERE permission_id IN (
            SELECT id FROM permissions WHERE type_name IN (${ALL.map(lit).join(", ")})
        )
    `);
    pgm.sql(`DELETE FROM permissions WHERE type_name IN (${ALL.map(lit).join(", ")})`);
}
