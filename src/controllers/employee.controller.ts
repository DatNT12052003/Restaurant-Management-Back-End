import { Request, Response } from "express";
import { badRequestResponse, createErrorResponse, serverErrorResponse } from "~/common/responses/error";
import { createSuccessResponse } from "~/common/responses/success";
import { ICreateEmployeePayload, IResponse } from "~/interfaces";
import { employeeService } from "~/services";

export const createEmployee = async (req: Request, res: Response) => {
    try {
        const {
            full_name,
            date_of_birth,
            gender,
            address,
            email,
            phone_number,
            avatar_url,
            status,
        }: ICreateEmployeePayload = req.body;

        if (!full_name) {
            return badRequestResponse(res, req.t("employee:FULL_NAME_REQUIRED"));
        }

        const response: IResponse<any> = await employeeService.createEmployee({
            full_name,
            date_of_birth,
            gender,
            address: address,
            email: email,
            phone_number: phone_number,
            avatar_url: avatar_url,
            status: status,
        });

        if (!response.success) {
            return createErrorResponse(res, req.t("employee:ERROR_CREATING_EMPLOYEE"));
        }

        return createSuccessResponse(res, req.t("employee:EMPLOYEE_CREATED_SUCCESSFULLY"), response.data);
    } catch (error) {
        serverErrorResponse(res);
    }
};

export const createEmployeeWithAccount = async (req: Request, res: Response) => {
    try {
        const { employee, account } = req.body;

        const response = await employeeService.createEmployeeWithAccount({ employee, account });

        if (!response.success) {
            return createErrorResponse(res, req.t("employee:ERROR_CREATING_EMPLOYEE_WITH_ACCOUNT"));
        }

        return createSuccessResponse(res, req.t("employee:EMPLOYEE_WITH_ACCOUNT_CREATED_SUCCESSFULLY"), response.data);
    } catch (error) {
        serverErrorResponse(res);
    }
};
