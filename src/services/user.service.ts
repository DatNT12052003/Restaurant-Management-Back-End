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
} from "~/interfaces";
import { accountRepository, userRepository } from "~/repositories";
import { pool } from "../config/db";
import bcrypt from "bcrypt";
import { SALT_ROUNDS } from "~/common/constant";
import { stringToDate } from "~/utils/common";

export const createUser = async (body: ICreateUserBody): Promise<IUser | null> => {
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
        };
        const newUser: IUser = await userRepository.createUser(payload);

        return newUser;
    } catch (error) {
        return null;
    }
};

export const createUserWithAccount = async (
    body: ICreateUserWithAccountBody,
): Promise<{ user: IUser; account: IAccount } | null> => {
    try {
        await pool.query("BEGIN");

        const accountPayload: ICreateAccountPayload = {
            username: body.account.username,
            hash_password: bcrypt.hashSync(body.account.password, SALT_ROUNDS),
        };
        const newAccount: IAccount = await accountRepository.createAccount(accountPayload);
        if (!newAccount) {
            await pool.query("ROLLBACK");
            return null;
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
        };

        const newUser: IUser = await userRepository.createUser(userPayload);
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

export const getUserByAccountId = async (account_id: number): Promise<IUser | null> => {
    try {
        const user = await userRepository.getUserByAccountId(account_id);
        if (!user) {
            return null;
        }
        return user;
    } catch (error) {
        return null;
    }
};

export const getUserByEmail = async (email: string): Promise<IUser | null> => {
    try {
        const user = await userRepository.getUserByEmail(email);
        if (!user) {
            return null;
        }
        return user;
    } catch (error) {
        return null;
    }
};
