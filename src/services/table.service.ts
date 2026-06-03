import { GET_ALL_TABLES } from "~/common/error-code/table";
import { IGetTables, ISelectQuery, ITable } from "~/interfaces";
import { tableRepository } from "~/repositories";

export const getAllTables = async (): Promise<ITable[] | number> => {
    try {
        const tables = await tableRepository.getAllTables();
        return tables;
    } catch (error) {
        return GET_ALL_TABLES.GET_ALL_TABLES_FAILED;
    }
};

export const getTables = async (params: ISelectQuery): Promise<IGetTables | number> => {
    try {
        const result = await tableRepository.getTables(params);
        const totalPages = Math.ceil(result.totalCount / params.limit!);
        const data: IGetTables = {
            tables: result.rows,
            pagination: {
                limit: params.limit!,
                currentPage: params.offset! / params.limit! + 1,
                totalPages,
                totalItems: result.totalCount,
            },
        };
        return data;
    } catch (error) {
        return GET_ALL_TABLES.GET_ALL_TABLES_FAILED;
    }
};
