from sqlalchemy import create_engine
from sqlalchemy import text as sql_text
from tabulate import tabulate

from core.populate.factory import DatabaseFactory
from core.populate.populator import Populator
from core.utils.types import DbCredsSchema, TableSpec


def run_sql_worker(url: str, sql: str, result_queue):
    output = []
    try:
        engine = create_engine(url)
        with engine.begin() as conn:
            result = conn.execute(sql_text(sql))

            if result.returns_rows:
                rows = result.fetchall()[:250] # Limit to 250 rows
                headers = list(result.keys())
                output.extend(
                    tabulate(rows, headers=headers, tablefmt="grid").splitlines()
                )
                output.append(f"{len(rows)} row(s) in set")
            else:
                output.append(f"Query OK, {result.rowcount} row(s) affected")
    except Exception as e:
        output.append(f"ERROR 8008 (4200): {str(e)}")
    finally:
        result_queue.put(output)


def generate_packets(
    q,
    db_creds: DbCredsSchema,
    spec_dict: dict,
    progress: dict,
):
    try:
        dbf = DatabaseFactory()
        dbf.from_schema(db_creds)

        pop = Populator()
        specs, packet = pop.build_packets(
            dbf, TableSpec(**spec_dict), progress=progress
        )
        dbf.registry.save_specs(specs)
        q.put(packet)
    except Exception as e:
        return q.put(e)
