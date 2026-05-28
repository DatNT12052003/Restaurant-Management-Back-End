import { IAccount, ICreateAccountBody, ICreateAccountPayload, IGetAccounts, ISelectQuery } from "~/interfaces";
import bcrypt from "bcrypt";
import { SALT_ROUNDS } from "~/common/constant";
import { accountRepository } from "~/repositories";
import { getAccountsResource } from "~/resources";
import { CREATE_ACCOUNT, GET_ACCOUNT_BY_ID, GET_ACCOUNT_BY_USERNAME, GET_ACCOUNTS } from "~/common/error-code/account";

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
