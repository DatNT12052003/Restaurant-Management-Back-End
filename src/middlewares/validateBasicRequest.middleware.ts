import { Request, Response, NextFunction } from "express";
import { badRequestResponse } from "~/common/responses/error";

export const validateCreate = (req: Request, res: Response, next: NextFunction) => {
    if (!req.body || Object.keys(req.body).length === 0) {
        return badRequestResponse(res, req.t("common:ERROR"));
    }
    next();
};

export const validateUpdate = (req: Request, res: Response, next: NextFunction) => {
    if (!req.body || Object.keys(req.body).length === 0) {
        return badRequestResponse(res, req.t("common:ERROR"));
    }
    next();
};

export const validateUpdateUser = (req: Request, res: Response, next: NextFunction) => {
    console.log("CHECK = ", !req.body, Object.keys(req.body).length === 0);
    if (!req.body || Object.keys(req.body).length === 0) {
        return badRequestResponse(res, "Loi o day");
    }
    next();
};

export const validateLogin = (req: Request, res: Response, next: NextFunction) => {
    if (!req.body || Object.keys(req.body).length === 0) {
        return badRequestResponse(res, req.t("common:ERROR"));
    }
    next();
};
