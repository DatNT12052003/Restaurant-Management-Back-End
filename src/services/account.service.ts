import { ICreateAccount, ICreateAccountPayload, IGetAccounts, IGetDataParams, IResponse } from "~/interfaces";
import bcrypt from "bcrypt";
import { SALT_ROUNDS } from "~/common/constant";
import { accountRepository } from "~/repositories";
import { HTTP_RESPONSE } from "~/common/http-response";
import { getAccountsResource } from "~/resources";
import { off } from "node:cluster";

export const createAccount = async (payload: ICreateAccountPayload): Promise<IResponse<any>> => {
    try {
        const accountData: ICreateAccount = {
            username: payload.username,
            hash_password: bcrypt.hashSync(payload.password, SALT_ROUNDS),
        };

        const newAccount = await accountRepository.createAccount(accountData);

        return {
            success: true,
            statusCode: HTTP_RESPONSE.CREATED.statusCode,
            message: HTTP_RESPONSE.CREATED.message,
            data: newAccount,
        };
    } catch (error) {
        return {
            success: false,
            statusCode: HTTP_RESPONSE.BAD_REQUEST.statusCode,
            message: HTTP_RESPONSE.BAD_REQUEST.message,
            data: null,
        };
    }
};

export const getAccounts = async (params: IGetDataParams): Promise<IResponse<IGetAccounts | null>> => {
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
        return {
            success: true,
            statusCode: HTTP_RESPONSE.SUCCESS.statusCode,
            message: HTTP_RESPONSE.SUCCESS.message,
            data: data,
        };
    } catch (error) {
        return {
            success: false,
            statusCode: HTTP_RESPONSE.BAD_REQUEST.statusCode,
            message: HTTP_RESPONSE.BAD_REQUEST.message,
            data: null,
        };
    }
};
