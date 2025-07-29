import logging
import os
import platform
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus

import networkx as nx
from networkx import Graph
from sqlalchemy import Connection, create_engine, inspect
from sqlalchemy import text as sql_text
from sqlalchemy.engine import Engine, Inspector
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
)
from core.utils.types import TableMetadata, TablePacket, UsageStatSchema


class DatabaseFactory:
    def __init__(self):
        self.host = ""
        self.user = ""
        self.port = ""
        self.name = ""
        self.password = ""
        self.dialect = DBDialectType.UNKNOWN
        self.registry = DBFRegistry()

    def to_dict(self) -> dict:
        return {
            "id": getattr(self, "_id", None),
            "host": self.host,
            "user": self.user,
            "port": str(self.port),
            "name": self.name,
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

    def to_schema(self) -> DbCredsSchema:
        return DbCredsSchema(
            id=getattr(self, "_id", None),
            name=self.name,
            host=self.host,
            port=self.port,
            user=self.user,
            password=self.password,
            dialect=self.dialect,
        )

    def from_schema(self, schema: DbCredsSchema) -> None:
        if getattr(self, "_id", None) is not None:
            raise ValueError(
                "Already connected to a database. Please create a new instance."
            )

        for key in ["id", "host", "user", "port", "name", "password", "dialect"]:
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
            if not all([self.user, self.password, self.host, self.port, self.name]):
                raise MissingRequiredAttributeError(
                    "Required arguments for url: user, password, host, port and name not set."
                )

            dialect = self.dialect.value.lower()
            if dialect not in DIALECT_URLS:
                raise ValueError(f"Unsupported dialect: {self.dialect}")

            self._url = DIALECT_URLS[DBDialectType(dialect)].format(
                user=quote_plus(self.user),
                password=quote_plus(self.password),
                host=self.host,
                port=self.port,
                name=quote_plus(self.name),
            )
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
        elif value == None and hasattr(self, "_id"):
            del self._id

    @property
    def engine(self) -> Engine:
        if not hasattr(self, "_engine") or self._engine is None:
            self.setup_logging()
            self._engine = create_engine(self.url, echo=False)
        return self._engine

    @property
    def inspector(self) -> Inspector:
        return inspect(self.engine)

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
        if hasattr(self, "transaction") and not self.transaction is None:
            self.transaction.commit()
        self.transaction = None
        self.registry.reset_usage_stats(db_id=self.id)

    def rollback(self):
        self.uncommitted = 0
        if hasattr(self, "transaction") and not self.transaction is None:
            self.transaction.rollback()
        self.transaction = None
        self.registry.reset_usage_stats(db_id=self.id)

    def setup_logging(self):
        logger = logging.getLogger(f"user-sql-{self.name}")
        logger.setLevel(logging.INFO)
        logger.propagate = False
        logger.handlers.clear()

        log_path = Path(os.path.join(LOG_PATH, f"{self.name}.sql.log"))
        log_path.parent.mkdir(parents=True, exist_ok=True)

        file_handler = logging.FileHandler(log_path, mode="a")
        file_handler.setLevel(logging.INFO)
        formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
        file_handler.setFormatter(formatter)

        logger.addHandler(file_handler)

        for sub in ["sqlalchemy.engine", "sqlalchemy.pool", "sqlalchemy.dialects"]:
            sub_logger = logging.getLogger(sub)
            sub_logger.setLevel(logging.INFO)
            sub_logger.propagate = False
            sub_logger.handlers.clear()
            sub_logger.addHandler(file_handler)

    def read_logs(self, lines: int = 100) -> list[str]:
        log_file = os.path.join(LOG_PATH, f"{self.name}.sql.log")
        if not os.path.exists(log_file):
            return []

        with open(log_file, "r") as f:
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
        self.transaction = None
        self.uncommitted = 0
        self.registry.reset_usage_stats()

    def get_columns(self, table_name: str) -> list:
        """
        Returns the columns of a table.
        """
        return self.inspector.get_columns(table_name)

    def get_tables(self) -> dict:
        tables = self.inspector.get_table_names()
        table_info = {table: {"parents": 0, "rows": 0} for table in tables}

        for table in table_info:
            fks = self.inspector.get_foreign_keys(table)
            parents = {fk["referred_table"] for fk in fks if fk.get("referred_table")}
            table_info[table]["parents"] = len(parents)

            with self.engine.connect() as conn:
                result = conn.execute(sql_text(f"SELECT COUNT(*) FROM {table}"))
                table_info[table]["rows"] = result.scalar_one()

        return table_info

    def sort_tables(self, tables: list[str] | None = None) -> list[str]:
        """
        Sorts the tables based on their foreign key dependencies.
        """

        graph = self.get_dependency_graph(tables or self.inspector.get_table_names())
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
        fks = self.inspector.get_foreign_keys(target)
        columns = self.inspector.get_columns(target)

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

    def get_dependency_graph(self, tables: list[str]) -> Graph:
        graph = nx.DiGraph()
        for table in tables:
            for fk in self.inspector.get_foreign_keys(table):
                referred = fk.get("referred_table")
                if referred and referred in tables:
                    graph.add_edge(referred, table)
            graph.add_node(table)
        return graph

    def get_database_rows(self) -> list[dict]:
        tables = self.inspector.get_table_names()
        rows = {}

        query_parts = [
            f"SELECT '{table}' AS name, COUNT(*) AS total FROM {table}"
            for table in tables
        ]
        query = " UNION ALL ".join(query_parts)

        with self.engine.connect() as conn:
            result = conn.execute(sql_text(query)).fetchall()
            rows = {
                row.name: {
                    "table_name": row.name,
                    "total_rows": row.total,
                    "new_rows": 0,
                }
                for row in result
            }

        new_rows = self.registry.get_usage_stats(self.id)
        for row in new_rows:
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

            for src, dest in zip(local_cols, ref_cols):
                fk_map[src] = ForeignKeyRef(
                    column=dest,
                    table=ref_tbl,
                )

        return fk_map

    def get_existing_values(self, table: str, column: str) -> list[str]:
        with self.engine.connect() as conn:
            result = conn.execute(
                sql_text(
                    f"SELECT `{column}` FROM `{table}` WHERE `{column}` IS NOT NULL"
                )
            )
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
        table_name = packet.name
        if not packet.columns or not packet.entries:
            raise ValueError("Missing columns and/or entries.")

        entries = [dict(zip(packet.columns, entry)) for entry in packet.entries]

        sql = f"""
            INSERT INTO `{table_name}` ({', '.join(packet.columns)})
            VALUES ({', '.join([f':{col}' for col in packet.columns])})
        """

        self.ensure_transaction()
        self.connection.execute(sql_text(sql), entries)
        self.uncommitted += 1

        self.registry.save_usage_stat(
            UsageStatSchema(
                db_id=self.id,
                table_name=table_name,
                new_rows=len(entries),
            )
        )

    def export_sql_packet(self, packet, path: str):
        table_name = packet.name
        if not packet.columns or not packet.entries:
            raise ValueError("Missing columns and/or entries.")

        def sql_literal(val: str | None) -> str:
            if val is None or val.upper() == "NULL":
                return "NULL"
            return "'" + val.replace("'", "\\'") + "'"

        sql = (
            f"INSERT INTO `{table_name}` (\n"
            f"  {', '.join(f'`{col}`' for col in packet.columns)}\n"
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


@dataclass
class ContextFactory:
    row_idx: int
    dbf: DatabaseFactory
    table: TableMetadata
    col_spec: ColumnSpec
    entries: dict[str, list[str | None]]
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
