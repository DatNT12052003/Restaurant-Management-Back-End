import { TokenTypeEnum } from "~/common/enum";

export interface IToken {
    id: number;
    jti: string;
    hash_token: string;
    expires_at: Date;
    revoked: boolean;
    type: TokenTypeEnum;
    account_id: number;
    created_at: Date;
    updated_at: Date;
    deleted_at?: Date | null;
}

export interface ICreateTokenBody extends Pick<IToken, "account_id"> {}

export interface ICreateTokenPayload extends Omit<
    IToken,
    "id" | "revoked" | "created_at" | "updated_at" | "deleted_at"
> {}
