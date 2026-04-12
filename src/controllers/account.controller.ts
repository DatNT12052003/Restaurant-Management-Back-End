import { Request, Response } from "express";

export const createAccount = (req: Request, res: Response) => {
    res.send("Create account");
};

export const getAccount = (req: Request, res: Response) => {
    res.send("Get account");
};

export const updateAccount = (req: Request, res: Response) => {
    res.send("Update account");
};

export const deleteAccount = (req: Request, res: Response) => {
    res.send("Delete account");
};
