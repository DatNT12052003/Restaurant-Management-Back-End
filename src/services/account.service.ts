import {
    IAccount,
    IAuditContext,
    ICreateAccountBody,
    ICreateAccountPayload,
    IGetAccountList,
    IGetAccounts,
    IResetAccountPasswordBody,
    ISelectQuery,
    IUser,
} from "~/interfaces";
import bcrypt from "bcrypt";
import { SALT_ROUNDS } from "~/common/constant";
import { accountRepository, tokenRepository } from "~/repositories";
import { rollback, withTransaction } from "~/config/db";
import { AUDIT_ACTION, writeAudit } from "~/utils/audit";
import { buildPagination } from "~/utils/pagination";
import { getAccountsResource } from "~/resources";
import {
    ACCOUNT_ADMIN,
    CREATE_ACCOUNT,
    GET_ACCOUNT_BY_ID,
    GET_ACCOUNT_BY_USERNAME,
    GET_ACCOUNTS,
} from "~/common/error-code/account";

export const createAccount = async (body: ICreateAccountBody): Promise<IAccount | number> => {
    try {
        const payload: ICreateAccountPayload = {
            username: body.username,
            hash_password: bcrypt.hashSync(body.password, SALT_ROUNDS),
        };

        const newAccount = await accountRepository.createAccount(payload);

        return newAccount;
    } catch (error) {
        return CREATE_ACCOUNT.CREATE_ACCOUNT_FAILED;
    }
};

export const getAccounts = async (params: ISelectQuery): Promise<IGetAccounts | number> => {
    try {
        const result = await accountRepository.getAccounts(params);
        const totalPages = Math.ceil(result.totalCount / params.limit!);

        const data: IGetAccounts = {
            accounts: getAccountsResource(result.rows),
            pagination: {
                limit: params.limit!,
                currentPage: params.offset! / params.limit! + 1,
                totalPages,
                totalItems: result.totalCount,
            },
        };
        return data;
    } catch (error) {
        return GET_ACCOUNTS.GET_ACCOUNTS_FAILED;
    }
};

export const getAccountById = async (id: number): Promise<IAccount | number> => {
    try {
        const account = await accountRepository.getAccountById(id);
        if (!account) {
            return GET_ACCOUNT_BY_ID.ACCOUNT_NOT_FOUND;
        }
        return account;
    } catch (error) {
        return GET_ACCOUNT_BY_ID.GET_ACCOUNT_FAILED;
    }
};

export const getAccountByUsername = async (username: string): Promise<IAccount | number> => {
    try {
        const account = await accountRepository.getAccountByUsername(username);
        if (!account) {
            return GET_ACCOUNT_BY_USERNAME.ACCOUNT_NOT_FOUND;
        }
        return account;
    } catch (error) {
        return GET_ACCOUNT_BY_USERNAME.GET_ACCOUNT_FAILED;
    }
};

// ---------------------------------------------------------------------------
// Trang Tài khoản: danh sách và thao tác trên tài khoản của người dùng cấp dưới
// ---------------------------------------------------------------------------

/** Điều kiện SQL theo loại người dùng (alias `u`); giá trị cố định, không lấy từ client */
const GUEST_CONDITION = `EXISTS (
    SELECT 1 FROM user_roles ur_k JOIN roles r_k ON r_k.id = ur_k.role_id AND r_k.deleted_at IS NULL
    WHERE ur_k.user_id = u.id AND ur_k.deleted_at IS NULL AND r_k.type_name = 'guest'
)`;

export const getAccountList = async (
    params: ISelectQuery,
    options: { kind?: "employee" | "guest"; locked?: boolean },
): Promise<IGetAccountList | number> => {
    try {
        const conditions: string[] = [];
        if (options.kind === "guest") conditions.push(GUEST_CONDITION);
        if (options.kind === "employee") conditions.push(`NOT ${GUEST_CONDITION}`);
        if (options.locked) conditions.push("a.locked_until > NOW()");
        const result = await accountRepository.getAccountList({ ...params, conditions });
        return { accounts: result.rows, pagination: buildPagination(params, result.totalCount) };
    } catch (error) {
        return GET_ACCOUNTS.GET_ACCOUNTS_FAILED;
    }
};

const auditTarget = (target: IUser) => ({
    entity_type: "account",
    entity_id: target.account_id,
    restaurant_id: target.restaurant_id ?? null,
});

/** Mở khóa tài khoản bị khóa do đăng nhập sai */
export const unlockAccount = async (target: IUser, audit: IAuditContext): Promise<{ account_id: number } | number> => {
    if (!target.account_id) return ACCOUNT_ADMIN.NO_ACCOUNT;
    try {
        return await withTransaction(async () => {
            const old = await accountRepository.unlockAccount(target.account_id!);
            if (!old) return rollback(ACCOUNT_ADMIN.NO_ACCOUNT);
            await writeAudit(audit, {
                action: AUDIT_ACTION.ACCOUNT_UNLOCKED,
                ...auditTarget(target),
                before: { locked_until: old.locked_until },
                after: { locked_until: null, user_id: target.id },
            });
            return { account_id: target.account_id! };
        });
    } catch (error) {
        return ACCOUNT_ADMIN.FAILED;
    }
};

/** Thu hồi mọi refresh token: người dùng bị đăng xuất trên mọi thiết bị khi access token hết hạn */
export const logoutAllDevices = async (target: IUser, audit: IAuditContext): Promise<{ revoked: number } | number> => {
    if (!target.account_id) return ACCOUNT_ADMIN.NO_ACCOUNT;
    try {
        return await withTransaction(async () => {
            const revoked = await tokenRepository.revokeAllRefreshTokensByAccountId(target.account_id!);
            await writeAudit(audit, {
                action: AUDIT_ACTION.ACCOUNT_LOGOUT_ALL,
                ...auditTarget(target),
                after: { revoked_tokens: revoked.length, user_id: target.id },
            });
            return { revoked: revoked.length };
        });
    } catch (error) {
        return ACCOUNT_ADMIN.FAILED;
    }
};

/** Đặt mật khẩu mới cho người dùng (quên mật khẩu, không có email); mở khóa và đăng xuất mọi thiết bị */
export const resetAccountPassword = async (
    target: IUser,
    body: IResetAccountPasswordBody,
    audit: IAuditContext,
): Promise<{ account_id: number } | number> => {
    if (!target.account_id) return ACCOUNT_ADMIN.NO_ACCOUNT;
    try {
        return await withTransaction(async () => {
            await accountRepository.updateAccountPassword({
                payload: { hash_password: bcrypt.hashSync(body.new_password, SALT_ROUNDS) },
                id: target.account_id!,
            });
            await accountRepository.unlockAccount(target.account_id!);
            await tokenRepository.revokeAllTokensByAccountId(target.account_id!);
            await writeAudit(audit, {
                action: AUDIT_ACTION.ACCOUNT_RESET_PASSWORD,
                ...auditTarget(target),
                after: { user_id: target.id },
            });
            return { account_id: target.account_id! };
        });
    } catch (error) {
        return ACCOUNT_ADMIN.FAILED;
    }
};
