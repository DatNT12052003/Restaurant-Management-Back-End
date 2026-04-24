import { OrderTypeEnum } from "~/common/enum";

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
export interface IQueryResult {
    query: string;
    values: any[];
}

export interface ISelectQueryParams {
    searchText?: string;
    searchField?: string;
    filterField?: string;
    filterValue?: any;
    orderBy?: string;
    orderType?: OrderTypeEnum;
    offset: number;
    limit: number;
    returning?: string[];
}

export interface IGetQuery {
    search?: {
        text: string;
        fields: string[];
    };
    filters?: {
        field: string;
        operator?: "=" | "!=" | ">" | "<" | "ILIKE" | "IN" | "IS";
        value: any;
    }[];
    orderBy?: {
        field: string;
        direction?: "ASC" | "DESC";
    }[];
    currentPage?: number;
    limit?: number;
    joins?: {
        type?: "INNER" | "LEFT" | "RIGHT";
        table: string;
        on: string;
    }[];
}

export interface ISelectQuery extends Omit<IGetQuery, "currentPage"> {
    offset?: number;
    returning?: string[];
}
