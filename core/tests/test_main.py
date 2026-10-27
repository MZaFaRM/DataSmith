import pytest

from core.runner import Runner
from core.utils.response import Request

TEST_CREDS = {
    "host": "localhost",
    "port": 3306,
    "user": "root",
    "name": "test",
    # "password": "1234567890",
}


@pytest.fixture
def runner():
    return Runner()


def test_run_sql_query_h(runner: Runner):
    res = runner.handle_command(Request(kind="set_db_reconnect", body=TEST_CREDS))
    assert res["status"] == "ok", res["error"]
    res = runner.handle_command(Request(kind="run_sql_query", body={"sql": "SELECT * FROM students"}))
    assert res["status"] == "ok"


def test_handle_ping(runner: Runner):
    req = Request(kind="ping", body={})
    res = runner.handle_command(req)
    assert res["status"] == "ok"
    assert res["payload"] == "pong"


def test_handle_unknown_command(runner: Runner):
    req = Request(kind="unknown_cmd", body={})
    res = runner.handle_command(req)
    assert res["status"] == "error"
    assert "Unknown command" in res["error"]


def test_handle_set_db_connect_missing_params(runner: Runner):
    req = Request(kind="set_db_connect", body={})
    res = runner.handle_command(req)
    assert res["status"] == "error"


def test_connect_success(runner: Runner):
    creds = TEST_CREDS.copy()
    creds["password"] = "1234567890"
    req = Request(kind="set_db_connect", body=creds)
    res = runner.handle_command(req)
    assert res["status"] == "ok", res["error"]


def test_get_db_info(runner: Runner):
    res = runner.handle_command(Request(kind="set_db_reconnect", body=TEST_CREDS))
    assert res["status"] == "ok", res["error"]
    res = runner.handle_command(Request(kind="get_db_info"))
    assert res["status"] == "ok", res["error"]


def test_run_sql_query(runner: Runner):
    res = runner.handle_command(Request(kind="set_db_reconnect", body=TEST_CREDS))
    assert res["status"] == "ok", res["error"]
    res = runner.handle_command(Request(kind="run_sql_query", body={"sql": "SELECT * FROM students"}))
    assert res["status"] == "ok"


def test_get_db_table(runner: Runner):
    res = runner.handle_command(Request(kind="set_db_reconnect", body=TEST_CREDS))
    assert res["status"] == "ok", "Error connecting to database"
    req = Request(kind="get_db_table", body={"name": "students"})
    res = runner.handle_command(req)
    assert res["status"] == "ok", "Error fetching table metadata"
    assert "columns" in res["payload"]


def test_get_logs_read(runner: Runner):
    res = runner.handle_command(Request(kind="get_logs_read", body={"lines": 10}))
    assert res["status"] == "ok", "Error fetching logs"
    assert isinstance(res["payload"], list)


def test_disconnect(runner: Runner):
    req = Request(kind="set_db_reconnect", body=TEST_CREDS)
    res = runner.handle_command(req)
    assert res["status"] == "ok", "Error connecting to database"

    disc = runner.handle_command(Request(kind="set_db_disconnect", body={}))
    assert disc["status"] == "ok", "Error disconnecting from database"


def test_get_pref_connections(runner: Runner):
    req = Request(kind="set_db_reconnect", body=TEST_CREDS)
    res = runner.handle_command(req)
    assert res["status"] == "ok", "Error connecting to database"

    res = runner.handle_command(Request(kind="get_pref_connections", body={}))
    assert res["status"] == "ok", res["error"]
    assert isinstance(res["payload"], list)


def test_get_gen_methods(runner: Runner):
    res = runner.handle_command(Request(kind="get_gen_methods", body={}))
    assert res["status"] == "ok", res["error"]
    assert isinstance(res["payload"], list)


def test_tables_command(runner: Runner):
    req = Request(kind="set_db_reconnect", body=TEST_CREDS)
    res = runner.handle_command(req)
    assert res["status"] == "ok", "Error connecting to database"

    res = runner.handle_command(Request(kind="get_db_tables", body={}))
    assert res["status"] == "ok", "Error fetching tables"
    assert isinstance(res["payload"], list)


def test_set_db_reconnect(runner: Runner):
    creds = TEST_CREDS.copy()
    creds.pop("password", None)

    req = Request(kind="set_db_reconnect", body=creds)
    res = runner.handle_command(req)
    assert res["status"] == "ok", f"Reconnect failed, Req: {req}, Res: {res}"

    res = runner.handle_command(Request(kind="get_db_tables", body={}))
    assert res["status"] == "ok", "Error fetching tables after reconnect"
    assert isinstance(res["payload"], list)

    assert res["status"] == "ok"


def test_reconnect_deleted_db(runner: Runner):
    creds = TEST_CREDS.copy()
    creds["name"] = "hello_world_where_is_this_happening"
    req = Request(kind="set_db_reconnect", body=creds)
    res = runner.handle_command(req)
    assert res["status"] == "error"

    req = Request(kind="get_db_info", body={})
    res = runner.handle_command(req)
    assert res["status"] == "error", res["error"]


def test_empty_get_gen_packets(runner: Runner):
    req = Request(kind="set_db_reconnect", body=TEST_CREDS)
    res = runner.handle_command(req)
    assert res["status"] == "ok", res["error"]

    body = {
        "name": "classes",
        "noOfEntries": 50,
        "columns": [
            {
                "name": "class_id",
                "generator": "autoincrement",
                "type": "autoincrement",
            },
            {"name": "class_name", "generator": "null", "type": "null"},
            {"name": "room_number", "generator": "null", "type": "null"},
            {
                "name": "teacher_id",
                "generator": "teachers__teacher_id",
                "type": "foreign",
            },
        ],
    }
    response = runner.handle_command(Request(kind="get_gen_packets", body=body))
    assert response["status"] == "ok", f"Load spec failed: {response['error']}"


def test_get_gen_packets(runner: Runner):
    req = Request(kind="set_db_reconnect", body=TEST_CREDS)
    res = runner.handle_command(req)
    assert res["status"] == "ok", res["error"]

    body = {
        "name": "classes",
        "noOfEntries": 50,
        "columns": [
            {
                "name": "class_id",
                "generator": "autoincrement",
                "type": "autoincrement",
            },
            {"name": "class_name", "generator": "^(CS|MECH|IT)", "type": "regex"},
            {
                "name": "room_number",
                "generator": "^(L|R|M)[1-3]0[1-9]$",
                "type": "regex",
            },
            {
                "name": "teacher_id",
                "generator": "teachers__teacher_id",
                "type": "foreign",
            },
        ],
    }
    response = runner.handle_command(Request(kind="get_gen_packets", body=body))
    assert response["status"] == "ok", f"Load spec failed: {response['error']}"


def test_verify_teachers_table_spec(runner: Runner):
    req = Request(kind="set_db_reconnect", body=TEST_CREDS)
    res = runner.handle_command(req)
    assert res["status"] == "ok", res["error"]


def test_uncommitted(runner: Runner):
    req = Request(kind="set_db_reconnect", body=TEST_CREDS)
    res = runner.handle_command(req)
    assert res["status"] == "ok", res["error"]

    body = {"dbId": 1, "table_name": "classes"}
    response = runner.handle_command(Request(kind="get_pref_spec", body=body))
    assert response["status"] == "ok", f"Load spec failed: {response['error']}"

    for i in range(1, 4):
        load_res = runner.handle_command(Request(kind="get_gen_packets", body=response["payload"]))
        assert load_res["status"] == "ok", load_res["error"]

        insert_res = runner.handle_command(
            Request(kind="set_db_insert", body={"packet_id": load_res["payload"]["id"]})
        )
        assert insert_res["status"] == "ok", insert_res["error"]
        assert insert_res["payload"]["pending_writes"] == i

    commit_res = runner.handle_command(Request(kind="set_db_rollback", body={}))
    assert commit_res["status"] == "ok", commit_res["error"]
    assert runner.dbf.uncommitted == 0


def test_commit_and_rollback(runner: Runner):
    req = Request(kind="set_db_reconnect", body=TEST_CREDS)
    res = runner.handle_command(req)
    assert res["status"] == "ok", res["error"]

    body = {"dbId": 1, "tableName": "classes"}
    response = runner.handle_command(Request(kind="get_pref_spec", body=body))
    assert response["status"] == "ok", f"Load spec failed: {response['error']}"

    load_res = runner.handle_command(Request(kind="get_gen_packets", body=response["payload"]))
    assert load_res["status"] == "ok", load_res["error"]

    insert_res = runner.handle_command(
        Request(kind="set_db_insert", body={"packet_id": load_res["payload"]["id"]})
    )
    assert insert_res["status"] == "ok", insert_res["error"]

    commit_res = runner.handle_command(Request(kind="set_db_rollback", body={}))
    assert commit_res["status"] == "ok", commit_res["error"]

    insert_res = runner.handle_command(
        Request(kind="set_db_insert", body={"packet_id": load_res["payload"]["id"]})
    )
    assert insert_res["status"] == "ok", insert_res["error"]

    commit_res = runner.handle_command(Request(kind="set_db_commit", body={}))
    assert commit_res["status"] == "ok", commit_res["error"]

    runner.handle_command(Request(kind="run_sql_query", body={"sql": "DELETE FROM teachers LIMIT 50;"}))
    assert commit_res["status"] == "ok", commit_res["error"]


def test_get_gen_packets_order(runner: Runner):
    TEST_CREDS["name"] = "mulearn"
    req = Request(kind="set_db_reconnect", body=TEST_CREDS)
    res = runner.handle_command(req)
    assert res["status"] == "ok", res["error"]

    # load user table spec
    req = Request(kind="get_pref_spec", body={"dbId": runner.dbf.id, "tableName": "user"})
    res = runner.handle_command(req)
    assert res["status"] == "ok", f"Load spec failed: {res['error']}"

    # get gen packets
    req = Request(kind="get_gen_packets", body=res["payload"])
    res = runner.handle_command(req)
    assert res["status"] == "ok", res["error"]
