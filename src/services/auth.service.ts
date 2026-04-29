import bcrypt from "bcrypt";
import { IAuth, IJwtPayload, ILoginBody, IMe } from "~/interfaces";
import {
    accountRepository,
    permissionRepository,
    refreshTokenRepository,
    roleRepository,
    userRepository,
} from "~/repositories";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "~/utils/jwt";
import { v4 as uuidv4 } from "uuid";
import { SALT_ROUNDS } from "~/common/constant";

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

        await refreshTokenRepository.createRefreshToken({
            jti,
            hash_token: hashRefreshToken,
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
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

export const getMe = async (payload: IJwtPayload): Promise<IMe | null> => {
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

        const storedToken = await refreshTokenRepository.getRefreshTokenByJti(payload.jti);

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

        await refreshTokenRepository.revokeRefreshToken(storedToken.id);
        await refreshTokenRepository.createRefreshToken({
            jti,
            hash_token: hashRefreshToken,
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
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
            const storedToken = await refreshTokenRepository.getRefreshTokenByJti(payload.jti);
            if (storedToken) {
                await refreshTokenRepository.revokeRefreshToken(storedToken.id);
            }
        }
        return true;
    } catch (error) {
        return false;
    }
};

export const logoutAll = async (account_id: number): Promise<boolean> => {
    try {
        await refreshTokenRepository.revokeAllRefreshTokensByAccountId(account_id);
        return true;
    } catch (error) {
        return false;
    }
};

// export const resetPassword = async (payload: IUpdatePasswordPayload): Promise<boolean> => {
//     try {
//         const newHashPassword = bcrypt.hashSync(payload.password, SALT_ROUNDS);
//         const updateData: IUpdatePassword = {
//             username: payload.username,
//             hash_password: newHashPassword,
//         };
//         await accountRepository.updateAccountPassword(updateData);
//         const account = await accountRepository.getAccountByUsername(payload.username);
//         if (!account) {
//             return false;
//         }
//         await refreshTokenRepository.revokeAllRefreshTokensByAccountId(account.id);
//         return true;
//     } catch (error) {
//         return false;
//     }
// };
