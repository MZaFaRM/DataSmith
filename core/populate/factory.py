import binascii
import json
import os
import platform
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

import networkx as nx
from networkx import DiGraph
from sqlalchemy import (
    Connection,
    MetaData,
    Table,
    create_engine,
    func,
    insert,
    inspect,
    literal,
    select,
    table,
    union_all,
)
from sqlalchemy import text as sql_text
from sqlalchemy.engine import URL, Engine, make_url
from sqlalchemy.engine.reflection import Inspector

from core.populate.config import DBFRegistry
from core.settings import LOG_PATH
from core.utils.exceptions import (
    MissingRequiredAttributeError,
)
from core.utils.types import (
    DIALECT_URLS,
    ColumnMetadata,
    ColumnSpec,
    DbCredsSchema,
    DBDialectType,
    ForeignKeyRef,
    TableMetadata,
    TablePacket,
    UsageStatSchema,
)

CONNECT_TIMEOUT = 10  # seconds


class DatabaseFactory:
    def __init__(self):
        self.host = ""
        self.user = ""
        self.port = ""
        self.name = ""
        self.password = ""
        self.dialect = DBDialectType.UNKNOWN
        self.drivername: str | None = None
        self.url_query: str | None = None
        self.registry = DBFRegistry()

    def to_dict(self) -> dict:
        return {
            "id": getattr(self, "_id", None),
            "host": self.host,
            "user": self.user,
            "port": str(self.port),
            "name": self.name,
            "drivername": self.drivername,
            "url_query": self.url_query,
        }

    def from_dict(self, data: dict):
        if getattr(self, "_id", None) is not None:
            raise ValueError(
                "Already connected to a database. Please create a new instance."
            )

        for key in ["host", "user", "port", "name", "password", "dialect"]:
            if key not in data:
                raise ValueError(f"Missing required key: {key}")
            if key == "dialect":
                self.dialect = DBDialectType(data[key])
            else:
                setattr(self, key, data[key])
        self.drivername = data.get("drivername")
        self.url_query = data.get("url_query")

    def from_url(self, connection_url: str):
        if getattr(self, "_id", None) is not None:
            raise ValueError(
                "Already connected to a database. Please create a new instance."
            )

        parsed = make_url(connection_url)
        dialects = {
            "postgresql": DBDialectType.POSTGRESQL,
            "mysql": DBDialectType.MYSQL,
            "mariadb": DBDialectType.MARIADB,
            "mssql": DBDialectType.MSSQL,
            "oracle": DBDialectType.ORACLE,
            "firebird": DBDialectType.FIREBIRD,
        }
        dialect = dialects.get(parsed.get_backend_name())
        if dialect is None:
            raise ValueError(f"Unsupported database URL dialect: {parsed.get_backend_name()}")
        if not all([parsed.host, parsed.username, parsed.database]):
            raise ValueError("The database URL must include host, username, and database name.")

        default_ports = {
            DBDialectType.POSTGRESQL: 5432,
            DBDialectType.MYSQL: 3306,
            DBDialectType.MARIADB: 3306,
            DBDialectType.MSSQL: 1433,
            DBDialectType.ORACLE: 1521,
            DBDialectType.FIREBIRD: 3050,
        }
        self.host = parsed.host
        self.user = parsed.username
        self.password = parsed.password or ""
        self.port = str(parsed.port or default_ports[dialect])
        self.name = parsed.database
        self.dialect = dialect
        self.drivername = parsed.drivername
        self.url_query = json.dumps(dict(parsed.query))
        self._url = connection_url

    def to_schema(self) -> DbCredsSchema:
        return DbCredsSchema(
            id=getattr(self, "_id", None),
            name=self.name,
            host=self.host,
            port=self.port,
            user=self.user,
            password=self.password,
            dialect=self.dialect,
            drivername=self.drivername,
            url_query=self.url_query,
        )

    def from_schema(self, schema: DbCredsSchema) -> None:
        if getattr(self, "_id", None) is not None:
            raise ValueError(
                "Already connected to a database. Please create a new instance."
            )

        for key in [
            "id",
            "host",
            "user",
            "port",
            "name",
            "password",
            "dialect",
            "drivername",
            "url_query",
        ]:
            if not hasattr(schema, key):
                raise ValueError(f"Missing required key: {key}")
            elif key == "dialect":
                self.dialect = DBDialectType(schema.dialect)
            else:
                setattr(self, key, getattr(schema, key, None))

        if hasattr(schema, "id"):
            self.id = schema.id

    @property
    def url(self) -> str:
        if not hasattr(self, "_url") or self._url == "":
            if not all([self.user, self.host, self.port, self.name]):
                raise MissingRequiredAttributeError(
                    "Required arguments for url: user, password, host, port and name not set."
                )

            if self.dialect not in DIALECT_URLS:
                raise ValueError(f"Unsupported dialect: {self.dialect}")

            # Templates contain {placeholders}; fill them so make_url can parse
            # out the default drivername and query.
            default_url = make_url(
                DIALECT_URLS[self.dialect].format(
                    user="user", password="", host="localhost", port=0, name="db"
                )
            )
            drivername = self.drivername or default_url.drivername
            query = dict(default_url.query)
            if self.url_query:
                query.update(json.loads(self.url_query))
            query = {
                key: tuple(value) if isinstance(value, list) else value
                for key, value in query.items()
            }
            self._url = URL.create(
                drivername=drivername,
                username=self.user,
                password=self.password,
                host=self.host,
                port=int(self.port),
                database=self.name,
                query=query,
            ).render_as_string(hide_password=False)
        return self._url

    @property
    def id(self) -> int:
        if not hasattr(self, "_id") or self._id is None:
            raise AttributeError("Not connected to a database")
        return self._id

    @id.setter
    def id(self, value: int | None):
        if isinstance(value, int):
            self._id = value
        elif value is None and hasattr(self, "_id"):
            del self._id

    @property
    def engine(self) -> Engine:
        if not hasattr(self, "_engine") or self._engine is None:
            url = make_url(self.url)
            connect_args = {}
            # Without a timeout an unreachable host blocks the runner (and every
            # queued request) until the OS gives up on the TCP connect.
            if (
                url.get_backend_name() in ("postgresql", "mysql", "mariadb")
                and "connect_timeout" not in url.query
            ):
                connect_args["connect_timeout"] = CONNECT_TIMEOUT
            self._engine = create_engine(url, echo=False, connect_args=connect_args)
        return self._engine

    # @property
    # def logger(self) -> logging.Logger:
    #     if not hasattr(self, "_logger") or self._logger is None:
    #         self._logger = self.setup_logging()
    #     return self._logger

    @property
    def inspector(self) -> Inspector:
        # Reused so reflection results are cached; every query costs a full
        # round trip on remote databases.
        if getattr(self, "_inspector", None) is None:
            self._inspector = inspect(self.engine)
        return self._inspector

    @property
    def schema(self) -> dict[str, dict[str, list]]:
        """Foreign keys and columns of every table, reflected in bulk."""
        if getattr(self, "_schema", None) is None:
            fks = self.inspector.get_multi_foreign_keys()
            cols = self.inspector.get_multi_columns()
            self._schema = {
                "foreign_keys": {name: value for (_, name), value in fks.items()},
                "columns": {name: value for (_, name), value in cols.items()},
            }
        return self._schema

    def clear_schema_cache(self):
        self._inspector = None
        self._schema = None

    @property
    def connection(self) -> Connection:
        if not hasattr(self, "_connection") or self._connection is None:
            self._connection = self.engine.connect()
        return self._connection

    def ensure_transaction(self):
        if not hasattr(self, "transaction") or self.transaction is None:
            self.transaction = self.connection.begin()
            self.uncommitted = 0

    def commit(self):
        self.uncommitted = 0
        if hasattr(self, "transaction") and self.transaction is not None:
            self.transaction.commit()
        self.transaction = None
        self.registry.reset_usage_stats(db_id=self.id)

    def rollback(self):
        self.uncommitted = 0
        if hasattr(self, "transaction") and self.transaction is not None:
            self.transaction.rollback()
        self.transaction = None
        self.registry.reset_usage_stats(db_id=self.id)

    # def setup_logging(self):
    #     logger = logging.getLogger(f"user-sql-{self.name}")
    #     logger.setLevel(logging.INFO)
    #     logger.propagate = False
    #     logger.handlers.clear()

    #     log_path = Path(os.path.join(LOG_PATH, f"{self.name}.sql.log"))
    #     log_path.parent.mkdir(parents=True, exist_ok=True)

    #     file_handler = logging.FileHandler(log_path, mode="a")
    #     file_handler.setLevel(logging.INFO)
    #     formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
    #     file_handler.setFormatter(formatter)

    #     logger.addHandler(file_handler)
    #     return logger

    def read_logs(self, lines: int = 100) -> list[str]:
        log_file = os.path.join(LOG_PATH, f"{self.name}.sql.log")
        if not os.path.exists(log_file):
            return []

        with open(log_file) as f:
            logs = f.readlines()[-lines:]

        return [log.strip() for log in logs]

    def clear_logs(self):
        log_file = os.path.join(LOG_PATH, f"{self.name}.sql.log")
        if os.path.exists(log_file):
            with open(log_file, "w") as f:
                f.write("")
        return []

    def save(self):
        pk = self.registry.save_cred(
            DbCredsSchema(
                name=self.name,
                host=self.host,
                port=self.port,
                dialect=self.dialect,
                user=self.user,
                password=self.password,
                drivername=self.drivername,
                url_query=self.url_query,
            )
        )
        self.id = pk

    def test_connection(self):
        with self.engine.connect() as connection:
            connection.execute(sql_text("SELECT 1"))

    def disconnect(self):
        if hasattr(self, "_connection") and self._connection:
            self._connection.close()
            self._connection = None
        if hasattr(self, "_engine") and self._engine:
            self._engine.dispose()
            self._engine = None
        self.clear_schema_cache()
        if hasattr(self, "_url") and self._url:
            self._url = ""
        if hasattr(self, "transaction") and self.transaction:
            self.transaction.rollback()
            self.transaction = None

        self.id = None
        self.name = ""
        self.host = ""
        self.user = ""
        self.port = ""
        self.password = ""
        self.drivername = None
        self.url_query = None
        self.transaction = None
        self.uncommitted = 0
        self.registry.reset_usage_stats()

    def get_columns(self, table_name: str) -> list:
        """
        Returns the columns of a table.
        """
        return self.inspector.get_columns(table_name)

    def count_rows(self, tables: list[str]) -> dict[str, int]:
        """Row count of each table, fetched in a single UNION ALL query."""
        if not tables:
            return {}
        stmt = union_all(
            *(
                select(literal(name).label("name"), func.count().label("total"))
                .select_from(table(name))
                for name in tables
            )
        )
        with self.engine.connect() as conn:
            return {row.name: row.total for row in conn.execute(stmt)}

    def get_tables(self) -> dict:
        fks_by_table = self.schema["foreign_keys"]
        counts = self.count_rows(list(fks_by_table))

        return {
            name: {
                "parents": len(
                    {fk["referred_table"] for fk in fks if fk.get("referred_table")}
                ),
                "rows": counts.get(name, 0),
            }
            for name, fks in fks_by_table.items()
        }

    def sort_tables(self, tables: list[str] | None = None) -> list[str]:
        """
        Sorts the tables based on their foreign key dependencies.
        """

        graph = self.get_dependency_graph(tables or list(self.schema["foreign_keys"]))
        for src, tgt in graph.edges():
            score = self.score_edge(src, tgt)
            graph[src][tgt]["score"] = score

        while True:
            try:
                cycles = nx.find_cycle(graph)
            except nx.NetworkXNoCycle:
                break

            min_edge = min(cycles, key=lambda edge: graph[edge[0]][edge[1]]["score"])
            graph.remove_edge(min_edge[0], min_edge[1])

        sorted_tables = list(nx.topological_sort(graph))
        return sorted_tables

    def score_edge(self, source: str, target: str) -> int | float:
        fks = self.schema["foreign_keys"].get(target, [])
        columns = self.schema["columns"].get(target, [])

        for fk in fks:
            if fk.get("referred_table") != source:
                continue
            for col in columns:
                if col["name"] in fk.get("constrained_columns", []):
                    nullable = col.get("nullable")
                    default = col.get("default") is not None
                    if nullable and default:
                        return 0
                    elif nullable:
                        return 1
                    elif default:
                        return 2

        return float("inf")

    def get_dependency_graph(self, tables: list[str]) -> DiGraph:
        graph = nx.DiGraph()
        for name in tables:
            for fk in self.schema["foreign_keys"].get(name, []):
                referred = fk.get("referred_table")
                if referred and referred in tables:
                    graph.add_edge(referred, name)
            graph.add_node(name)
        return graph

    def get_database_rows(self) -> list[dict]:
        counts = self.count_rows(list(self.schema["foreign_keys"]))
        rows = {
            name: {
                "table_name": name,
                "total_rows": total,
                "new_rows": 0,
            }
            for name, total in counts.items()
        }

        # Merge in "new rows" from registry
        new_rows = self.registry.get_usage_stats(self.id)
        for row in new_rows:
            if row.table_name in rows:  # avoid KeyError
                rows[row.table_name]["new_rows"] = row.new_rows

        return list(rows.values())

    def get_table_metadata(self, table_name: str) -> TableMetadata:
        if table_name not in self.inspector.get_table_names():
            raise ValueError(f"Table '{table_name}' does not exist in the database.")

        fk_map = self.get_foreign_keys(table_name)
        pk = self.inspector.get_pk_constraint(table_name).get("constrained_columns", [])
        cols = self.inspector.get_columns(table_name)
        s, m = self.get_unique_columns(table_name)

        def handle_default(default_val):
            if default_val is None:
                return None
            if hasattr(default_val, "arg"):
                return str(default_val.arg)
            return default_val

        columns = []
        for col in cols:
            name = col["name"]
            dtype = col["type"]
            multi_unique = next((i for i, t in enumerate(m) if name in t), None)

            column_metadata = ColumnMetadata(
                name=name,
                type=str(dtype),
                primary_key=name in pk,
                nullable=col.get("nullable", True),
                unique=s is not None and name in s,
                multi_unique=m[multi_unique] if multi_unique is not None else None,
                default=handle_default(col.get("default")),
                autoincrement=bool(col.get("autoincrement")),
                computed=bool(col.get("computed")),
                foreign_keys=fk_map.get(name, ForeignKeyRef(table="", column="")),
                length=getattr(dtype, "length", None),
                precision=getattr(dtype, "precision", None),
                scale=getattr(dtype, "scale", None),
            )
            columns.append(column_metadata)

        return TableMetadata(
            name=table_name,
            parents=list(set(t.table for t in fk_map.values())),
            columns=columns,
        )

    def get_unique_columns(self, table: str) -> tuple[list[str], list[tuple[str, ...]]]:
        s_unique_cols = set()
        m_unique_cols = set()

        def add_unique(cols: Sequence[str | None] | None):
            if cols:
                if len(cols) == 1:
                    s_unique_cols.add(cols[0])
                else:
                    m_unique_cols.add(tuple(sorted(c for c in cols if c is not None)))

        # Add UNIQUE constraints
        for uc in self.inspector.get_unique_constraints(table):
            add_unique(uc.get("column_names"))

        # Add UNIQUE indexes
        for idx in self.inspector.get_indexes(table):
            if idx.get("unique"):
                add_unique(idx.get("column_names"))

        # Add PRIMARY KEY constraint
        pk = self.inspector.get_pk_constraint(table)
        add_unique(pk.get("constrained_columns"))

        return list(s_unique_cols), list(m_unique_cols)

    def get_foreign_keys(self, table: str) -> dict[str, ForeignKeyRef]:
        fk_map = {}

        for fk in self.inspector.get_foreign_keys(table):
            ref_tbl = fk.get("referred_table")
            ref_cols = fk.get("referred_columns", [])
            local_cols = fk.get("constrained_columns", [])

            for src, dest in zip(local_cols, ref_cols, strict=False):
                fk_map[src] = ForeignKeyRef(
                    column=dest,
                    table=ref_tbl,
                )

        return fk_map

    def get_existing_values(self, table: str, column: str) -> list[str]:
        meta = MetaData()
        tbl = Table(table, meta, autoload_with=self.engine)
        col = tbl.c[column]

        stmt = select(col).where(col.is_not(None))

        with self.engine.connect() as conn:
            result = conn.execute(stmt)
            values = [row[0] for row in result]
        return values

    def get_sql_banner(self) -> dict[str, list[str] | str]:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        os = platform.system()

        banner = [
            "Welcome to the DataSmith monitor.  Commands end with ; or \\g.",
            f"Session started on {now} via {os}",
            "Connection id: 420",
            f"Forge version: 1.0.0-alchemist ({self.dialect.upper()})",
            "",
            "Copyright (c) 2025, DataSmith Initiative.",
            " All bugs reserved.",
            "",
            "Type 'help;' or '\\h' for help. Type 'clear;' to clear the screen.",
            "",
            "Rows are always limited to 250 to prevent freezing or memory issues in UI.",
        ]
        return {"log": banner, "prompt": self.dialect}

    def insert_packet(self, packet: TablePacket):
        if not packet.columns or not packet.entries:
            raise ValueError("Missing columns and/or entries.")

        try:
            meta = MetaData()
            tbl = Table(packet.name, meta, autoload_with=self.engine)
            entries = [dict(zip(packet.columns, entry, strict=False)) for entry in packet.entries]

            stmt = insert(tbl).values(entries)
            # self.logger.info(stmt)
            # self.logger.info(f"Params: {entries}")

            self.ensure_transaction()
            self.connection.execute(stmt)
            self.uncommitted += 1

            self.registry.save_usage_stat(
                UsageStatSchema(
                    db_id=self.id,
                    table_name=packet.name,
                    new_rows=len(entries),
                )
            )

        except Exception as e:
            # self.logger.error(str(e))
            raise e

    def export_sql_packet(self, packet, path: str):
        table_name = packet.name
        if not packet.columns or not packet.entries:
            raise ValueError("Missing columns and/or entries.")

        DIALECT_QUOTES = {
            "MYSQL": ("`", "`"),
            "MARIADB": ("`", "`"),
            "POSTGRESQL": ('"', '"'),
            "ORACLE": ('"', '"'),
            "FIREBIRD": ('"', '"'),
            "MSSQL": ("[", "]"),
        }
        left_quote, right_quote = DIALECT_QUOTES.get(self.dialect.upper(), ('"', '"'))

        def quote(ident: str) -> str:
            return f"{left_quote}{ident}{right_quote}" if left_quote else ident

        def sql_literal(val) -> str:
            if val is None or (isinstance(val, str) and val.upper() == "NULL"):
                return "NULL"

            if isinstance(val, bool):
                return "TRUE" if val else "FALSE"

            if isinstance(val, (int, float)):
                return str(val)

            if isinstance(val, datetime):
                return f"'{val.isoformat(sep=' ')}'"

            if isinstance(val, date):
                return f"'{val.isoformat()}'"

            if isinstance(val, bytes):
                hex_str = binascii.hexlify(val).decode("utf-8")
                return f"'{hex_str}'"

            return "'" + str(val).replace("'", "''") + "'"

        sql = (
            f"INSERT INTO {quote(table_name)} (\n"
            f"  {', '.join(f'{quote(col)}' for col in packet.columns)}\n"
            f") VALUES\n"
            + ",\n".join(
                f"  ({', '.join(sql_literal(item) for item in entry)})"
                for entry in packet.entries
            )
            + ";"
        )

        with open(path, "w") as f:
            f.write(
                f"\n-- Exported at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
            )
            f.write(sql)
            # self.logger.info(f"Exported SQL packet for {table_name} to {path}")


@dataclass
class ContextFactory:
    row_idx: int
    dbf: DatabaseFactory
    table: TableMetadata
    col_spec: ColumnSpec
    entries: dict[str, list[Any]]
    filled: list[str]

    @property
    def column(self) -> ColumnMetadata:
        if self.table is None or self.col_spec is None:
            raise ValueError("Table or column specification is missing.")
        return self.table.get_column(self.col_spec.name)

    @property
    def cache(self) -> dict[str, Any]:
        if not hasattr(self, "_cache"):
            self._cache = {}
        return self._cache
