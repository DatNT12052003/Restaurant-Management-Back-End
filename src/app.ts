import express from "express";
import qs from "qs";
import cors from "cors";
import middleware from "i18next-http-middleware";

import i18n from "./config/i18n";

import { errorHandler, requestLogger } from "./middlewares";

import { accountRouter, authRouter, userRouter } from "~/routes";

const app = express();

app.set("query parser", (str: string) =>
    qs.parse(str, {
        allowDots: true,
        comma: true,
    }),
);

app.use(middleware.handle(i18n));

app.use(requestLogger);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/auth", authRouter);
app.use("/api/accounts", accountRouter);
app.use("/api/users", userRouter);

app.use(errorHandler);

export default app;
