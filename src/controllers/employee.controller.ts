import { Request, Response } from "express";
import { badRequestResponse, createErrorResponse, serverErrorResponse } from "~/common/responses/error";
import { createSuccessResponse } from "~/common/responses/success";
import {
    IAccount,
    ICreateEmployeePayload,
    ICreateEmployeeWithAccountPayload,
    IEmployee,
    IResponse,
} from "~/interfaces";
import { employeeService } from "~/services";

export const createEmployee = async (req: Request, res: Response) => {
    try {
        const body: ICreateEmployeePayload = req.body;

        if (!body.full_name) {
            return badRequestResponse(res, req.t("employee:FULL_NAME_REQUIRED"));
        }

        if (!req.file) {
            body.avatar_url = null;
        }

        const newEmployee: IEmployee | null = await employeeService.createEmployee(body);

        if (!newEmployee) {
            return createErrorResponse(res, req.t("employee:ERROR_CREATING_EMPLOYEE"));
        }

        return createSuccessResponse(res, req.t("employee:EMPLOYEE_CREATED_SUCCESSFULLY"), newEmployee);
    } catch (error) {
        serverErrorResponse(res);
    }
};

export const createEmployeeWithAccount = async (req: Request, res: Response) => {
    try {
        const body: ICreateEmployeeWithAccountPayload = req.body;

        if (!body.employee.full_name) {
            return badRequestResponse(res, req.t("employee:FULL_NAME_REQUIRED"));
        }

        if (!req.file) {
            body.employee.avatar_url = null;
        } else {
            body.employee.avatar_url = req.file.path;
        }

        const newEmployeeWithAccount: { employee: IEmployee; account: IAccount } | null =
            await employeeService.createEmployeeWithAccount(body);

        if (!newEmployeeWithAccount) {
            return createErrorResponse(res, req.t("employee:ERROR_CREATING_EMPLOYEE_WITH_ACCOUNT"));
        }

        return createSuccessResponse(
            res,
            req.t("employee:EMPLOYEE_WITH_ACCOUNT_CREATED_SUCCESSFULLY"),
            newEmployeeWithAccount,
        );
    } catch (error) {
        serverErrorResponse(res);
    }
};
