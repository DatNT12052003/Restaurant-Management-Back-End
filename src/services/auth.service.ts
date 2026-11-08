import bcrypt from "bcrypt";
import {
    IAccount,
    IAuditContext,
    IAuth,
    IChangePasswordBody,
    ICreateGuestBody,
    IJwtAccountPayload,
    ILoginBody,
    IMe,
    IUpdatePasswordBody,
    IUpdatePasswordPayload,
    IUser,
} from "~/interfaces";
import {
    accountRepository,
    permissionRepository,
    tokenRepository,
    roleRepository,
    userRepository,
} from "~/repositories";
import { signAccessToken, signRefreshToken, verifyRefreshToken, verifyResetPasswordToken } from "~/utils/jwt";
import { v4 as uuidv4 } from "uuid";
import { LOGIN_LOCK_MINUTES, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MINUTES, SALT_ROUNDS } from "~/common/constant";
import { TokenTypeEnum } from "~/common/enum";

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Cấp access token + refresh token mới (lưu hash refresh token vào DB). */
const issueTokens = async (account: Pick<IAccount, "id" | "username">): Promise<IAuth> => {
    const accessToken = signAccessToken({ account_id: account.id, username: account.username });
    const jti = uuidv4();
    const refreshToken = signRefreshToken({ account_id: account.id, username: account.username, jti });

    await tokenRepository.createToken({
        jti,
        hash_token: bcrypt.hashSync(refreshToken, 10),
        expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        type: TokenTypeEnum.REFRESH,
        account_id: account.id,
    });

    return {
        account_id: account.id,
        username: account.username,
        access_token: accessToken,
        refresh_token: refreshToken,
    };
};

/** Nhân viên đã nghỉ (status = inactive) không được đăng nhập / refresh. */
const isAccountDisabled = async (accountId: number): Promise<boolean> => {
    const user = await userRepository.getUserByAccountId(accountId);
    return !!user && user.status === UserStatusEnum.INACTIVE;
};
import {
    CHANGE_PASSWORD,
    GET_ME,
    LOGIN,
    LOGOUT,
    LOGOUT_ALL,
    REFRESH_TOKEN,
    REGISTER,
    RESET_PASSWORD,
} from "~/common/error-code/auth";
import { UserStatusEnum } from "~/common/enum";
import { userService } from ".";
import { AUDIT_ACTION, writeAuditSafe } from "~/utils/audit";

export const register = async (body: ICreateGuestBody): Promise<{ user: IUser; account: IAccount } | number> => {
    try {
        const result = await userService.createGuest(body);
        return result;
    } catch (error) {
        return REGISTER.REGISTER_FAILED;
    }
};
/** Đăng nhập; mọi lần thành công / thất bại đều ghi audit log (đặc tả 4.11). */
export const login = async (body: ILoginBody, ctx: IAuditContext = {}): Promise<IAuth | number> => {
    try {
        const account = await accountRepository.getAccountByUsername(body.username);
        if (!account) {
            await writeAuditSafe(ctx, {
                action: AUDIT_ACTION.LOGIN_FAILED,
                entity_type: "account",
                restaurant_id: null,
                actor_name: body.username,
                after: { reason: "not_exist", username: body.username },
            });
            return LOGIN.NOT_EXIST;
        }

        const actor = { ...ctx, accountId: account.id };
        const failed = (reason: string) =>
            writeAuditSafe(actor, {
                action: AUDIT_ACTION.LOGIN_FAILED,
                entity_type: "account",
                entity_id: account.id,
                after: { reason },
            });

        // Đang bị khóa: không kiểm tra mật khẩu (không để lộ mật khẩu đúng hay sai trong lúc khóa)
        if (account.locked_until && new Date(account.locked_until) > new Date()) {
            await failed("locked");
            return LOGIN.ACCOUNT_LOCKED;
        }

        const isPasswordValid = bcrypt.compareSync(body.password, account.hash_password);
        if (!isPasswordValid) {
            await failed("invalid_password");
            const result = await accountRepository.registerFailedLogin(
                account.id,
                LOGIN_MAX_ATTEMPTS,
                LOGIN_WINDOW_MINUTES,
                LOGIN_LOCK_MINUTES,
            );
            if (result?.locked_until) {
                await writeAuditSafe(actor, {
                    action: AUDIT_ACTION.ACCOUNT_LOCKED,
                    entity_type: "account",
                    entity_id: account.id,
                    after: { locked_until: result.locked_until, attempts: LOGIN_MAX_ATTEMPTS },
                });
                return LOGIN.ACCOUNT_LOCKED;
            }
            return LOGIN.INVALID_USERNAME_PASSWORD;
        }

        if (await isAccountDisabled(account.id)) {
            await failed("account_disabled");
            return LOGIN.ACCOUNT_DISABLED;
        }

        await accountRepository.registerSuccessfulLogin(account.id);
        const auth = await issueTokens(account);
        await writeAuditSafe(actor, { action: AUDIT_ACTION.LOGIN, entity_type: "account", entity_id: account.id });
        return auth;
    } catch (error) {
        return LOGIN.LOGIN_FAILED;
    }
};

export const getMe = async (payload: IJwtAccountPayload): Promise<IMe | number> => {
    try {
        const user = await userRepository.getUserByAccountId(payload.account_id);
        if (!user) {
            return GET_ME.USER_NOT_FOUND;
        }

        const roles = await roleRepository.getRolesByUserId(user.id);
        if (!roles) {
            return GET_ME.ROLES_NOT_FOUND;
        }

        const permissions = await permissionRepository.getPermissionsByUserId(user.id);
        if (!permissions) {
            return GET_ME.PERMISSIONS_NOT_FOUND;
        }

        const meData: IMe = {
            account_id: payload.account_id,
            username: payload.username,
            user,
            roles: roles,
            permissions: permissions,
        };
        return meData;
    } catch (error) {
        return GET_ME.GET_ME_FAILED;
    }
};

export const refreshToken = async (refreshToken: string): Promise<IAuth | number> => {
    try {
        const payload = verifyRefreshToken(refreshToken);

        if (!payload || !payload.jti) {
            return REFRESH_TOKEN.INVALID_TOKEN;
        }

        const storedToken = await tokenRepository.getTokenByJti(payload.jti);

        if (!storedToken) {
            return REFRESH_TOKEN.TOKEN_NOT_FOUND;
        }

        const isTokenValid = bcrypt.compareSync(refreshToken, storedToken.hash_token);
        if (!isTokenValid || storedToken.revoked || storedToken.expires_at < new Date()) {
            return REFRESH_TOKEN.INVALID_TOKEN;
        }

        const account = await accountRepository.getAccountById(payload.account_id);
        if (!account) {
            return REFRESH_TOKEN.ACCOUNT_NOT_FOUND;
        }
        if (await isAccountDisabled(account.id)) {
            await tokenRepository.revokeToken(storedToken.id);
            return REFRESH_TOKEN.ACCOUNT_DISABLED;
        }

        await tokenRepository.revokeToken(storedToken.id);
        return await issueTokens(account);
    } catch (error) {
        return REFRESH_TOKEN.REFRESH_TOKEN_FAILED;
    }
};

export const logout = async (refresh_token: string, ctx: IAuditContext = {}): Promise<number> => {
    try {
        const payload = verifyRefreshToken(refresh_token);
        if (payload && payload.jti) {
            const storedToken = await tokenRepository.getTokenByJti(payload.jti);
            if (storedToken) {
                await tokenRepository.revokeToken(storedToken.id);
                if (!storedToken.revoked) {
                    await writeAuditSafe(
                        { ...ctx, accountId: payload.account_id },
                        { action: AUDIT_ACTION.LOGOUT, entity_type: "account", entity_id: payload.account_id },
                    );
                }
            }
        }
        return LOGOUT.LOGOUT_SUCCESS;
    } catch (error) {
        return LOGOUT.LOGOUT_FAILED;
    }
};

export const logoutAll = async (account_id: number, ctx: IAuditContext = {}): Promise<number> => {
    try {
        await tokenRepository.revokeAllRefreshTokensByAccountId(account_id);
        await writeAuditSafe(
            { ...ctx, accountId: account_id },
            { action: AUDIT_ACTION.LOGOUT_ALL, entity_type: "account", entity_id: account_id },
        );
        return LOGOUT_ALL.LOGOUT_ALL_SUCCESS;
    } catch (error) {
        return LOGOUT_ALL.LOGOUT_ALL_FAILED;
    }
};

export const resetPassword = async (body: IUpdatePasswordBody, ctx: IAuditContext = {}): Promise<number> => {
    try {
        const account = verifyResetPasswordToken(body.reset_password_token);

        if (!account || !account.account_id || !account.username || !account.jti) {
            return RESET_PASSWORD.INVALID_RESET_PASSWORD_TOKEN;
        }
        const storedToken = await tokenRepository.getTokenByJti(account.jti);
        if (!storedToken) {
            return RESET_PASSWORD.INVALID_RESET_PASSWORD_TOKEN;
        }
        const isTokenValid = bcrypt.compareSync(body.reset_password_token, storedToken.hash_token);
        if (!isTokenValid || storedToken.revoked || storedToken.expires_at < new Date()) {
            return RESET_PASSWORD.INVALID_RESET_PASSWORD_TOKEN;
        }

        if (body.new_password !== body.confirm_password) {
            return RESET_PASSWORD.NEW_PASSWORD_CONFIRM_PASSWORD_NOT_MATCH;
        }

        const newHashPassword = bcrypt.hashSync(body.new_password, SALT_ROUNDS);
        const payload: IUpdatePasswordPayload = {
            hash_password: newHashPassword,
        };

        await accountRepository.updateAccountPassword({ payload, id: account.account_id });

        await tokenRepository.revokeAllTokensByAccountId(account.account_id);
        await writeAuditSafe(
            { ...ctx, accountId: account.account_id },
            { action: AUDIT_ACTION.RESET_PASSWORD, entity_type: "account", entity_id: account.account_id },
        );
        return RESET_PASSWORD.RESET_PASSWORD_SUCCESS;
    } catch (error) {
        return RESET_PASSWORD.RESET_PASSWORD_FAILED;
    }
};

/**
 * Đổi mật khẩu khi đang đăng nhập. Thu hồi mọi refresh token cũ (đăng xuất các thiết bị khác)
 * và cấp token mới cho phiên hiện tại.
 */
export const changePassword = async (
    accountId: number,
    body: IChangePasswordBody,
    ctx: IAuditContext = {},
): Promise<IAuth | number> => {
    try {
        const account = await accountRepository.getAccountById(accountId);
        if (!account) return CHANGE_PASSWORD.ACCOUNT_NOT_FOUND;

        if (!bcrypt.compareSync(body.current_password, account.hash_password)) {
            return CHANGE_PASSWORD.WRONG_CURRENT_PASSWORD;
        }
        if (body.new_password !== body.confirm_password) return CHANGE_PASSWORD.CONFIRM_NOT_MATCH;
        if (body.new_password === body.current_password) return CHANGE_PASSWORD.SAME_AS_CURRENT;

        await accountRepository.updateAccountPassword({
            payload: { hash_password: bcrypt.hashSync(body.new_password, SALT_ROUNDS) },
            id: accountId,
        });
        await tokenRepository.revokeAllRefreshTokensByAccountId(accountId);
        const auth = await issueTokens(account);
        await writeAuditSafe(
            { ...ctx, accountId },
            { action: AUDIT_ACTION.CHANGE_PASSWORD, entity_type: "account", entity_id: accountId },
        );
        return auth;
    } catch (error) {
        return CHANGE_PASSWORD.FAILED;
    }
};

/** Số phút còn bị khóa của tài khoản (làm tròn lên, tối thiểu 1); 0 nếu không bị khóa */
export const getLockRemainingMinutes = async (username: string): Promise<number> => {
    try {
        const account = await accountRepository.getAccountByUsername(username);
        if (!account?.locked_until) return 0;
        const ms = new Date(account.locked_until).getTime() - Date.now();
        return ms > 0 ? Math.max(1, Math.ceil(ms / 60_000)) : 0;
    } catch (error) {
        return 0;
    }
};
