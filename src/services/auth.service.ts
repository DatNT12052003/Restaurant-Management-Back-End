import { ILoginPayload } from "~/interfaces";
import bcrypt from "bcrypt";
import { IAuth } from "~/interfaces/auth.interface";
import { accountRepository } from "~/repositories";
import { signAccessToken, signRefreshToken } from "~/utils/jwt";

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

        const accessToken = signAccessToken({ id: account.id, username: account.username });
        const refreshToken = signRefreshToken(account.id);

        const authData: IAuth = {
            id: account.id,
            username: account.username,
            access_token: accessToken,
            refresh_token: refreshToken,
        };
        return authData;
    } catch (error) {
        return null;
    }
};
