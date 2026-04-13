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
            return badRequestResponse(res, "Full name is required.");
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
            return createErrorResponse(res, "Failed to create employee.");
        }

        return createSuccessResponse(res, response.data);
    } catch (error) {
        serverErrorResponse(res);
    }
};
