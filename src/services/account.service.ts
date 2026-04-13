import { ICreateAccount, ICreateAccountPayload, IGetAccounts, IResponse } from "~/interfaces";
import bcrypt from "bcrypt";
import { SALT_ROUNDS } from "~/common/constant";
import { accountRepository } from "~/repositories";
import { HTTP_RESPONSE } from "~/common/http-response";
import { getAccountsResource } from "~/resources";

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

export const getAccounts = async (params: {
    offset: number;
    limit: number;
    currentPage: number;
    searchText: string;
    searchField: string;
    filterField: string;
    filterValue: string;
    orderBy: string;
    orderType: string;
}): Promise<IResponse<IGetAccounts | null>> => {
    try {
        const result = await accountRepository.getAccounts(
            params.offset,
            params.limit,
            params.searchText,
            params.searchField,
            params.filterField,
            params.filterValue,
            params.orderBy,
            params.orderType,
        );

        const data: IGetAccounts = {
            accounts: getAccountsResource(result.rows),
            pagination: {
                offset: params.offset,
                limit: params.limit,
                currentPage: params.currentPage,
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
