import { HTTP_RESPONSE } from "~/common/http-response";
import {
    IAccount,
    ICreateAccountBody,
    ICreateUserBody,
    IUser,
    IResponse,
    ICreateUserWithAccountBody,
    ICreateAccountPayload,
    ICreateUserPayload,
    IUserWithAccount,
    IGetEmployees,
    IEmployee,
    ISelectQuery,
    IUpdateUserBody,
    IUpdateUserPayload,
    ICreateEmployeeBody,
    IUpdateEmployeeBody,
    IUpdateUsernamePayload,
    ICreateGuestBody,
    IUpdateGuestBody,
} from "~/interfaces";
import {
    accountRepository,
    permissionRepository,
    roleRepository,
    userRepository,
    userRoleRepository,
} from "~/repositories";
import { pool } from "../config/db";
import bcrypt from "bcrypt";
import { SALT_ROUNDS } from "~/common/constant";
import { stringToDate } from "~/utils/common";
import { RolesEnum } from "~/common/enum";
import {
    CREATE_EMPLOYEE,
    CREATE_GUEST,
    CREATE_USER,
    CREATE_USER_WITH_ACCOUNT,
    DELETE_USER,
    GET_EMPLOYEES_BY_RESTAURANT_ID,
    GET_INFO_EMPLOYEE_BY_USER_ID,
    GET_USER_BY_ACCOUNT_ID,
    GET_USER_BY_EMAIL,
    UPDATE_EMPLOYEE,
    UPDATE_GUEST,
    UPDATE_USER,
} from "~/common/error-code/user";
import { getRolesByTypeNames } from "~/repositories/role.repository";

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
        const newUser: IUser = await userRepository.createUser(payload);

        return newUser;
    } catch (error) {
        return CREATE_USER.CREATE_USER_FAILED;
    }
};

export const createUserWithAccount = async (
    body: ICreateUserWithAccountBody,
): Promise<{ user: IUser; account: IAccount } | number> => {
    try {
        await pool.query("BEGIN");

        const accountPayload: ICreateAccountPayload = {
            username: body.account.username,
            hash_password: bcrypt.hashSync(body.account.password, SALT_ROUNDS),
        };
        const newAccount: IAccount = await accountRepository.createAccount(accountPayload);
        if (!newAccount) {
            await pool.query("ROLLBACK");
            return CREATE_USER_WITH_ACCOUNT.CREATE_ACCOUNT_FAILED;
        }

        const userPayload: ICreateUserPayload = {
            full_name: body.user.full_name,
            date_of_birth: stringToDate(body.user.date_of_birth),
            gender: body.user.gender,
            address: body.user.address,
            email: body.user.email,
            phone_number: body.user.phone_number,
            avatar_url: body.user.avatar_url,
            account_id: newAccount.id,
            restaurant_id: body.user.restaurant_id || null,
        };

        const newUser: IUser = await userRepository.createUser(userPayload);
        if (!newUser) {
            await pool.query("ROLLBACK");
            return CREATE_USER_WITH_ACCOUNT.CREATE_USER_FAILED;
        }

        await pool.query("COMMIT");

        return { user: newUser, account: newAccount };
    } catch (error) {
        await pool.query("ROLLBACK");
        return CREATE_USER_WITH_ACCOUNT.CREATE_USER_WITH_ACCOUNT_FAILED;
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

export const getEmployeesByRestaurantId = async (
    params: ISelectQuery,
    restaurant_id: number,
): Promise<IGetEmployees | number> => {
    try {
        const result = await userRepository.getUsersWithAccountInfo(params);
        let employees: IEmployee[] = [];
        for (const user of result.rows) {
            const employeeInfo = await getInfoEmployeeByUserId(user);

            if (typeof employeeInfo === "number") {
                return GET_EMPLOYEES_BY_RESTAURANT_ID.GET_EMPLOYEES_BY_RESTAURANT_ID_FAILED;
            }

            if (employeeInfo) {
                employees.push(employeeInfo);
            }
        }
        const filteredEmployees = employees
            .filter((e) => e.employee.restaurant_id === restaurant_id)
            .filter((e) => !e.roles.includes(RolesEnum.GUEST));
        const totalCount = filteredEmployees.length;
        const totalPages = Math.ceil(totalCount / params.limit!);

        return {
            employees: filteredEmployees,
            pagination: {
                limit: params.limit!,
                currentPage: params.offset! / params.limit! + 1,
                totalPages,
                totalItems: totalCount,
            },
        };
    } catch (error) {
        return GET_EMPLOYEES_BY_RESTAURANT_ID.GET_EMPLOYEES_BY_RESTAURANT_ID_FAILED;
    }
};

export const updateUser = async (body: IUpdateUserBody, id: number): Promise<IUser | number> => {
    try {
        const payload: IUpdateUserPayload = {
            full_name: body.full_name,
            date_of_birth: stringToDate(body.date_of_birth),
            gender: body.gender,
            address: body.address,
            email: body.email,
            phone_number: body.phone_number,
            avatar_url: body.avatar_url,
            status: body.status,
            restaurant_id: body.restaurant_id,
        };

        const updatedUser = await userRepository.updateUser({ payload, id });
        if (!updatedUser) {
            return UPDATE_USER.NOT_FOUND;
        }

        return updatedUser;
    } catch (error) {
        return UPDATE_USER.UPDATE_USER_FAILED;
    }
};

export const deleteUser = async (id: number): Promise<IUser | number> => {
    try {
        await pool.query("BEGIN");
        const user = await userRepository.deleteUser(id);
        if (!user) {
            await pool.query("ROLLBACK");
            return DELETE_USER.USER_NOT_FOUND;
        }
        const account = await accountRepository.deleteAccount(user.account_id!);
        if (!account) {
            await pool.query("ROLLBACK");
            return DELETE_USER.ACCOUNT_NOT_FOUND;
        }
        await pool.query("COMMIT");
        return user;
    } catch (error) {
        await pool.query("ROLLBACK");
        return DELETE_USER.DELETE_USER_FAILED;
    }
};

export const createEmployee = async (
    body: ICreateEmployeeBody,
): Promise<{ user: IUser; account: IAccount; roles: string[] } | number> => {
    try {
        await pool.query("BEGIN");

        const createUserWithAccountBody: ICreateUserWithAccountBody = {
            user: body.user,
            account: body.account,
        };
        const newUserWithAccount = await createUserWithAccount(createUserWithAccountBody);

        if (!newUserWithAccount || typeof newUserWithAccount === "number") {
            await pool.query("ROLLBACK");
            return CREATE_EMPLOYEE.CREATE_USER_WITH_ACCOUNT_FAILED;
        }

        const userId = newUserWithAccount.user.id;

        const roles = await roleRepository.getRolesByTypeNames(body.roles);
        const roleIds = roles.map((r) => r.id);

        const rolesAssigned = await userRoleRepository.assignRolesToUser(userId, roleIds);

        if (!rolesAssigned) {
            await pool.query("ROLLBACK");
            return CREATE_EMPLOYEE.ASSIGN_ROLES_FAILED;
        }

        await pool.query("COMMIT");

        return { ...newUserWithAccount, roles: body.roles };
    } catch (error) {
        await pool.query("ROLLBACK");
        return CREATE_EMPLOYEE.CREATE_EMPLOYEE_FAILED;
    }
};

export const updateEmployee = async (
    body: IUpdateEmployeeBody,
    id: number,
): Promise<{ user: IUser; account: IAccount; roles: string[] } | number> => {
    try {
        await pool.query("BEGIN");
        const updateUserPayload: IUpdateUserPayload = {
            full_name: body.user.full_name,
            date_of_birth: stringToDate(body.user.date_of_birth),
            gender: body.user.gender,
            address: body.user.address,
            email: body.user.email,
            phone_number: body.user.phone_number,
            avatar_url: body.user.avatar_url,
            status: body.user.status,
            restaurant_id: body.user.restaurant_id,
        };
        const updatedUser = await userRepository.updateUser({ payload: updateUserPayload, id });
        if (!updatedUser) {
            await pool.query("ROLLBACK");
            return UPDATE_EMPLOYEE.USER_NOT_FOUND;
        }

        const updatedAccount = await accountRepository.updateAccountUsername({
            payload: { username: body.account.username },
            id: updatedUser.account_id!,
        });

        if (!updatedAccount) {
            await pool.query("ROLLBACK");
            return UPDATE_EMPLOYEE.ACCOUNT_NOT_FOUND;
        }

        const currentRoles = await roleRepository.getRolesByUserId(id);
        const allRoles = await roleRepository.getRoles();

        let addRoles: string[] = [];
        let removeRoles: string[] = [];

        for (const role of body.roles) {
            if (!allRoles.some((r) => r.type_name === role)) {
                await pool.query("ROLLBACK");
                return UPDATE_EMPLOYEE.ROLE_NOT_FOUND;
            }
        }

        for (const role of body.roles) {
            if (!currentRoles.includes(role)) {
                addRoles.push(role);
            }
        }

        for (const role of currentRoles) {
            if (!body.roles.includes(role)) {
                removeRoles.push(role);
            }
        }

        const rolesEntities = await roleRepository.getRolesByTypeNames([...addRoles, ...removeRoles]);
        const addRoleIds = rolesEntities.filter((r) => addRoles.includes(r.type_name)).map((r) => r.id);
        const removeRoleIds = rolesEntities.filter((r) => removeRoles.includes(r.type_name)).map((r) => r.id);
        if (addRoleIds.length > 0) {
            const rolesAssigned = await userRoleRepository.assignRolesToUser(id, addRoleIds);
            if (!rolesAssigned) {
                await pool.query("ROLLBACK");
                return UPDATE_EMPLOYEE.ADD_ROLES_FAILED;
            }
        }
        if (removeRoleIds.length > 0) {
            const rolesRemoved = await userRoleRepository.removeRolesFromUser(id, removeRoleIds);
            if (!rolesRemoved) {
                await pool.query("ROLLBACK");
                return UPDATE_EMPLOYEE.REMOVE_ROLES_FAILED;
            }
        }
        await pool.query("COMMIT");
        return { user: updatedUser, account: updatedAccount, roles: body.roles };
    } catch (error) {
        await pool.query("ROLLBACK");
        return UPDATE_EMPLOYEE.UPDATE_EMPLOYEE_FAILED;
    }
};

export const createGuest = async (body: ICreateGuestBody): Promise<{ user: IUser; account: IAccount } | number> => {
    try {
        await pool.query("BEGIN");
        const newGuest = await createUserWithAccount(body);

        if (!newGuest || typeof newGuest === "number") {
            await pool.query("ROLLBACK");
            return CREATE_GUEST.CREATE_USER_WITH_ACCOUNT_FAILED;
        }

        const userId = newGuest.user.id;

        const roles = await getRolesByTypeNames([RolesEnum.GUEST]);
        const roleIds = roles.map((r) => r.id);
        if (!roleIds || roleIds.length === 0) {
            await pool.query("ROLLBACK");
            return CREATE_GUEST.ASSIGN_ROLES_FAILED;
        }

        const roleAssigned = await userRoleRepository.assignRolesToUser(userId, roleIds);
        if (!roleAssigned) {
            await pool.query("ROLLBACK");
            return CREATE_GUEST.ASSIGN_ROLES_FAILED;
        }

        await pool.query("COMMIT");
        return newGuest;
    } catch (error) {
        await pool.query("ROLLBACK");
        return CREATE_GUEST.CREATE_GUEST_FAILED;
    }
};

export const updateGuest = async (
    body: IUpdateGuestBody,
    id: number,
): Promise<{ user: IUser; account: IAccount } | number> => {
    try {
        await pool.query("BEGIN");
        const updateUserPayload: IUpdateUserPayload = {
            full_name: body.user.full_name,
            date_of_birth: stringToDate(body.user.date_of_birth),
            gender: body.user.gender,
            address: body.user.address,
            email: body.user.email,
            phone_number: body.user.phone_number,
            avatar_url: body.user.avatar_url,
            status: body.user.status,
            restaurant_id: body.user.restaurant_id,
        };
        const updatedUser = await userRepository.updateUser({ payload: updateUserPayload, id });
        if (!updatedUser) {
            await pool.query("ROLLBACK");
            return UPDATE_GUEST.USER_NOT_FOUND;
        }

        const updatedAccount = await accountRepository.updateAccountUsername({
            payload: { username: body.account.username },
            id: updatedUser.account_id!,
        });

        if (!updatedAccount) {
            await pool.query("ROLLBACK");
            return UPDATE_GUEST.ACCOUNT_NOT_FOUND;
        }
        await pool.query("COMMIT");
        return { user: updatedUser, account: updatedAccount };
    } catch (error) {
        await pool.query("ROLLBACK");
        return UPDATE_GUEST.UPDATE_GUEST_FAILED;
    }
};

const getInfoEmployeeByUserId = async (user: IUserWithAccount): Promise<IEmployee | number> => {
    try {
        const roles = await roleRepository.getRolesByUserId(user.id);
        const permissions = await permissionRepository.getPermissionsByUserId(user.id);
        return {
            employee: user,
            roles,
            permissions,
        };
    } catch (error) {
        return GET_INFO_EMPLOYEE_BY_USER_ID.GET_INFO_EMPLOYEE_BY_USER_ID_FAILED;
    }
};
