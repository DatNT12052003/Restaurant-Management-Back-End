import { z } from "zod";
import { idParamSchema, stringArray } from "./common.schema";

const permissionsBody = z.object({
    permissions: stringArray(),
});

export const updateRolePermissionsSchema = z.object({ params: idParamSchema, body: permissionsBody });
export const updateUserPermissionsSchema = z.object({ params: idParamSchema, body: permissionsBody });
