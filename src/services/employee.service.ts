import { HTTP_RESPONSE } from "~/common/http-response";
import { ICreateAccount, ICreateAccountPayload, ICreateEmployeePayload, IResponse } from "~/interfaces";
import { accountRepository, employeeRepository } from "~/repositories";
import { pool } from "../config/db";
import bcrypt from "bcrypt";
import { SALT_ROUNDS } from "~/common/constant";

export const createEmployee = async (payload: ICreateEmployeePayload): Promise<IResponse<any>> => {
    try {
        const newEmployee = await employeeRepository.createEmployee(payload);

        return {
            success: true,
            statusCode: HTTP_RESPONSE.CREATED.statusCode,
            message: HTTP_RESPONSE.CREATED.message,
            data: newEmployee,
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

export const createEmployeeWithAccount = async (payload: {
    employee: ICreateEmployeePayload;
    account: ICreateAccountPayload;
}) => {
    try {
        await pool.query("BEGIN");

        const accountData: ICreateAccount = {
            username: payload.account.username,
            hash_password: bcrypt.hashSync(payload.account.password, SALT_ROUNDS),
        };
        const newAccount = await accountRepository.createAccount(accountData);
        if (!newAccount) {
            await pool.query("ROLLBACK");
            return {
                success: false,
                statusCode: HTTP_RESPONSE.BAD_REQUEST.statusCode,
                message: "Failed to create account.",
                data: null,
            };
        }

        const newEmployee = await employeeRepository.createEmployee({ ...payload.employee, account_id: newAccount.id });
        if (!newEmployee) {
            await pool.query("ROLLBACK");
            return {
                success: false,
                statusCode: HTTP_RESPONSE.BAD_REQUEST.statusCode,
                message: "Failed to create employee.",
                data: null,
            };
        }

        await pool.query("COMMIT");

        return {
            success: true,
            statusCode: HTTP_RESPONSE.CREATED.statusCode,
            message: HTTP_RESPONSE.CREATED.message,
            data: { employee: newEmployee, account: newAccount },
        };
    } catch (error) {
        await pool.query("ROLLBACK");
        return {
            success: false,
            statusCode: HTTP_RESPONSE.INTERNAL_SERVER_ERROR.statusCode,
            message: HTTP_RESPONSE.INTERNAL_SERVER_ERROR.message,
            data: null,
        };
    }
};
