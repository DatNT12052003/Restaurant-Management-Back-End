export interface IRefreshToken {
    id: number;
    jti: string;
    hash_token: string;
    expires_at: Date;
    revoked: boolean;
    account_id: number;
    created_at: Date;
    updated_at: Date;
    deleted_at?: Date | null;
}

export interface ICreateRefreshTokenPayload extends Omit<
    IRefreshToken,
    "id" | "revoked" | "created_at" | "updated_at" | "deleted_at"
> {}
