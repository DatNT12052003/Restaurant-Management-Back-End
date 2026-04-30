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

export const login = async (body: ILoginBody): Promise<IAuth | null> => {
    try {
        const account = await accountRepository.getAccountByUsername(body.username);
        if (!account) {
            return null;
        }

        const isPasswordValid = bcrypt.compareSync(body.password, account.hash_password);
        if (!isPasswordValid) {
            return null;
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
        return null;
    }
};

export const getMe = async (payload: IJwtAccountPayload): Promise<IMe | null> => {
    try {
        const user = await userRepository.getUserByAccountId(payload.account_id);
        if (!user) {
            return null;
        }

        const roles = await roleRepository.getRolesByUserId(user.id);
        const permissions = await permissionRepository.getPermissionsByUserId(user.id);
        const meData: IMe = {
            account_id: payload.account_id,
            username: payload.username,
            user,
            roles: roles,
            permissions: permissions,
        };
        return meData;
    } catch (error) {
        return null;
    }
};

export const refreshToken = async (refreshToken: string): Promise<IAuth | null> => {
    try {
        const payload = verifyRefreshToken(refreshToken);

        if (!payload || !payload.jti) {
            return null;
        }

        const storedToken = await tokenRepository.getTokenByJti(payload.jti);

        if (!storedToken) {
            return null;
        }

        const isTokenValid = bcrypt.compareSync(refreshToken, storedToken.hash_token);
        if (!isTokenValid || storedToken.revoked || storedToken.expires_at < new Date()) {
            return null;
        }

        const account = await accountRepository.getAccountById(payload.account_id);
        if (!account) {
            return null;
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
        return null;
    }
};

export const logout = async (refresh_token: string): Promise<boolean> => {
    try {
        const payload = verifyRefreshToken(refresh_token);
        if (payload && payload.jti) {
            const storedToken = await tokenRepository.getTokenByJti(payload.jti);
            if (storedToken) {
                await tokenRepository.revokeToken(storedToken.id);
            }
        }
        return true;
    } catch (error) {
        return false;
    }
};

export const logoutAll = async (account_id: number): Promise<boolean> => {
    try {
        await tokenRepository.revokeAllRefreshTokensByAccountId(account_id);
        return true;
    } catch (error) {
        return false;
    }
};

export const resetPassword = async (body: IUpdatePasswordBody): Promise<boolean> => {
    try {
        const account = verifyResetPasswordToken(body.reset_password_token);

        if (!account || !account.account_id || !account.username || !account.jti) {
            return false;
        }
        const storedToken = await tokenRepository.getTokenByJti(account.jti);
        if (!storedToken) {
            return false;
        }
        const isTokenValid = bcrypt.compareSync(body.reset_password_token, storedToken.hash_token);
        if (!isTokenValid || storedToken.revoked || storedToken.expires_at < new Date()) {
            return false;
        }

        if (body.new_password !== body.confirm_password) {
            return false;
        }

        const newHashPassword = bcrypt.hashSync(body.new_password, SALT_ROUNDS);
        const payload: IUpdatePasswordPayload = {
            hash_password: newHashPassword,
        };

        await accountRepository.updateAccountPassword({ payload, id: account.account_id });

        await tokenRepository.revokeAllTokensByAccountId(account.account_id);
        return true;
    } catch (error) {
        return false;
    }
};
