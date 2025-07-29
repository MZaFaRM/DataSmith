from datetime import datetime
import enum
from typing import Literal, Optional
import uuid
from pydantic import BaseModel
from sqlalchemy import Column, ColumnElement


class GeneratorType(str, enum.Enum):
    faker = "faker"
    regex = "regex"
    foreign = "foreign"
    python = "python"
    constant = "constant"
    autoincrement = "autoincrement"
    computed = "computed"
    null = "null"


class ForeignKeyRef(BaseModel):
    table: str
    column: str


class ColumnMetadata(BaseModel):
    name: str
    type: str
    unique: bool
    multi_unique: Optional[tuple[str, ...]] = None
    primary_key: bool
    nullable: bool
    default: Optional[str] = None
    autoincrement: bool
    computed: bool
    foreign_keys: Optional[ForeignKeyRef] = None
    length: Optional[int] = None
    precision: Optional[int] = None
    scale: Optional[int] = None

    def __eq__(self, other: object) -> bool:
        return isinstance(other, ColumnMetadata) and self.name == other.name


class TableMetadata(BaseModel):
    name: str
    parents: list[str]
    columns: list[ColumnMetadata]

    @property
    def column_map(self) -> dict[str, ColumnMetadata]:
        return {col.name: col for col in self.columns}

    def get_column(self, name: str) -> ColumnMetadata:
        column = self.column_map.get(name)
        if column is None:
            raise ValueError(f"Column '{name}' not found in table '{self.name}'.")
        return column


class ColumnSpec(BaseModel):
    name: str
    generator: Optional[str] = None
    type: GeneratorType | None = None

    model_config = {"from_attributes": True}


class TableSpec(BaseModel):
    db_id: Optional[int] = None
    page_size: int = 100
    name: str
    no_of_entries: int
    columns: list[ColumnSpec]

    model_config = {"from_attributes": True}


class ErrorPacket(BaseModel):
    type: Literal["warning", "error"] = "error"
    column: Optional[str] = None
    msg: Optional[str] = None


class TablePacket(BaseModel):
    id: str
    name: str
    columns: list[str]
    entries: list[list[str | None]]
    errors: list[ErrorPacket] = []

    page: int
    page_size: int
    total_pages: int
    total_entries: int


class DbCredsSchema(BaseModel):
    id: Optional[int] = None
    name: str
    host: str
    port: int | str
    user: str
    password: str = ""
    dialect: str
    last_connected: Optional[datetime] = None

    model_config = {"from_attributes": True}


class DBDialectType(str, enum.Enum):
    MYSQL = "MYSQL"
    POSTGRESQL = "POSTGRESQL"
    UNKNOWN = "UNKNOWN"
    # MSSQL = "MSSQL"
    # ORACLE = "oracle"
    # MARIADB = "mariadb"
    # FIREBIRD = "firebird"


DIALECT_URLS = {
    DBDialectType.MYSQL: "mysql+pymysql://{user}:{password}@{host}:{port}/{name}",
    DBDialectType.POSTGRESQL: "postgresql+psycopg2://{user}:{password}@{host}:{port}/{name}",
    # DBDialectType.MSSQL: "mssql+pyodbc://{user}:{password}@{host}:{port}/{name}?driver=ODBC+Driver+17+for+SQL+Server",
    # DBDialectType.ORACLE: "oracle+cx_oracle://{user}:{password}@{host}:{port}/{name}",
    # DBDialectType.MARIADB: "mariadb+pymysql://{user}:{password}@{host}:{port}/{name}",
    # DBDialectType.FIREBIRD: "firebird+fdb://{user}:{password}@{host}/{name}",
}


class UsageStatSchema(BaseModel):
    db_id: int
    table_name: str
    new_rows: int
    last_accessed: Optional[datetime] = None

    model_config = {"from_attributes": True}
