import express from "express";
import cors from "cors";
import middleware from "i18next-http-middleware";

import i18n from "./config/i18n";

import { errorHandler, requestLogger } from "./middlewares";

import { accountRouter, employeeRouter } from "~/routes";

const app = express();

app.use(middleware.handle(i18n));

app.use(requestLogger);

app.use(cors());
app.use(express.json());

app.use("/api/accounts", accountRouter);
app.use("/api/employees", employeeRouter);

app.use(errorHandler);

export default app;
