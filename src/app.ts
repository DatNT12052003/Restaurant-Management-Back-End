import express from "express";
import cors from "cors";

import { errorHandler, requestLogger } from "./middlewares";

import { accountRouter } from "~/routes";

const app = express();

app.use(requestLogger);

app.use(cors());
app.use(express.json());

app.use("/accounts", accountRouter);

app.use(errorHandler);

export default app;
