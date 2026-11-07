import { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Seed trước đó tạo role 'cleaner_staff' trong khi DB (và đặc tả) dùng 'clean_staff'.
 * Gộp về 'clean_staff': chuyển quyền + user đang gán sang 'clean_staff', rồi xóa mềm 'cleaner_staff'.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
    pgm.sql(`
        INSERT INTO roles (name, type_name)
        SELECT 'Nhân viên tạp vụ', 'clean_staff'
        WHERE NOT EXISTS (SELECT 1 FROM roles WHERE type_name = 'clean_staff' AND deleted_at IS NULL)
    `);

    pgm.sql(`
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT target.id, rp.permission_id
        FROM role_permissions rp
        JOIN roles old ON old.id = rp.role_id AND old.type_name = 'cleaner_staff' AND old.deleted_at IS NULL
        CROSS JOIN LATERAL (
            SELECT id FROM roles WHERE type_name = 'clean_staff' AND deleted_at IS NULL ORDER BY id LIMIT 1
        ) target
        WHERE rp.deleted_at IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM role_permissions x
              WHERE x.role_id = target.id AND x.permission_id = rp.permission_id AND x.deleted_at IS NULL
          )
    `);

    pgm.sql(`
        UPDATE user_roles ur
        SET role_id = (SELECT id FROM roles WHERE type_name = 'clean_staff' AND deleted_at IS NULL ORDER BY id LIMIT 1),
            updated_at = NOW()
        FROM roles old
        WHERE old.id = ur.role_id AND old.type_name = 'cleaner_staff' AND ur.deleted_at IS NULL
    `);

    pgm.sql(`
        UPDATE role_permissions SET deleted_at = NOW()
        WHERE deleted_at IS NULL
          AND role_id IN (SELECT id FROM roles WHERE type_name = 'cleaner_staff' AND deleted_at IS NULL)
    `);
    pgm.sql(`UPDATE roles SET deleted_at = NOW() WHERE type_name = 'cleaner_staff' AND deleted_at IS NULL`);
}

export async function down(): Promise<void> {
    // Không khôi phục role trùng lặp.
}
