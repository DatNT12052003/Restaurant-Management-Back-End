export interface IRole {
    id: number;
    name: string;
    type_name: string;
    created_at: Date;
    updated_at: Date;
    deleted_at?: Date | null;
}

export interface ICreateRolePayload extends Omit<IRole, "id" | "created_at" | "updated_at" | "deleted_at"> {}

export interface IUpdateRolePayload extends Partial<Omit<IRole, "id" | "created_at" | "updated_at" | "deleted_at">> {}
