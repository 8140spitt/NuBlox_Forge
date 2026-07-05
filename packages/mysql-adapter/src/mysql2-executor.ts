import { createPool, type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import type { SqlExecutionResult, SqlExecutor, SqlRow, SqlValue } from './index';

export type Mysql2ExecutorConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  connectionLimit?: number;
};

export function createMysql2Executor(config: Mysql2ExecutorConfig): SqlExecutor {
  const pool = createPool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    waitForConnections: true,
    connectionLimit: config.connectionLimit ?? 10,
    namedPlaceholders: false,
    decimalNumbers: false,
    dateStrings: false
  });

  return createPoolExecutor(pool);
}

function createPoolExecutor(pool: Pool): SqlExecutor {
  return {
    async query<T extends SqlRow = SqlRow>(sql: string, values: SqlValue[] = []): Promise<SqlExecutionResult<T>> {
      const [rows] = await pool.query<RowDataPacket[] | ResultSetHeader>(sql, values);
      return normaliseMysqlResult<T>(rows);
    },

    async transaction<T>(work: (executor: SqlExecutor) => Promise<T>): Promise<T> {
      const connection = await pool.getConnection();

      try {
        await connection.beginTransaction();
        const result = await work(createConnectionExecutor(connection));
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
  };
}

function createConnectionExecutor(connection: PoolConnection): SqlExecutor {
  return {
    async query<T extends SqlRow = SqlRow>(sql: string, values: SqlValue[] = []): Promise<SqlExecutionResult<T>> {
      const [rows] = await connection.query<RowDataPacket[] | ResultSetHeader>(sql, values);
      return normaliseMysqlResult<T>(rows);
    }
  };
}

function normaliseMysqlResult<T extends SqlRow>(rows: RowDataPacket[] | ResultSetHeader): SqlExecutionResult<T> {
  if (Array.isArray(rows)) {
    return {
      rows: rows.map((row) => ({ ...row }) as T)
    };
  }

  return {
    rows: [],
    affectedRows: rows.affectedRows
  };
}
