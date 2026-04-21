import { HTTP_RESPONSE } from "~/common/http-response";
import {
    IAccount,
    ICreateAccount,
    ICreateAccountPayload,
    ICreateEmployeePayload,
    ICreateEmployeeWithAccountPayload,
    IEmployee,
    IResponse,
} from "~/interfaces";
import { accountRepository, employeeRepository } from "~/repositories";
import { pool } from "../config/db";
import bcrypt from "bcrypt";
import { SALT_ROUNDS } from "~/common/constant";

export const createEmployee = async (payload: ICreateEmployeePayload): Promise<IEmployee | null> => {
    try {
        const newEmployee: IEmployee = await employeeRepository.createEmployee(payload);

        return newEmployee;
    } catch (error) {
        return null;
    }
};

export const createEmployeeWithAccount = async (
    payload: ICreateEmployeeWithAccountPayload,
): Promise<{ employee: IEmployee; account: IAccount } | null> => {
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

        const newEmployee: IEmployee = await employeeRepository.createEmployee({
            ...payload.employee,
            account_id: newAccount.id,
        });
        if (!newEmployee) {
            await pool.query("ROLLBACK");
            return null;
        }

        await pool.query("COMMIT");

        return { employee: newEmployee, account: newAccount };
    } catch (error) {
        await pool.query("ROLLBACK");
        return null;
    }
};
