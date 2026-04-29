export interface IRole {
    id: number;
    name: string;
    type_name: string;
    created_at: Date;
    updated_at: Date;
    deleted_at?: Date | null;
}

export interface ICreateRoleBody extends Pick<IRole, "name" | "type_name"> {}

export interface ICreateRolePayload extends Omit<IRole, "id" | "created_at" | "updated_at" | "deleted_at"> {}
