import bcrypt from "bcrypt";
import { PG_ERROR, SALT_ROUNDS } from "~/common/constant";
import { GuestStatusEnum, RolesEnum } from "~/common/enum";
import {
    CREATE_EMPLOYEE,
    CREATE_GUEST,
    CREATE_USER,
    CREATE_USER_WITH_ACCOUNT,
    DELETE_USER,
    GET_EMPLOYEES_BY_RESTAURANT_ID,
    GET_GUESTS,
    GET_USER_BY_ACCOUNT_ID,
    GET_USER_BY_EMAIL,
    UPDATE_EMPLOYEE,
    UPDATE_GUEST,
    UPDATE_USER,
    USER_DUPLICATE,
    USER_ROLE_ERROR,
} from "~/common/error-code/user";
import { canAssignRole } from "~/common/role-level";
import { rollback, withTransaction } from "~/config/db";
import { recordSalaryFromProfile } from "./payroll.service";
import {
    IAccount,
    ICreateAccountPayload,
    ICreateEmployeeBody,
    ICreateGuestBody,
    ICreateUserBody,
    ICreateUserPayload,
    ICreateUserWithAccountBody,
    IEmployee,
    IGetEmployees,
    IGetGuests,
    ISelectQuery,
    IUpdateEmployeeBody,
    IUpdateGuestBody,
    IUpdateUserBody,
    IUpdateUserPayload,
    IUser,
    IUserWithAccount,
} from "~/interfaces";
import { accountRepository, roleRepository, userRepository, userRoleRepository } from "~/repositories";
import { getPgErrorCode, stringToDate } from "~/utils/common";
import { buildPagination } from "~/utils/pagination";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const emptyToNull = <T>(value: T | "" | undefined): T | null | undefined => (value === "" ? null : value);

const isDuplicateCode = (code: number): boolean => Object.values(USER_DUPLICATE).includes(code);

/** Ánh xạ lỗi UNIQUE của PostgreSQL sang mã lỗi trùng dữ liệu; trả undefined nếu không phải lỗi trùng. */
const toDuplicateCode = (error: unknown): number | undefined => {
    if (getPgErrorCode(error) !== PG_ERROR.UNIQUE_VIOLATION) return undefined;
    const constraint = String((error as { constraint?: string }).constraint || "");
    if (constraint.includes("username")) return USER_DUPLICATE.USERNAME_EXISTS;
    if (constraint.includes("email")) return USER_DUPLICATE.EMAIL_EXISTS;
    if (constraint.includes("phone")) return USER_DUPLICATE.PHONE_EXISTS;
    return undefined;
};

/** Chỉ đưa vào payload những field client thực sự gửi lên (tránh ghi đè bằng null). */
const buildUpdatePayload = (body: IUpdateUserBody): IUpdateUserPayload => {
    const payload: IUpdateUserPayload = {
        full_name: body.full_name,
        gender: emptyToNull(body.gender),
        address: emptyToNull(body.address),
        email: emptyToNull(body.email),
        phone_number: emptyToNull(body.phone_number),
        avatar_url: body.avatar_url,
        status: body.status,
        restaurant_id: emptyToNull(body.restaurant_id as number | "" | null | undefined),
        salary: emptyToNull(body.salary as number | "" | null | undefined),
        guest_status: body.guest_status,
        updated_at: new Date(),
    };
    if (body.date_of_birth !== undefined) {
        payload.date_of_birth = stringToDate(body.date_of_birth);
    }
    return payload;
};

/**
 * Kiểm tra danh sách vai trò của nhân viên: phải tồn tại, không chứa `guest`,
 * và mọi vai trò được THÊM MỚI phải thấp hơn cấp của người thao tác.
 * Trả về id các vai trò, hoặc mã lỗi.
 */
const validateEmployeeRoles = async (
    roles: string[],
    actorRoles: string[],
    alreadyHas: string[] = [],
): Promise<number[] | number> => {
    const unique = [...new Set(roles)];
    if (unique.length === 0 || unique.includes(RolesEnum.GUEST)) {
        return USER_ROLE_ERROR.INVALID_ROLES;
    }
    const entities = await roleRepository.getRolesByTypeNames(unique);
    if (new Set(entities.map((r) => r.type_name)).size !== unique.length) {
        return USER_ROLE_ERROR.INVALID_ROLES;
    }
    const added = unique.filter((r) => !alreadyHas.includes(r));
    if (added.some((r) => !canAssignRole(actorRoles, r))) {
        return USER_ROLE_ERROR.ROLE_NOT_ASSIGNABLE;
    }
    return entities.map((r) => r.id);
};

/** Điều kiện SQL: user (alias `u`) có / không có vai trò `role`. `role` luôn là giá trị của RolesEnum. */
const hasRoleCondition = (role: RolesEnum, negate = false): string => `${negate ? "NOT " : ""}EXISTS (
    SELECT 1 FROM user_roles ur_f
    JOIN roles r_f ON r_f.id = ur_f.role_id AND r_f.deleted_at IS NULL
    WHERE ur_f.user_id = u.id AND ur_f.deleted_at IS NULL AND r_f.type_name = '${role}'
)`;

const ROLES_SUBQUERY = `COALESCE((
    SELECT array_agg(DISTINCT r_s.type_name)
    FROM user_roles ur_s
    JOIN roles r_s ON r_s.id = ur_s.role_id AND r_s.deleted_at IS NULL
    WHERE ur_s.user_id = u.id AND ur_s.deleted_at IS NULL
), '{}') AS roles`;

const PERMISSIONS_SUBQUERY = `COALESCE((
    SELECT array_agg(DISTINCT p_s.type_name)
    FROM permissions p_s
    WHERE p_s.deleted_at IS NULL AND p_s.id IN (
        SELECT rp_s.permission_id
        FROM user_roles ur_p
        JOIN roles r_p ON r_p.id = ur_p.role_id AND r_p.deleted_at IS NULL
        JOIN role_permissions rp_s ON rp_s.role_id = ur_p.role_id AND rp_s.deleted_at IS NULL
        WHERE ur_p.user_id = u.id AND ur_p.deleted_at IS NULL
        UNION
        SELECT up_s.permission_id FROM user_permissions up_s
        WHERE up_s.user_id = u.id AND up_s.deleted_at IS NULL
    )
), '{}') AS permissions`;

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export const createUser = async (body: ICreateUserBody): Promise<IUser | number> => {
    try {
        const payload: ICreateUserPayload = {
            full_name: body.full_name || "",
            date_of_birth: stringToDate(body.date_of_birth) || null,
            gender: body.gender || null,
            address: body.address || null,
            email: body.email || null,
            phone_number: body.phone_number || null,
            avatar_url: body.avatar_url || null,
            account_id: null,
            restaurant_id: null,
        };
        return await userRepository.createUser(payload);
    } catch (error) {
        return toDuplicateCode(error) ?? CREATE_USER.CREATE_USER_FAILED;
    }
};

export const createUserWithAccount = async (
    body: ICreateUserWithAccountBody,
): Promise<{ user: IUser; account: IAccount } | number> => {
    try {
        return await withTransaction(async () => {
            const accountPayload: ICreateAccountPayload = {
                username: body.account.username,
                hash_password: bcrypt.hashSync(body.account.password, SALT_ROUNDS),
            };
            const newAccount: IAccount = await accountRepository.createAccount(accountPayload);
            if (!newAccount) {
                return rollback(CREATE_USER_WITH_ACCOUNT.CREATE_ACCOUNT_FAILED);
            }

            const userPayload: ICreateUserPayload = {
                full_name: body.user.full_name,
                date_of_birth: stringToDate(body.user.date_of_birth),
                gender: body.user.gender || null,
                address: body.user.address || null,
                email: body.user.email || null,
                phone_number: body.user.phone_number || null,
                avatar_url: body.user.avatar_url || null,
                account_id: newAccount.id,
                restaurant_id: body.user.restaurant_id || null,
                salary: body.user.salary ?? null,
                guest_status: body.user.guest_status ?? null,
            };

            const newUser: IUser = await userRepository.createUser(userPayload);
            if (!newUser) {
                return rollback(CREATE_USER_WITH_ACCOUNT.CREATE_USER_FAILED);
            }

            return { user: newUser, account: newAccount };
        });
    } catch (error) {
        return toDuplicateCode(error) ?? CREATE_USER_WITH_ACCOUNT.CREATE_USER_WITH_ACCOUNT_FAILED;
    }
};

export const getUserByAccountId = async (account_id: number): Promise<IUser | number> => {
    try {
        const user = await userRepository.getUserByAccountId(account_id);
        if (!user) {
            return GET_USER_BY_ACCOUNT_ID.USER_NOT_FOUND;
        }
        return user;
    } catch (error) {
        return GET_USER_BY_ACCOUNT_ID.GET_USER_BY_ACCOUNT_ID_FAILED;
    }
};

export const getUserByEmail = async (email: string): Promise<IUser | number> => {
    try {
        const user = await userRepository.getUserByEmail(email);
        if (!user) {
            return GET_USER_BY_EMAIL.USER_NOT_FOUND;
        }
        return user;
    } catch (error) {
        return GET_USER_BY_EMAIL.GET_USER_BY_EMAIL_FAILED;
    }
};

/**
 * Cập nhật hồ sơ cá nhân: chỉ các trường thông tin cá nhân.
 * Nhà hàng, trạng thái, lương, trạng thái khách do API nhân viên/khách xử lý.
 */
export const updateUser = async (body: IUpdateUserBody, id: number): Promise<IUser | number> => {
    try {
        const { status, restaurant_id, salary, guest_status, ...profile } = body;
        const updatedUser = await userRepository.updateUser({ payload: buildUpdatePayload(profile), id });
        if (!updatedUser) {
            return UPDATE_USER.NOT_FOUND;
        }
        return updatedUser;
    } catch (error) {
        return toDuplicateCode(error) ?? UPDATE_USER.UPDATE_USER_FAILED;
    }
};

export const deleteUser = async (id: number): Promise<IUser | number> => {
    try {
        return await withTransaction(async () => {
            const user = await userRepository.deleteUser(id);
            if (!user) {
                return rollback(DELETE_USER.USER_NOT_FOUND);
            }
            // User tạo bằng POST /users có thể không có tài khoản
            if (user.account_id) {
                const account = await accountRepository.deleteAccount(user.account_id);
                if (!account) {
                    return rollback(DELETE_USER.ACCOUNT_NOT_FOUND);
                }
            }
            return user;
        });
    } catch (error) {
        return DELETE_USER.DELETE_USER_FAILED;
    }
};

// ---------------------------------------------------------------------------
// Employee
// ---------------------------------------------------------------------------

/** `roleFilter`: chỉ lấy nhân viên có vai trò này (controller đã kiểm tra thuộc RolesEnum). */
export const getEmployees = async (params: ISelectQuery, roleFilter?: RolesEnum): Promise<IGetEmployees | number> => {
    try {
        const conditions = [hasRoleCondition(RolesEnum.GUEST, true)];
        if (roleFilter) conditions.push(hasRoleCondition(roleFilter));

        const result = await userRepository.getUsersWithAccountInfo({
            ...params,
            conditions,
            returning: ["u.*", "a.username", ROLES_SUBQUERY, PERMISSIONS_SUBQUERY],
        });

        const employees: IEmployee[] = result.rows.map((row) => {
            const { roles, permissions, ...employee } = row as IUserWithAccount & {
                roles: string[];
                permissions: string[];
            };
            return { employee, roles, permissions };
        });

        return { employees, pagination: buildPagination(params, result.totalCount) };
    } catch (error) {
        return GET_EMPLOYEES_BY_RESTAURANT_ID.GET_EMPLOYEES_BY_RESTAURANT_ID_FAILED;
    }
};

export const createEmployee = async (
    body: ICreateEmployeeBody,
    actorRoles: string[],
): Promise<{ user: IUser; account: IAccount; roles: string[] } | number> => {
    try {
        const roleIds = await validateEmployeeRoles(body.roles, actorRoles);
        if (typeof roleIds === "number") return roleIds;

        return await withTransaction(async () => {
            const newUserWithAccount = await createUserWithAccount({
                user: { ...body.user, guest_status: null },
                account: body.account,
            });

            if (typeof newUserWithAccount === "number") {
                return rollback(
                    isDuplicateCode(newUserWithAccount)
                        ? newUserWithAccount
                        : CREATE_EMPLOYEE.CREATE_USER_WITH_ACCOUNT_FAILED,
                );
            }

            // Giai đoạn 12: mức lương ở hồ sơ là mức đầu tiên trong lịch sử lương
            await recordSalaryFromProfile(newUserWithAccount.user.id, body.user.salary ?? null, null);

            const rolesAssigned = await userRoleRepository.assignRolesToUser(newUserWithAccount.user.id, roleIds);
            if (!rolesAssigned) {
                return rollback(CREATE_EMPLOYEE.ASSIGN_ROLES_FAILED);
            }

            return { ...newUserWithAccount, roles: [...new Set(body.roles)] };
        });
    } catch (error) {
        return CREATE_EMPLOYEE.CREATE_EMPLOYEE_FAILED;
    }
};

export const updateEmployee = async (
    body: IUpdateEmployeeBody,
    id: number,
    actorRoles: string[],
): Promise<{ user: IUser; account: IAccount; roles: string[] } | number> => {
    try {
        const currentRoles = await roleRepository.getRolesByUserId(id);
        if (body.roles !== undefined) {
            const valid = await validateEmployeeRoles(body.roles, actorRoles, currentRoles);
            if (typeof valid === "number") return valid;
        }

        return await withTransaction(async () => {
            const { guest_status, ...userBody } = body.user || {};
            const updatedUser = await userRepository.updateUser({ payload: buildUpdatePayload(userBody), id });
            if (!updatedUser) {
                return rollback(UPDATE_EMPLOYEE.USER_NOT_FOUND);
            }
            // Giai đoạn 12: đổi lương ở hồ sơ = thêm một mức lương áp dụng từ hôm nay
            if (userBody.salary !== undefined && updatedUser.salary !== null) {
                await recordSalaryFromProfile(id, Number(updatedUser.salary), null);
            }

            const updatedAccount = await accountRepository.updateAccountUsername({
                payload: { username: body.account?.username },
                id: updatedUser.account_id!,
            });
            if (!updatedAccount) {
                return rollback(UPDATE_EMPLOYEE.ACCOUNT_NOT_FOUND);
            }

            if (body.roles === undefined) {
                return { user: updatedUser, account: updatedAccount, roles: currentRoles };
            }

            const nextRoles = [...new Set(body.roles)];
            const addRoles = nextRoles.filter((r) => !currentRoles.includes(r));
            const removeRoles = currentRoles.filter((r) => !nextRoles.includes(r));

            const rolesEntities = await roleRepository.getRolesByTypeNames([...addRoles, ...removeRoles]);
            const addRoleIds = rolesEntities.filter((r) => addRoles.includes(r.type_name)).map((r) => r.id);
            const removeRoleIds = rolesEntities.filter((r) => removeRoles.includes(r.type_name)).map((r) => r.id);

            if (addRoleIds.length > 0 && !(await userRoleRepository.assignRolesToUser(id, addRoleIds))) {
                return rollback(UPDATE_EMPLOYEE.ADD_ROLES_FAILED);
            }
            if (removeRoleIds.length > 0 && !(await userRoleRepository.removeRolesFromUser(id, removeRoleIds))) {
                return rollback(UPDATE_EMPLOYEE.REMOVE_ROLES_FAILED);
            }

            return { user: updatedUser, account: updatedAccount, roles: nextRoles };
        });
    } catch (error) {
        return toDuplicateCode(error) ?? UPDATE_EMPLOYEE.UPDATE_EMPLOYEE_FAILED;
    }
};

// ---------------------------------------------------------------------------
// Guest
// ---------------------------------------------------------------------------

export const createGuest = async (body: ICreateGuestBody): Promise<{ user: IUser; account: IAccount } | number> => {
    try {
        return await withTransaction(async () => {
            const newGuest = await createUserWithAccount({
                user: {
                    ...body.user,
                    // Khách không thuộc nhà hàng nào và không có lương
                    restaurant_id: null,
                    salary: null,
                    guest_status: body.user.guest_status || GuestStatusEnum.NEW,
                },
                account: body.account,
            });

            if (typeof newGuest === "number") {
                return rollback(isDuplicateCode(newGuest) ? newGuest : CREATE_GUEST.CREATE_USER_WITH_ACCOUNT_FAILED);
            }

            const roles = await roleRepository.getRolesByTypeNames([RolesEnum.GUEST]);
            if (roles.length === 0) {
                return rollback(CREATE_GUEST.ASSIGN_ROLES_FAILED);
            }

            const roleAssigned = await userRoleRepository.assignRolesToUser(
                newGuest.user.id,
                roles.map((r) => r.id),
            );
            if (!roleAssigned) {
                return rollback(CREATE_GUEST.ASSIGN_ROLES_FAILED);
            }

            return newGuest;
        });
    } catch (error) {
        return CREATE_GUEST.CREATE_GUEST_FAILED;
    }
};

export const updateGuest = async (
    body: IUpdateGuestBody,
    id: number,
): Promise<{ user: IUser; account: IAccount } | number> => {
    try {
        return await withTransaction(async () => {
            const { restaurant_id, salary, ...userBody } = body.user || {};
            const updatedUser = await userRepository.updateUser({ payload: buildUpdatePayload(userBody), id });
            if (!updatedUser) {
                return rollback(UPDATE_GUEST.USER_NOT_FOUND);
            }

            const updatedAccount = await accountRepository.updateAccountUsername({
                payload: { username: body.account?.username },
                id: updatedUser.account_id!,
            });
            if (!updatedAccount) {
                return rollback(UPDATE_GUEST.ACCOUNT_NOT_FOUND);
            }
            return { user: updatedUser, account: updatedAccount };
        });
    } catch (error) {
        return toDuplicateCode(error) ?? UPDATE_GUEST.UPDATE_GUEST_FAILED;
    }
};

export const getGuests = async (params: ISelectQuery): Promise<IGetGuests | number> => {
    try {
        const result = await userRepository.getUsersWithAccountInfo({
            ...params,
            conditions: [hasRoleCondition(RolesEnum.GUEST)],
            returning: ["u.*", "a.username"],
        });
        return { guests: result.rows, pagination: buildPagination(params, result.totalCount) };
    } catch (error) {
        return GET_GUESTS.GET_GUESTS_FAILED;
    }
};
