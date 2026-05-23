import { Request, Response, NextFunction } from "express";
import { badRequestResponse } from "~/common/responses/error";

export const validateCreate = (req: Request, res: Response, next: NextFunction) => {
    if (!req.body || Object.keys(req.body).length === 0) {
        badRequestResponse(res, req.t("common:ERROR"));
        return;
    }
    next();
};

export const validateUpdate = (req: Request, res: Response, next: NextFunction) => {
    if (!req.body || Object.keys(req.body).length === 0) {
        badRequestResponse(res, req.t("common:ERROR"));
        return;
    }
    next();
};

export const validateLogin = (req: Request, res: Response, next: NextFunction) => {
    if (!req.body || Object.keys(req.body).length === 0) {
        badRequestResponse(res, req.t("common:ERROR"));
        return;
    }
    next();
};
