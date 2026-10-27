import json
import sys
import threading
import time
import traceback
import uuid
from multiprocessing import Manager, Process, Queue
from typing import Any

from core.ai import AiPlanCancelled, AiService
from core.helpers import requires
from core.populate.factory import DatabaseFactory
from core.populate.populator import Populator
from core.populate.subprocess import generate_packets, run_sql_worker
from core.utils.response import Request, Response
from core.utils.types import TableSpec


class Runner:
    def __init__(self):
        self.dbf = DatabaseFactory()
        self.populator = Populator()
        self.ai = AiService()
        self._stdout_lock = threading.Lock()
        self._ai_cancel_lock = threading.Lock()
        self._ai_cancel_events: dict[str, threading.Event] = {}

    def listen(self):
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            if line == "exit":
                self._write_response(
                    Response(status="ok", payload="exiting...").to_dict()
                )
                break

            try:
                req = json.loads(line)
                req = Request(**req)
            except Exception as e:
                self._write_response(
                    Response(
                        status="error", error=str(e), traceback=traceback.format_exc()
                    ).to_dict()
                )
                continue

            if req.kind == "ai_plan_table":
                self._start_ai_request(req)
            else:
                self._handle_async_request(req)

    def _start_ai_request(self, req: Request) -> None:
        body = req.body or {}
        request_id = body.get("request_id")
        if not isinstance(request_id, str) or not request_id:
            response = self._err("AI request ID is missing.")
            response["id"] = req.id
            self._write_response(response)
            return

        with self._ai_cancel_lock:
            if request_id in self._ai_cancel_events:
                response = self._err("An AI request with this ID is already active.")
                response["id"] = req.id
                self._write_response(response)
                return
            self._ai_cancel_events[request_id] = threading.Event()
        threading.Thread(
            target=self._handle_async_request, args=(req,), daemon=True
        ).start()

    def _write_response(self, response: dict) -> None:
        with self._stdout_lock:
            print(json.dumps(response), flush=True)

    def _write_progress(self, request_id: str | None, stage: str, message: str) -> None:
        if not request_id:
            return
        progress = {
            "id": request_id,
            "event": "progress",
            "payload": {"stage": stage, "message": message},
        }
        with self._stdout_lock:
            print(json.dumps(progress), flush=True)

    def _handle_async_request(self, req: Request) -> None:
        if req.kind == "ai_plan_table" and req.body is not None:
            req.body["progress_id"] = req.id
        try:
            response = self.handle_command(req)
        except Exception as error:
            response = Response(
                status="error", error=str(error), traceback=traceback.format_exc()
            ).to_dict()
        response["id"] = req.id
        self._write_response(response)
        if req.kind == "ai_plan_table":
            request_id = (req.body or {}).get("request_id")
            with self._ai_cancel_lock:
                self._ai_cancel_events.pop(request_id, None) # type: ignore

    def handle_command(self, command: Request) -> dict:
        try:
            handler = getattr(self, f"_handle_{command.kind}", None)
            if not handler:
                return self._err(f"Unknown command: {command.kind}")
            return handler(command.body)
        except Exception as e:
            return Response(
                status="error",
                error=str(e),
                traceback=traceback.format_exc(),
            ).to_dict()

    def _ok(self, payload: Any) -> dict:
        return Response(status="ok", payload=payload).to_dict()

    def _err(self, error: str) -> dict:
        return Response(status="error", error=error).to_dict()

    @requires()
    def _handle_ping(self, _=None) -> dict:
        return self._ok("pong")

    @requires(connected=True)
    def _handle_get_db_info(self, _=None) -> dict:
        return self._ok(self.dbf.to_dict())

    @requires()
    def _handle_get_gen_methods(self, _=None) -> dict:
        return self._ok(self.populator.methods)

    @requires()
    def _handle_get_db_last_connected(self, _=None) -> dict:
        last_connected = self.dbf.registry.last_connected()
        if not last_connected:
            return self._ok(None)
        elif getattr(self.dbf, "_id", None) == last_connected.id:
            # Already connected, e.g. a duplicate request from a remounted view
            return self._ok(last_connected.model_dump(mode="json"))
        else:
            self.dbf.disconnect()
            self.dbf.from_schema(last_connected)
            try:
                self.dbf.test_connection()
                return self._ok(last_connected.model_dump(mode="json"))
            except Exception as e:
                self.dbf.disconnect()
                return self._err(
                    f"Failed to connect to last connected database: {str(e)}"
                )

    @requires("host", "user", "port", "name", "password", "dialect")
    def _handle_set_db_connect(self, creds: dict) -> dict:
        self.dbf.disconnect()
        if saved := self.dbf.registry.exists(
            name=creds["name"],
            user=creds["user"],
            host=creds["host"],
            port=creds["port"],
            dialect=creds["dialect"],
            drivername=creds.get("drivername"),
            url_query=creds.get("url_query"),
        ):
            self.dbf.from_schema(saved)
        else:
            self.dbf.from_dict(creds)
        try:
            self.dbf.test_connection()
        except Exception as e:
            self.dbf.disconnect()
            return self._err(str(e))

        if not saved:
            self.dbf.save()

        return self._ok(self.dbf.to_dict())

    @requires("connection_url")
    def _handle_set_db_connect_url(self, body: dict) -> dict:
        self.dbf.disconnect()
        try:
            self.dbf.from_url(body["connection_url"])
            saved = self.dbf.registry.exists(
                name=self.dbf.name, # type: ignore
                user=self.dbf.user, # type: ignore
                host=self.dbf.host, # type: ignore
                port=self.dbf.port,
                dialect=self.dbf.dialect,
                drivername=self.dbf.drivername,
                url_query=self.dbf.url_query,
            )
            if saved:
                self.dbf.from_schema(saved)
            self.dbf.test_connection()
            if not saved:
                self.dbf.save()
            return self._ok(self.dbf.to_dict())
        except Exception as e:
            self.dbf.disconnect()
            return self._err(str(e))

    @requires("name", "host", "port", "user", "dialect")
    def _handle_set_db_reconnect(self, creds: dict):
        self.dbf.disconnect()
        if schema := self.dbf.registry.exists(
            name=creds["name"],
            user=creds["user"],
            host=creds["host"],
            port=creds["port"],
            dialect=creds["dialect"],
            drivername=creds.get("drivername"),
            url_query=creds.get("url_query"),
        ):
            self.dbf.from_schema(schema)
            try:
                self.dbf.test_connection()
                return self._ok(self.dbf.to_dict())
            except Exception as e:
                self.dbf.disconnect()
                return self._err(str(e))

        return self._err("Unknown database.")

    @requires()
    def _handle_get_pref_connections(self, _=None) -> dict:
        creds = [cred.model_dump(mode="json") for cred in self.dbf.registry.list_creds()]
        return self._ok(creds)

    @requires("name", "host", "port", "user")
    def _handle_set_pref_delete(self, body: dict) -> dict:
        self.dbf.disconnect()
        self.dbf.registry.delete_cred(
            name=body["name"],
            host=body["host"],
            port=body["port"],
            user=body["user"],
        )
        return self._ok("Connection deleted successfully.")

    @requires()
    def _handle_set_db_disconnect(self, _=None) -> dict:
        self.dbf.disconnect()
        return self._ok("Disconnected successfully.")

    @requires(connected=True)
    def _handle_get_db_tables(self, _=None) -> dict:
        table_info = {"table_data": {}, "sorted_tables": []}
        # Re-reflect so refresh picks up schema changes, and warm the cache
        # before both threads read it.
        self.dbf.clear_schema_cache()
        _ = self.dbf.schema
        t1 = threading.Thread(
            target=lambda: table_info.update(table_data=self.dbf.get_tables())
        )
        t2 = threading.Thread(
            target=lambda: table_info.update(sorted_tables=self.dbf.sort_tables())
        )

        t1.start()
        t2.start()
        t1.join()
        t2.join()

        return self._ok(
            [
                {
                    "name": tbl,
                    "rows": table_info["table_data"][tbl]["rows"],
                    "parents": table_info["table_data"][tbl]["parents"],
                }
                for tbl in table_info["sorted_tables"]
            ]
        )

    @requires("name", connected=True)
    def _handle_get_db_table(self, body: dict) -> dict:
        metadata = self.dbf.get_table_metadata(body["name"])
        if not metadata:
            return self._err(f"No metadata found for table '{body['name']}'.")

        return self._ok(metadata.model_dump(mode="json"))

    def _handle_list_ai_models(self, body: dict) -> dict:
        try:
            return self._ok({"models": self.ai.list_models(body)})
        except ValueError as error:
            return self._err(str(error))

    def _handle_ai_plan_table(self, body: dict) -> dict:
        request_id = str(body.get("request_id", ""))
        with self._ai_cancel_lock:
            cancel_event = self._ai_cancel_events.get(request_id)
        if cancel_event is None:
            return self._err("AI request is no longer active.")

        progress_id = body.get("progress_id")
        self._write_progress(progress_id, "starting", "Starting table plan request…")
        try:
            plan = self.ai.create_table_plan(
                body,
                database=self.dbf,
                cancel_event=cancel_event,
                progress=lambda stage, message: self._write_progress(
                    progress_id, stage, message
                ),
            )
            return self._ok(plan)
        except AiPlanCancelled as error:
            self._write_progress(progress_id, "cancelled", str(error))
            return self._err(str(error))
        except ValueError as error:
            self._write_progress(progress_id, "error", str(error))
            return self._err(str(error))
        except Exception:
            if sys.stderr is not None:
                traceback.print_exc(file=sys.stderr)
            self._write_progress(
                progress_id,
                "error",
                "Table plan failed unexpectedly. Check the backend AI log.",
            )
            return self._err("Table plan failed unexpectedly. Check the backend AI log.")

    def _handle_cancel_ai_table_plan(self, body: dict) -> dict:
        request_id = str(body.get("request_id", ""))
        with self._ai_cancel_lock:
            cancel_event = self._ai_cancel_events.get(request_id)
        if cancel_event is None:
            return self._ok({"cancelled": False})
        cancel_event.set()
        return self._ok({"cancelled": True})

    @requires(TableSpec, connected=True)
    def _handle_get_gen_packets(self, body: dict) -> dict:
        if hasattr(self, "_active_process") and self._active_process.is_alive():
            return self._err("Generation is already running.")

        self._generation_id = str(uuid.uuid4())
        self._result_queue = Queue()

        self._progress = Manager().dict()
        self._progress.update(
            {
                "status": "starting",
                "row": 0,
                "total": body["no_of_entries"],
                "column": None,
            }
        )
        self._active_process = Process(
            target=generate_packets,
            args=(
                self._result_queue,
                self.dbf.to_schema(),
                body,
                self._progress,
            ),
        )
        self._active_process.start()

        return self._ok(
            {
                "status": "pending",
                "message": "Generation started.",
                "job_id": self._generation_id,
                "data": None,
                "progress": dict(self._progress),
            }
        )

    @requires("page", "packet_id", connected=True)
    def _handle_get_gen_packet(self, body: dict) -> dict:
        return self._ok(
            self.populator.get_packet_page(body["packet_id"], body["page"]).model_dump(mode="json")
        )

    @requires()
    def _handle_clear_gen_packets(self, _=None) -> dict:
        if hasattr(self, "_active_process") and self._active_process.is_alive():
            self._active_process.terminate()
            self._active_process.join()
        return self._ok("Generation process cleared.")

    @requires("job_id")
    def _handle_poll_gen_status(self, body: dict) -> dict:
        if (
            not hasattr(self, "_generation_id")
            or body.get("job_id") != self._generation_id
            or not hasattr(self, "_result_queue")
        ):
            return self._err("Invalid job.")

        response = {
            "status": "pending",
            "message": "Generation is still in progress.",
            "job_id": self._generation_id,
            "data": None,
        }
        if hasattr(self, "_progress"):
            response["progress"] = dict(self._progress)

        if self._result_queue.empty():
            if hasattr(self, "_active_process") and self._active_process.is_alive():
                return self._ok(response)
            return self._err("No result. Process may not have started or crashed.")

        if res := self._result_queue.get():
            if isinstance(res, Exception):
                return self._err(f"Error during generation: {str(res)}")

        paginated = self.populator.paginate_table_packet(res)
        response.update(
            {
                "status": "done",
                "message": "Generation completed successfully.",
                "data": paginated,
            }
        )
        return self._ok(response)

    @requires("table_name", connected=True)
    def _handle_get_pref_spec(self, body: dict) -> dict:
        spec = self.dbf.registry.get_spec(
            db_id=self.dbf.id, table_name=body["table_name"]
        )
        return self._ok(spec)

    @requires()
    def _handle_get_sql_banner(self, _: dict):
        return self._ok(self.dbf.get_sql_banner())

    @requires("sql")
    def _handle_run_sql_query(self, body: dict) -> dict:
        # The query may change the schema
        self.dbf.clear_schema_cache()
        try:
            result_queue = Queue()
            p = Process(
                target=run_sql_worker, args=(self.dbf.url, body["sql"], result_queue)
            )
            p.start()

            timeout = 20
            start = time.time()
            while time.time() - start < timeout:
                if not p.is_alive():
                    if not result_queue.empty():
                        return self._ok(result_queue.get())
                    return self._ok([""])
                time.sleep(0.1)

            p.terminate()
            return self._ok(
                [f"ERROR 408 (HYT00): Query timed out after {timeout:.2f} sec"]
            )
        except Exception as e:
            return self._ok([f"ERROR 8008 (4200): {str(e)}"])

    @requires()
    def _handle_get_logs_read(self, body: dict) -> dict:
        try:
            return self._ok(
                self.dbf.read_logs(lines=(body.get("lines", 200) if body else 200))
            )
        except Exception as e:
            return self._err(f"Failed to retrieve logs: {str(e)}")

    @requires()
    def _handle_set_logs_clear(self, _: dict) -> dict:
        try:
            return self._ok(self.dbf.clear_logs())
        except Exception as e:
            return self._err(f"Failed to clear logs: {str(e)}")

    @requires("packet_id")
    def _handle_set_db_insert(self, body: dict) -> dict:
        try:
            packet = self.populator.get_packet_page(packet_id=body["packet_id"], safe=False)
            self.dbf.insert_packet(packet)
            return self._ok({"pending_writes": self.dbf.uncommitted})
        except Exception as e:
            return self._err(f"Error inserting packet: {str(e)}")

    @requires("path", "packet_id")
    def _handle_set_db_export(self, body: dict) -> dict:
        try:
            path = body.pop("path")
            packet = self.populator.get_packet_page(packet_id=body["packet_id"], safe=False)
            self.dbf.export_sql_packet(packet, path)
            return self._ok(f"SQL packet exported to {path}")
        except Exception as e:
            return self._err(f"Error exporting SQL packet: {str(e)}")

    @requires()
    def _handle_set_db_commit(self, _: dict) -> dict:
        self.dbf.commit()
        return self._ok("Committed all transactions successfully!")

    @requires()
    def _handle_set_db_rollback(self, _: dict) -> dict:
        self.dbf.rollback()
        return self._ok("Rollbacked all transactions successfully!")

    @requires()
    def _handle_get_pref_rows(self, _: dict) -> dict:
        return self._ok(self.dbf.get_database_rows())
