import express from "express";
import cookieParser from "cookie-parser";
import qs from "qs";
import cors from "cors";
import middleware from "i18next-http-middleware";

import i18n from "./config/i18n";

import corsOptions from "~/config/cors";

import { errorHandler, requestLogger } from "./middlewares";

import {
    accountRouter,
    authRouter,
    comboRouter,
    dishRouter,
    hrRouter,
    imageRouter,
    restaurantMenuRouter,
    tagRouter,
    permissionRouter,
    restaurantRouter,
    roleRouter,
    roomRouter,
    tableRouter,
    userRouter,
    reservationRouter,
    orderRouter,
    discountRouter,
    paymentRouter,
    inventoryRouter,
    recipeRouter,
    supplierRouter,
    purchaseOrderRouter,
    stockTransferRouter,
    payableRouter,
    ingredientRouter,
    reportRouter,
    auditLogRouter,
} from "~/routes";

const app = express();

app.set("query parser", (str: string) =>
    qs.parse(str, {
        allowDots: true,
        comma: true,
    }),
);

app.use(middleware.handle(i18n));

app.use(requestLogger);

app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/auth", authRouter);
app.use("/api/accounts", accountRouter);
app.use("/api/users", userRouter);
app.use("/api/restaurants", restaurantRouter);
app.use("/api/rooms", roomRouter);
app.use("/api/tables", tableRouter);
app.use("/api/roles", roleRouter);
app.use("/api/permissions", permissionRouter);
app.use("/api/tags", tagRouter);
app.use("/api/dishes", dishRouter);
app.use("/api/combos", comboRouter);
app.use("/api/restaurant-menus", restaurantMenuRouter);
app.use("/api/images", imageRouter);
app.use("/api/reservations", reservationRouter);
app.use("/api/orders", orderRouter);
app.use("/api/discounts", discountRouter);
app.use("/api/payments", paymentRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/ingredients", ingredientRouter);
app.use("/api/recipes", recipeRouter);
app.use("/api/suppliers", supplierRouter);
app.use("/api/purchase-orders", purchaseOrderRouter);
app.use("/api/stock-transfers", stockTransferRouter);
app.use("/api/payables", payableRouter);
app.use("/api/hr", hrRouter);
app.use("/api/reports", reportRouter);
app.use("/api/audit-logs", auditLogRouter);

app.use(errorHandler);

export default app;
