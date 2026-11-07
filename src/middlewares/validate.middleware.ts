import { Request, Response, NextFunction } from "express";
import { ZodType, ZodError } from "zod";
import { HTTP_RESPONSE } from "~/common/http-response";

export const validate = (schema: ZodType) => async (req: Request, res: Response, next: NextFunction) => {
    try {
        // Express 5 để req.body = undefined khi request không có body (ví dụ GET)
        const validatedData = (await schema.parseAsync({
            body: req.body ?? {},
            query: req.query,
            params: req.params,
        })) as { body: any; query: any; params: any };

        if (validatedData.body !== undefined) req.body = Object.assign(req.body ?? {}, validatedData.body);
        if (validatedData.query !== undefined) Object.assign(req.query, validatedData.query);
        if (validatedData.params !== undefined) Object.assign(req.params, validatedData.params);

        return next();
    } catch (error) {
        if (error instanceof ZodError) {
            return res.status(HTTP_RESPONSE.BAD_REQUEST.statusCode).json({
                success: false,
                statusCode: HTTP_RESPONSE.BAD_REQUEST.statusCode,
                message: HTTP_RESPONSE.BAD_REQUEST.message,
                data: null,
                errors: error.issues.map((issue) => ({
                    path: issue.path.join("."),
                    message: typeof req.t === "function" ? req.t(issue.message) : issue.message,
                })),
            });
        }
        return next(error);
    }
};
