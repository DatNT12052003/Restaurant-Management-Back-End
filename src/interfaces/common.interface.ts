import { FilterOperatorEnum, JoinTypeEnum, OrderTypeEnum } from "~/common/enum";

export interface IResponse<T> {
    success: boolean;
    statusCode: number;
    message: string;
    errors?: any;
    data?: T;
}

export interface IPagination {
    limit: number;
    currentPage: number;
    totalPages: number;
    totalItems: number;
}

export interface IServiceResponse<T> {
    data: T | null;
}
export interface IQueryResult {
    query: string;
    values: any[];
}

export interface IGetQuery {
    search?: {
        text: string;
        fields: string[];
    };
    filters?: {
        field: string;
        operator?: FilterOperatorEnum;
        value: any;
    }[];
    orderBy?: {
        field: string;
        direction?: OrderTypeEnum;
    }[];
    currentPage?: number;
    limit?: number;
}

export interface ISelectQuery extends Omit<IGetQuery, "currentPage"> {
    joins?: {
        type?: JoinTypeEnum;
        table: string;
        on: string;
    }[];
    offset?: number;
    returning?: string[];
}

export interface ISendEmail {
    to: string;
    subject: string;
    html: string;
}
