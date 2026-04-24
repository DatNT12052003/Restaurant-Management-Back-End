import { HTTP_RESPONSE } from "~/common/http-response";
import {
    IAccount,
    ICreateAccount,
    ICreateAccountPayload,
    ICreateUserPayload,
    ICreateUserWithAccountPayload,
    IUser,
    IResponse,
} from "~/interfaces";
import { accountRepository, userRepository } from "~/repositories";
import { pool } from "../config/db";
import bcrypt from "bcrypt";
import { SALT_ROUNDS } from "~/common/constant";
import { string } from "zod";
import { stringToDate } from "~/utils/common";

export const createUser = async (payload: ICreateUserPayload): Promise<IUser | null> => {
    try {
        const newUser: IUser = await userRepository.createUser({
            ...payload,
            date_of_birth: stringToDate(payload.date_of_birth),
        });

        return newUser;
    } catch (error) {
        return null;
    }
};

export const createUserWithAccount = async (
    payload: ICreateUserWithAccountPayload,
): Promise<{ user: IUser; account: IAccount } | null> => {
    try {
        await pool.query("BEGIN");

        const accountData: ICreateAccount = {
            username: payload.account.username,
            hash_password: bcrypt.hashSync(payload.account.password, SALT_ROUNDS),
        };
        const newAccount: IAccount = await accountRepository.createAccount(accountData);
        if (!newAccount) {
            await pool.query("ROLLBACK");
            return null;
        }

        const newUser: IUser = await userRepository.createUser({
            ...payload.user,
            date_of_birth: stringToDate(payload.user.date_of_birth),
            account_id: newAccount.id,
        });
        if (!newUser) {
            await pool.query("ROLLBACK");
            return null;
        }

        await pool.query("COMMIT");

        return { user: newUser, account: newAccount };
    } catch (error) {
        await pool.query("ROLLBACK");
        return null;
    }
};
