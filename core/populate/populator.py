import ast
import contextlib
from numbers import Number
import random
import re
import traceback
from typing import Any, Callable, Generator
import uuid

from faker import Faker
import faker
import rstr

from core.helpers import cap_string, cap_numeric
from core.utils.exceptions import ValidationError, ValidationWarning, VerificationError
from core.utils.types import ColumnMetadata, ColumnSpec, ErrorPacket
from core.utils.types import GeneratorType as GType
from core.utils.types import TablePacket, TableSpec

from .factory import ContextFactory, DatabaseFactory


class Populator:
    def __init__(self):
        self.faker = Faker()
        self.cache = {}
        self.tf = GeneratorFactory()

    @property
    def methods(self) -> list[str]:
        if not hasattr(self, "_methods"):
            self._methods = []
            for method in dir(self.faker):
                with contextlib.suppress(Exception):
                    if not method.startswith("_"):
                        getattr(self.faker, method)()
                        self._methods.append(method)

        return self._methods

    def build_packets(
        self,
        dbf: DatabaseFactory,
        table_spec: TableSpec,
        progress: dict[str, str | int],
    ) -> tuple[TableSpec, TablePacket]:
        if dbf.id is None:
            raise ValueError("Database not initialized with a valid ID.")

        table_spec.db_id = dbf.id
        progress["status"] = "validating"
        _errors, ordered_columns = self.base_resolve_specs(table_spec.columns)

        progress["status"] = "building"
        errors, column_entries = self.build_table_entries(
            dbf, ordered_columns, table_spec, progress
        )

        progress["column"] = ""
        columns = list(column_entries.keys())
        rows = list(map(list, zip(*column_entries.values())))

        return table_spec, TablePacket(
            id=str(uuid.uuid4()),
            name=table_spec.name,
            columns=columns,
            entries=rows,
            errors=errors + _errors,
            page_size=table_spec.page_size,
            page=0,
            total_entries=len(rows),
            total_pages=1,
        )

    def paginate_table_packet(self, packet: TablePacket) -> TablePacket:
        page_size = packet.page_size
        total_entries = len(packet.entries)
        total_pages = (total_entries + page_size - 1) // page_size
        id = str(uuid.uuid4())

        if total_entries == 0:
            return TablePacket(
                id=id,
                name=packet.name,
                columns=packet.columns,
                entries=[],
                errors=packet.errors,
                page=0,
                page_size=page_size,
                total_entries=0,
                total_pages=0,
            )

        self._cached_packets = [
            TablePacket(
                id=id,
                name=packet.name,
                columns=packet.columns,
                entries=packet.entries[i : i + page_size],
                errors=packet.errors,
                page=page_idx,
                page_size=page_size,
                total_entries=total_entries,
                total_pages=total_pages,
            )
            for page_idx, i in enumerate(range(0, total_entries, page_size))
        ]

        return self.get_packet_page(id, 0)

    def get_packet_page(
        self, packet_id: str, page: int | None = None, safe=True
    ) -> TablePacket:
        if not hasattr(self, "_cached_packets") or not self._cached_packets:
            raise ValueError(
                "No cached packet found. Please generate the packet first."
            )

        if page is not None and page >= len(self._cached_packets):
            raise ValueError(
                f"Page {page} out of range. Total pages: {len(self._cached_packets)}."
            )

        if page is None:
            packet = self._cached_packets[0].model_copy(deep=True)
        else:
            packet = self._cached_packets[page].model_copy(deep=True)

        if packet.id == packet_id:
            if page is None:
                # If page is None, return all packets combined
                entries = [entry for p in self._cached_packets for entry in p.entries]
                packet.entries = entries

            if safe:
                safe_entries = list(
                    map(
                        lambda row: [
                            str(cell) if cell is not None else None for cell in row
                        ],
                        packet.entries,
                    )
                )
                packet.entries = safe_entries
            return packet

        raise ValueError(f"No packet found for ID {packet_id} on page {page}.")

    def build_table_entries(
        self,
        dbf: DatabaseFactory,
        ordered_columns: list[ColumnSpec],
        table_spec: TableSpec,
        progress: dict[str, str | int],
    ) -> tuple[list[ErrorPacket], dict[str, list[str | None]]]:

        metadata = dbf.get_table_metadata(table_spec.name)
        errors: list[ErrorPacket] = []

        if not ordered_columns:
            return errors, {}

        context = ContextFactory(
            row_idx=0,
            dbf=dbf,
            table=metadata,
            col_spec=ordered_columns[0],
            filled=[],
            entries={
                col.name: [None] * table_spec.no_of_entries for col in ordered_columns
            },
        )

        gen_fns = [
            self.tf.make(col.type)(context)
            for col in ordered_columns
            if col.type is not None
        ]

        for entry_index in range(table_spec.no_of_entries):
            i = 0
            context.filled = []
            progress["row"] = entry_index
            while i < len(gen_fns):
                try:
                    context.col_spec = ordered_columns[i]

                    gen = gen_fns[i]
                    col_spec = context.col_spec
                    progress["column"] = col_spec.name

                    for _ in range(25):
                        value = next(gen)
                        if self.is_valid(context, value):
                            context.entries[col_spec.name][entry_index] = value
                            context.filled.append(col_spec.name)
                            i += 1
                            break

                    else:
                        error = f"Generated values for {col_spec.name} couldn't meet UNIQUE or MULTI-UNIQUE constraints."
                        if context.column.nullable:
                            raise ValidationWarning(error)
                        else:
                            raise ValidationError(error)
                except ValidationWarning as e:
                    gen_fns.pop(i)
                    ordered_columns.pop(i)
                    errors.append(
                        ErrorPacket(
                            column=context.col_spec.name,
                            type="warning",
                            msg=str(e),
                        )
                    )

                except Exception as e:
                    gen_fns.pop(i)
                    ordered_columns.pop(i)
                    errors.append(
                        ErrorPacket(
                            column=context.col_spec.name,
                            type="error",
                            msg=str(e),
                        )
                    )

            context.row_idx += 1

        entries = {
            col.name: context.entries[col.name]
            for col in metadata.columns
            if col.name in context.entries
        }

        return errors, entries

    # endregion

    # region helpers

    def base_resolve_specs(
        self, specs: list[ColumnSpec]
    ) -> tuple[list[ErrorPacket], list[ColumnSpec]]:

        errors = []
        result = []

        result_python = {}

        def needs_check(type: GType) -> bool:
            return type not in {GType.autoincrement, GType.computed}

        for c_spec in specs:
            try:
                if c_spec.type == GType.python and c_spec.generator:
                    order = self.tf.check_python(c_spec.generator)
                    while order in result_python:
                        order += 1
                    result_python[order] = c_spec

                elif (
                    c_spec.generator is not None
                    and c_spec.type is not None
                    and needs_check(c_spec.type)
                ):
                    self.tf.check(c_spec.type, c_spec.generator)
                    result.append(c_spec)

            except Exception as e:
                errors.append(
                    ErrorPacket(
                        column=c_spec.name,
                        type="error",
                        msg=f"Error '{c_spec.name}' {str(e)}",
                    )
                )

        result.extend(result_python[key] for key in sorted(result_python.keys()))
        return errors, result

    def is_valid(self, context: ContextFactory, value: str | None) -> bool:
        column_name = context.col_spec.name
        table_name = context.table.name
        row_idx = context.row_idx
        column = context.column

        # UNIQUE check (single-column)
        if column.unique and value is not None:
            seen_key = f"{table_name}.{column_name}"
            seen: set = self.fetch_existing_values(context, key=seen_key)

            # Check existing data
            if value in seen:
                return False

            # Check earlier generated entries in current session
            if value in context.entries[column_name][:row_idx]:
                return False

        if column.multi_unique and value is not None:
            sibling_columns = list(column.multi_unique)
            if column_name not in sibling_columns:
                sibling_columns.append(column_name)

            # Skip check if any sibling is not yet filled
            if any(
                sibling != column_name and sibling not in context.filled
                for sibling in sibling_columns
            ):
                return True

            # Build tuple for the current row
            current_row = tuple(
                value if sibling == column_name else context.entries[sibling][row_idx]
                for sibling in sibling_columns
            )

            # Skip if any value is None
            if any(v is None for v in current_row):
                return True

            # Check against previously generated rows
            for i in range(row_idx):
                prev_row = tuple(
                    context.entries.get(col, [None] * (i + 1))[i]
                    for col in sibling_columns
                )

                if any(v is None for v in prev_row):
                    continue

                if prev_row == current_row:
                    return False

            # Check each part of the tuple in DB
            for sibling, val in zip(sibling_columns, current_row):
                seen_key = f"{table_name}.{sibling}"
                seen = self.fetch_existing_values(context, key=seen_key)
                if val in seen:
                    return False

        return True

    def get_column_indices(self, *items, columns: list[ColumnMetadata]) -> set[int]:
        sibling_idxs = set()
        for idx, col in enumerate(columns):
            if col.name in items:
                sibling_idxs.add(idx)
        return sibling_idxs

    def fetch_existing_values(self, context, key) -> set[str]:
        if context.cache is not None:
            if key in context.cache:
                seen = context.cache[key]
            else:
                seen = context.cache[key] = set(
                    context.dbf.get_existing_values(
                        context.table.name, context.col_spec.name
                    )
                )
        return seen

    # endregion


class GeneratorFactory:
    def __init__(self) -> None:
        self.faker = Faker()

    def make(
        self, type: GType
    ) -> Callable[[ContextFactory], Generator[Any, None, None]]:
        make_fn = getattr(self, f"make_{type.value}", None)
        if make_fn is None or not callable(make_fn):
            raise ValueError(f"Unknown generator type: {type}")
        return make_fn  # type: ignore

    def make_faker(self, context: ContextFactory) -> Generator[Any, None, None]:
        faker_fn = getattr(self.faker, context.col_spec.generator or "")
        col = context.column
        while True:
            val = faker_fn()
            if isinstance(val, str):
                val = cap_string(val, col.length)
            elif isinstance(val, Number):
                val = cap_numeric(val, col.precision, col.scale)  # type: ignore
            yield val

    def make_python(self, context: ContextFactory) -> Generator[Any, None, None]:
        try:
            tree = ast.parse(context.col_spec.generator or "")

            # Prepare the environment for execution
            env = {
                "faker": faker,
                "columns": {},
                "order": lambda x: (lambda f: f),
                "__builtins__": __builtins__,
            }
            exec(compile(tree, filename="<ast>", mode="exec"), env)

            # Call the generator function
            gen = env["generator"]
            while True:
                columns = {
                    key: context.entries[key][context.row_idx]
                    for key in context.entries
                }
                yield gen(columns=columns)

        except SyntaxError as e:
            raise VerificationError(f"Syntax Error in Python script: {e}")
        except Exception as e:
            raise Exception(str(e), str(traceback.format_exc()))

    def make_regex(self, context: ContextFactory) -> Generator[Any, None, None]:
        col = context.column
        regex_fn = lambda: rstr.xeger(context.col_spec.generator or "")
        while True:
            val = regex_fn()
            if isinstance(val, str):
                val = cap_string(val, col.length)
            elif isinstance(val, Number):
                val = cap_numeric(val, col.precision, col.scale)  # type: ignore
            yield val

    def make_foreign(self, context: ContextFactory) -> Generator[Any, None, None]:
        column = context.column
        fk = column.foreign_keys
        cache = context.cache
        dbf = context.dbf

        if not fk:
            raise ValueError(f"No foreign key reference for column {column.name}")

        if not f"{fk.table}.{fk.column}" in cache:
            cache[f"{fk.table}.{fk.column}"] = list(
                map(str, dbf.get_existing_values(fk.table, fk.column))
            )

        rows = cache[f"{fk.table}.{fk.column}"]
        if not rows:
            msg = f"No foreign key rows to choose from for column {column.name}"
            if context.column.nullable:
                raise ValidationWarning(msg)
            else:
                raise ValueError(msg)

        while True:
            yield random.choice(rows)

    def make_null(self, context: ContextFactory) -> Generator[None, None, None]:
        while True:
            yield None

    def make_constant(
        self, context: ContextFactory
    ) -> Generator[str | None, None, None]:
        while True:
            yield context.col_spec.generator

    def check(self, type: GType, generator: str) -> bool | int:
        make_fn = getattr(self, f"check_{type.value}", None)
        if make_fn is None or not callable(make_fn):
            raise ValueError(f"Unknown check type: {type}")
        return make_fn(generator)  # type: ignore

    def check_faker(self, generator: str):
        if not callable(getattr(self.faker, generator, None)):
            raise VerificationError(
                f"Faker method '{generator}' is not callable or doesn't exist."
            )
        return True

    def check_python(self, generator: str) -> int:
        tree = ast.parse(generator)
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and node.name == "generator":
                if len(node.args.args) != 1 or (node.args.args[0].arg != "columns"):
                    raise ValueError("generator() must take exactly 1 arg: 'columns'.")
                for deco in node.decorator_list:
                    if (
                        isinstance(deco, ast.Call)
                        and getattr(deco.func, "id", "") == "order"
                    ):
                        if isinstance(deco.args[0], ast.Constant) and isinstance(
                            deco.args[0].value, int
                        ):
                            return deco.args[0].value
                        raise ValueError("@order requires int type arg")
                raise ValueError("Missing @order(int) decorator")
        raise ValueError("No valid generator() function found")

    def check_regex(self, generator: str):
        # This will raise an error if the regex is invalid
        re.compile(generator)
        return True

    def check_foreign(self, generator: str):
        return True

    def check_null(self, generator: str):
        return True

    def check_constant(self, generator: str):
        return True
