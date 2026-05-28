import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import { TokenTypeEnum } from "~/common/enum";
import { CREATE_RESET_PASSWORD_TOKEN } from "~/common/error-code/token";
import { ICreateTokenBody, IToken } from "~/interfaces";
import { accountRepository, tokenRepository } from "~/repositories";
import { signResetPasswordToken } from "~/utils/jwt";

export const createResetPasswordToken = async (body: ICreateTokenBody): Promise<string | number> => {
    try {
        const account = await accountRepository.getAccountById(body.account_id);
        if (!account) {
            return CREATE_RESET_PASSWORD_TOKEN.ACCOUNT_NOT_FOUND;
        }
        const jti = uuidv4();
        const resetPasswordToken = signResetPasswordToken({
            account_id: account.id,
            username: account.username,
            jti,
        });
        const hashResetPasswordToken = bcrypt.hashSync(resetPasswordToken, 10);

        const payload = {
            jti,
            hash_token: hashResetPasswordToken,
            expires_at: new Date(Date.now() + 5 * 60 * 1000),
            type: TokenTypeEnum.RESET_PASSWORD,
            account_id: account.id,
        };

        await tokenRepository.createToken(payload);

        return resetPasswordToken;
    } catch (error) {
        return CREATE_RESET_PASSWORD_TOKEN.CREATE_RESET_PASSWORD_TOKEN_FAILED;
    }
};
