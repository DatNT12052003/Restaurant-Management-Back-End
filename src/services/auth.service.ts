import bcrypt from "bcrypt";
import { IAuth, IJwtAccountPayload, ILoginBody, IMe, IUpdatePasswordBody, IUpdatePasswordPayload } from "~/interfaces";
import {
    accountRepository,
    permissionRepository,
    tokenRepository,
    roleRepository,
    userRepository,
} from "~/repositories";
import { signAccessToken, signRefreshToken, verifyRefreshToken, verifyResetPasswordToken } from "~/utils/jwt";
import { v4 as uuidv4 } from "uuid";
import { SALT_ROUNDS } from "~/common/constant";
import { TokenTypeEnum } from "~/common/enum";
import { GET_ME, LOGIN, LOGOUT, LOGOUT_ALL, REFRESH_TOKEN, RESET_PASSWORD } from "~/common/error-code/auth";

export const login = async (body: ILoginBody): Promise<IAuth | number> => {
    try {
        const account = await accountRepository.getAccountByUsername(body.username);
        if (!account) {
            return LOGIN.NOT_EXIST;
        }

        const isPasswordValid = bcrypt.compareSync(body.password, account.hash_password);
        if (!isPasswordValid) {
            return LOGIN.INVALID_USERNAME_PASSWORD;
        }

        const accessToken = signAccessToken({ account_id: account.id, username: account.username });
        const jti = uuidv4();
        const refreshToken = signRefreshToken({ account_id: account.id, username: account.username, jti: jti });

        const hashRefreshToken = bcrypt.hashSync(refreshToken, 10);

        await tokenRepository.createToken({
            jti,
            hash_token: hashRefreshToken,
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            type: TokenTypeEnum.REFRESH,
            account_id: account.id,
        });

        const authData: IAuth = {
            account_id: account.id,
            username: account.username,
            access_token: accessToken,
            refresh_token: refreshToken,
        };
        return authData;
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
        const accessToken = signAccessToken({ account_id: account.id, username: account.username });
        const jti = uuidv4();
        const newRefreshToken = signRefreshToken({ account_id: account.id, username: account.username, jti: jti });

        const hashRefreshToken = bcrypt.hashSync(newRefreshToken, 10);

        await tokenRepository.revokeToken(storedToken.id);
        await tokenRepository.createToken({
            jti,
            hash_token: hashRefreshToken,
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            type: TokenTypeEnum.REFRESH,
            account_id: account.id,
        });

        const authData: IAuth = {
            account_id: account.id,
            username: account.username,
            access_token: accessToken,
            refresh_token: newRefreshToken,
        };
        return authData;
    } catch (error) {
        return REFRESH_TOKEN.REFRESH_TOKEN_FAILED;
    }
};

export const logout = async (refresh_token: string): Promise<number> => {
    try {
        const payload = verifyRefreshToken(refresh_token);
        if (payload && payload.jti) {
            const storedToken = await tokenRepository.getTokenByJti(payload.jti);
            if (storedToken) {
                await tokenRepository.revokeToken(storedToken.id);
            }
        }
        return LOGOUT.LOGOUT_SUCCESS;
    } catch (error) {
        return LOGOUT.LOGOUT_FAILED;
    }
};

export const logoutAll = async (account_id: number): Promise<number> => {
    try {
        await tokenRepository.revokeAllRefreshTokensByAccountId(account_id);
        return LOGOUT_ALL.LOGOUT_ALL_SUCCESS;
    } catch (error) {
        return LOGOUT_ALL.LOGOUT_ALL_FAILED;
    }
};

export const resetPassword = async (body: IUpdatePasswordBody): Promise<number> => {
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
        return RESET_PASSWORD.RESET_PASSWORD_SUCCESS;
    } catch (error) {
        return RESET_PASSWORD.RESET_PASSWORD_FAILED;
    }
};
