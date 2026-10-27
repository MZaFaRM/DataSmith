import base64

from sqlalchemy import (
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    PrimaryKeyConstraint,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import declarative_base, relationship

from core.utils.types import DBDialectType, GeneratorType

Base = declarative_base()

# fmt: off
class DbCredsModel(Base):
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    host = Column(String, nullable=False)
    port = Column(String, nullable=False)
    user = Column(String, nullable=False)
    dialect = Column(Enum(DBDialectType), nullable=False)
    drivername = Column(String, nullable=True)
    url_query = Column(Text, nullable=True)
    _password = Column("password", String, nullable=False)
    last_connected = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    __tablename__ = "db_creds"

    def __init__(self, **kwargs):
        raw_password = kwargs.pop("password", "")
        super().__init__(**kwargs)
        self.password = raw_password

    @property
    def password(self) -> str:
        return base64.b64decode(self._password.encode()).decode()

    @password.setter
    def password(self, value: str):
        self._password = base64.b64encode(value.encode()).decode()


class TableSpecModel(Base):
    id = Column(Integer, primary_key=True, autoincrement=True)
    db_id = Column(Integer, ForeignKey("db_creds.id", ondelete="CASCADE"), nullable=False)
    page_size = Column(Integer, nullable=False, default=100)
    name = Column(String(255), nullable=False)
    no_of_entries = Column(Integer, nullable=False)
    columns = relationship("ColumnSpecModel", back_populates="table", cascade="all, delete-orphan", order_by="ColumnSpecModel.id")

    __tablename__ = "table_specs"
    __table_args__ = (UniqueConstraint("db_id", "name", name="uq_table_name_per_db"),)


class ColumnSpecModel(Base):
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    generator = Column(Text, nullable=True)
    type = Column(Enum(GeneratorType), nullable=False)
    table = relationship("TableSpecModel", back_populates="columns")
    table_id = Column(Integer, ForeignKey("table_specs.id", ondelete="CASCADE"), nullable=False)

    __tablename__ = "column_specs"
    __table_args__ = (UniqueConstraint("table_id", "name", name="uq_column_name_per_table"),)


class UsageStatModel(Base):
    db_id = Column(Integer, ForeignKey("db_creds.id", ondelete="CASCADE"), nullable=False)
    table_name = Column(String(255), nullable=False)
    new_rows = Column(Integer, nullable=False)
    last_accessed = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())
    
    __tablename__ = "usage_stats"
    __table_args__ = (PrimaryKeyConstraint("db_id", "table_name", name="pk_usage_stat_per_table"),)
