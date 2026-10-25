from datetime import datetime
from typing import Optional

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from core.settings import DB_PATH
from core.utils.models import (
    Base,
    ColumnSpecModel,
    DbCredsModel,
    TableSpecModel,
    UsageStatModel,
)
from core.utils.types import DbCredsSchema, DBDialectType, TableSpec, UsageStatSchema


class DBFRegistry:
    def __init__(self):
        self.engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)
        Base.metadata.create_all(self.engine)
        self._migrate_db_creds()
        self.session = sessionmaker(bind=self.engine)

    def _migrate_db_creds(self):
        columns = {
            column["name"] for column in inspect(self.engine).get_columns("db_creds")
        }
        with self.engine.begin() as connection:
            if "drivername" not in columns:
                connection.execute(
                    text("ALTER TABLE db_creds ADD COLUMN drivername VARCHAR")
                )
            if "url_query" not in columns:
                connection.execute(
                    text("ALTER TABLE db_creds ADD COLUMN url_query TEXT")
                )

    def last_connected(self) -> Optional[DbCredsSchema]:
        with self.session() as session:
            row = (
                session.query(DbCredsModel)
                .order_by(DbCredsModel.last_connected.desc())
                .first()
            )
            return DbCredsSchema.model_validate(row) if row else None

    def save_cred(self, cred: DbCredsSchema):
        with self.session() as session:
            db_cred = DbCredsModel(**cred.model_dump())
            session.add(db_cred)
            session.flush()
            schema = DbCredsSchema.model_validate(db_cred)
            session.commit()
            return schema.id

    def exists(
        self,
        name: str,
        host: str,
        port: str,
        user: str,
        dialect: str | DBDialectType,
        drivername: str | None = None,
        url_query: str | None = None,
    ) -> Optional[DbCredsSchema]:
        with self.session() as session:
            row = (
                session.query(DbCredsModel)
                .filter_by(
                    name=name,
                    host=host,
                    port=port,
                    user=user,
                    dialect=dialect,
                    drivername=drivername,
                    url_query=url_query,
                )
                .first()
            )
            if row:
                row.last_connected = datetime.now() # type: ignore
                session.commit()
                return DbCredsSchema.model_validate(row)
            return None

    def list_creds(self) -> list[DbCredsSchema]:
        with self.session() as session:
            rows = (
                session.query(
                    DbCredsModel.id,
                    DbCredsModel.name,
                    DbCredsModel.host,
                    DbCredsModel.port,
                    DbCredsModel.user,
                    DbCredsModel.dialect,
                    DbCredsModel.drivername,
                    DbCredsModel.url_query,
                )
                .tuples()
                .all()
            )

            return [DbCredsSchema.model_validate(row) for row in rows]

    def delete_cred(self, name: str, host: str, port: str, user: str):
        with self.session() as session:
            row = (
                session.query(DbCredsModel)
                .filter_by(name=name, host=host, port=port, user=user)
                .first()
            )
            if row:
                session.delete(row)
                session.commit()

    def save_specs(self, spec: TableSpec):
        with self.session() as session:
            row = (
                session.query(TableSpecModel)
                .filter_by(db_id=spec.db_id, name=spec.name)
                .first()
            )
            if row:
                session.delete(row)

            db_spec = TableSpecModel(
                db_id=spec.db_id,
                name=spec.name,
                no_of_entries=spec.no_of_entries,
                columns=[ColumnSpecModel(**col.model_dump()) for col in spec.columns],
            )
            session.merge(db_spec)
            session.commit()

    def get_spec(self, db_id: int, table_name: str) -> TableSpec | None:
        with self.session() as session:
            row = (
                session.query(TableSpecModel)
                .filter_by(db_id=db_id, name=table_name)
                .first()
            )
            if row:
                return TableSpec.model_validate(row)
            return None

    def get_usage_stats(self, db_id: int) -> list[UsageStatSchema]:
        with self.session() as session:
            row = session.query(UsageStatModel).filter_by(db_id=db_id).all()
            return [UsageStatSchema.model_validate(stat) for stat in row]

    def save_usage_stat(self, stat: UsageStatSchema):
        with self.session() as session:
            row = (
                session.query(UsageStatModel)
                .filter_by(db_id=stat.db_id, table_name=stat.table_name)
                .first()
            )
            if row:
                row.new_rows += stat.new_rows  # type: ignore
            else:
                row = UsageStatModel(**stat.model_dump())
                session.add(row)
            session.commit()

    def reset_usage_stats(self, db_id: int | None = None):
        with self.session() as session:
            if not db_id:
                session.query(UsageStatModel).delete()
            else:
                session.query(UsageStatModel).filter_by(db_id=db_id).delete()
            session.commit()
