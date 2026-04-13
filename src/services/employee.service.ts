import { HTTP_RESPONSE } from "~/common/http-response";
import { ICreateEmployeePayload, IResponse } from "~/interfaces";
import { employeeRepository } from "~/repositories";

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
