import { ILoginPayload } from "~/interfaces";
import bcrypt from "bcrypt";
import { IAuth, IJwtPayload, IMe } from "~/interfaces/auth.interface";
import { accountRepository, permissionRepository, roleRepository, userRepository } from "~/repositories";
import { signAccessToken, signRefreshToken } from "~/utils/jwt";
import { createRefreshToken } from "~/repositories/refresh-token.repository";

export const login = async (payload: ILoginPayload): Promise<IAuth | null> => {
    try {
        const account = await accountRepository.getAccountByUsername(payload.username);
        if (!account) {
            return null;
        }

        const isPasswordValid = bcrypt.compareSync(payload.password, account.hash_password);
        if (!isPasswordValid) {
            return null;
        }

        const accessToken = signAccessToken({ account_id: account.id, username: account.username });
        const refreshToken = signRefreshToken(account.id);

        const hashRefreshToken = bcrypt.hashSync(refreshToken, 10);

        await createRefreshToken({
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
