import { OrderTypeEnum } from "~/common/enum";

export interface IResponse<T> {
    success: boolean;
    statusCode: number;
    message: string;
    data?: T;
}

export interface IPagination {
    offset: number;
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
