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

export interface IGetParams {
    searchText?: string;
    searchField?: string;
    filterField?: string;
    filterValue?: string;
    orderBy?: string;
    orderType?: OrderTypeEnum;
    currentPage?: number;
    limit?: number;
}

export interface IGetDataParams extends Required<Omit<IGetParams, "currentPage">> {
    offset: number;
}
export interface IQueryResult {
    query: string;
    values: any[];
}
