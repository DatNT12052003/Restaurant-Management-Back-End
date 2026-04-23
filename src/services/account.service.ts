import { IAccount, ICreateAccount, ICreateAccountPayload, IGetAccounts, IGetDataParams, IResponse } from "~/interfaces";
import bcrypt from "bcrypt";
import { SALT_ROUNDS } from "~/common/constant";
import { accountRepository } from "~/repositories";
import { getAccountsResource } from "~/resources";

export const createAccount = async (payload: ICreateAccountPayload): Promise<IAccount | null> => {
    try {
        const accountData: ICreateAccount = {
            username: payload.username,
            hash_password: bcrypt.hashSync(payload.password, SALT_ROUNDS),
        };

        const newAccount = await accountRepository.createAccount(accountData);

        return newAccount;
    } catch (error) {
        return null;
    }
};

export const getAccounts = async (params: IGetDataParams): Promise<IGetAccounts | null> => {
    try {
        const result = await accountRepository.getAccounts(params);

        const data: IGetAccounts = {
            accounts: getAccountsResource(result.rows),
            pagination: {
                limit: params.limit,
                currentPage: params.offset / params.limit + 1,
                totalPages: result.totalPages,
                totalItems: result.totalItems,
            },
        };
        return data;
    } catch (error) {
        return null;
    }
};
