import { MAX_PAGE_LIMIT, PAGINATION } from "~/common/constant";
import { IGetQuery, IPagination, ISelectQuery } from "~/interfaces";

/** Chuyển query phân trang của client thành `ISelectQuery` (giới hạn `limit` tối đa `MAX_PAGE_LIMIT`). */
export const buildListParams = (query: IGetQuery, extra: Partial<ISelectQuery> = {}): ISelectQuery => {
    const currentPage = Math.max(1, Number(query.currentPage) || PAGINATION.DEFAULT_PAGE);
    const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, Number(query.limit) || PAGINATION.DEFAULT_LIMIT));
    // qs có thể trả `fields` là chuỗi đơn khi client chỉ gửi một field
    const searchFields = query.search?.fields;
    const search =
        query.search?.text && searchFields
            ? { text: String(query.search.text), fields: ([] as string[]).concat(searchFields) }
            : undefined;
    return {
        search,
        filters: Array.isArray(query.filters) ? query.filters : [],
        orderBy: Array.isArray(query.orderBy) ? query.orderBy : [],
        limit,
        offset: (currentPage - 1) * limit,
        ...extra,
    };
};

export const buildPagination = (params: ISelectQuery, totalItems: number): IPagination => ({
    limit: params.limit!,
    currentPage: params.offset! / params.limit! + 1,
    totalPages: Math.ceil(totalItems / params.limit!),
    totalItems,
});
