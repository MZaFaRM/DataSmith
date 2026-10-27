import json
import logging
import os
import re
import sys
import time
import traceback
from collections.abc import Callable
from multiprocessing import Queue, get_context
from queue import Empty
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request as URLRequest
from urllib.request import urlopen

import rstr

from core.settings import LOG_PATH

PROVIDER_URLS = {
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
    "openai": "https://api.openai.com/v1",
}
AI_LOG_PATH = os.path.join(LOG_PATH, "datasmith-ai.log")


class AiPlanCancelled(Exception):
    pass


def _logger() -> logging.Logger:
    logger = logging.getLogger("datasmith.ai")
    if not logger.handlers:
        logger.setLevel(logging.INFO)
        formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
        file_handler = logging.FileHandler(AI_LOG_PATH, encoding="utf-8")
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
        if sys.stderr is not None:
            stderr_handler = logging.StreamHandler(sys.stderr)
            stderr_handler.setFormatter(formatter)
            logger.addHandler(stderr_handler)
        logger.propagate = False
    return logger


def _log(message: str, *, error: bool = False) -> None:
    logger = _logger()
    logger.error(message) if error else logger.info(message)


def _invoke_langchain_plan(
    base_url: str,
    model_name: str,
    api_key: str,
    system_prompt: str,
    user_payload: str,
    response_schema: dict,
    result_queue: Queue,
    progress_queue: Queue,
) -> None:
    os.environ["LANGCHAIN_TRACING_V2"] = "false"
    os.environ["LANGSMITH_TRACING"] = "false"
    progress_queue.put(("client", "Loading LangChain provider adapter…"))
    try:
        from langchain_core.messages import HumanMessage, SystemMessage
        from langchain_openai import ChatOpenAI

        progress_queue.put(("request", "Sending schema and prompt to the selected model…"))
        chat_model = ChatOpenAI(
            model=model_name,
            api_key=api_key or "not-needed",  # type: ignore
            base_url=base_url,
            timeout=60,
            max_retries=0,
        )
        structured_model = chat_model.with_structured_output(
            response_schema,
            method="json_schema",
        )
        result = structured_model.invoke(
            [
                SystemMessage(content=system_prompt),
                HumanMessage(content=user_payload),
            ]
        )
        if hasattr(result, "model_dump"):
            result = result.model_dump(mode="json")  # type: ignore
        result_queue.put({"result": result})
        progress_queue.put(("response", "Model returned a structured plan."))
    except Exception as error:
        message = str(error)
        if api_key:
            message = message.replace(api_key, "[redacted]")
        trace = traceback.format_exc()
        if api_key:
            trace = trace.replace(api_key, "[redacted]")
        _log(
            f"LangChain request failed for model {model_name!r}: {type(error).__name__}: {message}\n{trace}",
            error=True,
        )
        detail = message.strip() or type(error).__name__
        if len(detail) > 600:
            detail = detail[:597] + "..."
        error_message = f"Provider request failed ({type(error).__name__}): {detail}"
        progress_queue.put(("error", error_message))
        result_queue.put({"error": error_message})


def _fetch_model_ids(provider: str, base_url: str, api_key: str) -> list[str]:
    if provider == "gemini":
        url = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000"
        headers = {"x-goog-api-key": api_key} if api_key else {}
    else:
        url = f"{base_url.rstrip('/')}/models"
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}

    request = URLRequest(url, headers=headers, method="GET")
    with urlopen(request, timeout=30) as response:
        body = json.loads(response.read().decode("utf-8"))

    if provider == "gemini":
        return sorted(
            {
                model["name"].removeprefix("models/")
                for model in body.get("models", [])
                if isinstance(model, dict)
                and isinstance(model.get("name"), str)
                and "generateContent" in model.get("supportedGenerationMethods", [])
            }
        )

    data = body.get("data", [])
    if not isinstance(data, list):
        raise ValueError("The endpoint did not return an OpenAI-compatible model list.")
    if provider == "openai":
        chat_prefixes = ("gpt-", "o1", "o3", "o4", "chatgpt-")
        return sorted(
            {
                item["id"]
                for item in data
                if isinstance(item, dict)
                and isinstance(item.get("id"), str)
                and item["id"].lower().startswith(chat_prefixes)
            }
        )

    non_chat_tokens = (
        "embedding",
        "tts",
        "audio",
        "transcri",
        "whisper",
        "moderation",
        "image",
        "realtime",
    )
    return sorted(
        {
            item["id"]
            for item in data
            if isinstance(item, dict)
            and isinstance(item.get("id"), str)
            and not any(token in item["id"].lower() for token in non_chat_tokens)
        }
    )


class AiService:
    def list_models(self, body: dict) -> list[str]:
        provider, base_url = self._provider_settings(body)
        self._report(None, "models", f"Loading available models from {provider}.")
        try:
            models = _fetch_model_ids(provider, base_url, str(body.get("api_key", "")))
        except HTTPError as error:
            _log(f"Model discovery for {provider} failed with HTTP {error.code}.", error=True)
            raise ValueError(
                f"Model listing failed with HTTP {error.code}. Check the API key and provider."
            ) from error
        except (URLError, TimeoutError) as error:
            _log(f"Could not reach the {provider} model-list endpoint: {error}", error=True)
            raise ValueError(
                "Could not reach the provider model list. Check the endpoint and network."
            ) from error
        except Exception as error:
            _log(f"Model discovery for {provider} failed: {type(error).__name__}: {error}", error=True)
            raise ValueError("The provider returned an unsupported model-list response.") from error

        self._report(None, "models", f"Loaded {len(models)} available model(s).")
        return models

    def create_table_plan(
        self,
        body: dict,
        database,
        cancel_event,
        progress: Callable[[str, str], None],
    ) -> dict:
        provider, base_url = self._provider_settings(body)
        model = str(body.get("model", "")).strip()
        api_key = str(body.get("api_key", ""))
        prompt = str(body.get("prompt", "")).strip()
        table_name = str(body.get("table_name", "")).strip()
        if not model:
            raise ValueError("Choose an AI model.")
        if not table_name:
            raise ValueError("Select a table to configure.")
        if not prompt:
            raise ValueError("A table generation prompt is required.")
        if len(prompt) > 4_000:
            raise ValueError("Keep the generation prompt under 4,000 characters.")

        self._report(progress, "schema", f"Reading metadata for {table_name}…")
        try:
            _log(f"Reading AI schema metadata for table {table_name}.")
            metadata = database.get_table_metadata(table_name).model_dump(mode="json")
            table_schema = {
                "name": metadata["name"],
                "columns": [
                    {
                        key: column[key]
                        for key in (
                            "name",
                            "type",
                            "nullable",
                            "unique",
                            "primary_key",
                            "foreign_keys",
                            "autoincrement",
                            "computed",
                            "length",
                            "precision",
                            "scale",
                        )
                    }
                    for column in metadata["columns"]
                ],
            }
            _log(f"Finished reading schema metadata for table {table_name}.")
        except Exception as error:
            _log(
                f"Could not read schema for {table_name}: {type(error).__name__}: {error}",
                error=True,
            )
            raise ValueError(f"Could not read schema for table '{table_name}': {error}") from error

        if not table_schema["columns"]:
            raise ValueError(f"Table '{table_name}' has no columns to configure.")
        if cancel_event.is_set():
            raise AiPlanCancelled("AI table plan request cancelled.")

        self._report(
            progress,
            "schema",
            f"Found {len(table_schema['columns'])} column(s) in {table_name}.",
        )
        self._report(
            progress,
            "provider",
            f"Starting {provider} model {model} through LangChain…",
        )

        response_schema = {
            "type": "object",
            # LangChain may convert this JSON schema to a function/tool schema
            # for OpenAI-compatible providers; the title supplies that tool name.
            "title": "TableGenerationPlan",
            "properties": {
                "no_of_entries": {"type": "integer"},
                "columns": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "column": {"type": "string"},
                            "generator_type": {
                                "type": "string",
                                "enum": ["faker", "regex"],
                            },
                            "generator": {"type": "string"},
                            "reason": {"type": "string"},
                        },
                        "required": [
                            "column",
                            "generator_type",
                            "generator",
                            "reason",
                        ],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["no_of_entries", "columns"],
            "additionalProperties": False,
        }
        system_prompt = (
            "Create a synthetic data generation plan for the one provided table. "
            "Return every provided column exactly once. Keep foreign-key and "
            "database-managed columns consistent with their metadata. The "
            "response schema requires generator_type and generator for every "
            "column; for foreign-key or database-managed columns, use "
            "generator_type 'faker' and any listed Faker method as placeholders "
            "because those fields will be ignored. For each ordinary column "
            "choose either generator_type 'faker' with one exact "
            "generator name from the provided list, or generator_type 'regex' "
            "with one standalone, Python-compatible regular expression for the "
            "column. Make it exact: use ^ at the start and $ at the end, explicit "
            "character classes such as [A-Z] or [0-9], and bounded repetitions "
            "such as [A-Z]{3}. Do not concatenate patterns, add explanations, "
            "or use whitespace, control characters, ., \\w, \\s, *, +, ?, "
            "lookarounds, or backreferences. Match the column name, SQL type, "
            "and maximum length. Regex generation is only for compact structured specific "
            "values; use Faker for natural language, names, or dates. Use regex "
            "for structured formats such as codes, identifiers, and fixed-width "
            "strings. "
            "Never return a generic generator label such as 'faker'. Set "
            "the row count based on the user's request, defaulting to 50 when "
            "unspecified. Do not return generated values or sample rows."
        )
        user_payload = json.dumps(
            {
                "prompt": prompt,
                "table_schema": table_schema,
                "available_generators": body.get("generators", []),
            }
        )
        # This method runs inside a Runner thread. Forking from that thread can
        # leave the child stuck on inherited locks before its target starts.
        # Spawn creates a clean interpreter and works consistently in the app
        # and in debugger mode.
        process_context = get_context("spawn")
        result_queue: Queue = process_context.Queue()
        progress_queue: Queue = process_context.Queue()
        process = process_context.Process(
            target=_invoke_langchain_plan,
            args=(
                base_url,
                model,
                api_key,
                system_prompt,
                user_payload,
                response_schema,
                result_queue,
                progress_queue,
            ),
        )
        started_at = time.monotonic()
        timeout_seconds = 75
        self._report(progress, "provider", "Starting the AI worker…")
        _log("Starting AI model worker with multiprocessing spawn.")
        process.start()
        _log(f"AI model worker started with pid={process.pid}.")
        next_wait_log = started_at + 8

        try:
            while process.is_alive():
                while True:
                    try:
                        stage, message = progress_queue.get_nowait()
                        self._report(progress, stage, message)
                        if stage == "error":
                            # Provider errors are terminal. Surface them now
                            # instead of waiting for the worker's process exit
                            # (or the overall request timeout).
                            raise ValueError(message)
                    except Empty:
                        break

                if cancel_event.is_set():
                    process.terminate()
                    process.join()
                    raise AiPlanCancelled("AI table plan request cancelled.")

                elapsed = time.monotonic() - started_at
                if elapsed >= timeout_seconds:
                    process.terminate()
                    process.join()
                    raise TimeoutError(f"The provider did not respond within {timeout_seconds} seconds.")
                if time.monotonic() >= next_wait_log:
                    self._report(
                        progress,
                        "waiting",
                        f"Still waiting for {provider} ({int(elapsed)}s elapsed)…",
                    )
                    next_wait_log = time.monotonic() + 8
                cancel_event.wait(0.15)

            process.join()
            while True:
                try:
                    stage, message = progress_queue.get_nowait()
                    self._report(progress, stage, message)
                except Empty:
                    break
            if cancel_event.is_set():
                raise AiPlanCancelled("AI table plan request cancelled.")
            if process.exitcode != 0:
                _log(f"AI worker exited with code {process.exitcode}.", error=True)
                raise ValueError("The AI worker stopped unexpectedly. See the AI log for details.")
            try:
                ai_result = result_queue.get(timeout=1)
            except Empty as error:
                _log("AI worker exited without returning a result.", error=True)
                raise ValueError("The AI worker returned no result. See the AI log for details.") from error
        except TimeoutError as error:
            _log(str(error), error=True)
            raise ValueError(str(error)) from error
        finally:
            if process.is_alive():
                process.terminate()
                process.join()
            result_queue.close()
            progress_queue.close()

        if "error" in ai_result:
            raise ValueError(ai_result["error"])
        result = ai_result.get("result")
        if not isinstance(result, dict) or not isinstance(result.get("columns"), list):
            _log("The provider returned a response without a valid columns array.", error=True)
            raise ValueError("The AI response did not include a valid table plan.")

        self._report(progress, "plan", f"Validating the model response for {table_name}…")
        normalized = self._normalize_table_plan(table_schema, result, body.get("generators", []))
        self._report(progress, "done", f"Plan for {table_name} is ready to review.")
        _log(
            f"AI table plan completed for provider={provider}, model={model}, "
            f"table={table_name}, elapsed={time.monotonic() - started_at:.1f}s."
        )
        return {"table": normalized}

    @staticmethod
    def _provider_settings(body: dict) -> tuple[str, str]:
        provider = str(body.get("provider", ""))
        if provider not in ("gemini", "openai", "openai_compatible"):
            raise ValueError("Choose a supported AI provider.")
        base_url = PROVIDER_URLS.get(provider, str(body.get("base_url", "")).strip())
        parsed = urlparse(base_url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username or parsed.password:
            raise ValueError("Enter a valid HTTP or HTTPS API base URL without embedded credentials.")
        return provider, base_url

    @staticmethod
    def _report(
        callback: Callable[[str, str], None] | None,
        stage: str,
        message: str,
    ) -> None:
        _log(f"[{stage}] {message}")
        if callback:
            callback(stage, message)

    @staticmethod
    def _normalize_table_plan(table: dict, result: dict, generators: list[str]) -> dict:
        allowed_generators = set(generators)
        if not allowed_generators:
            raise ValueError("No Faker methods are available to create a table plan.")
        try:
            row_count = max(1, min(int(result.get("no_of_entries", 50)), 10_000))
        except (TypeError, ValueError):
            row_count = 50

        model_columns = {
            column.get("column"): column
            for column in result.get("columns", [])
            if isinstance(column, dict) and isinstance(column.get("column"), str)
        }
        normalized_columns = []
        for column in table["columns"]:
            foreign_key = column.get("foreign_keys")
            if foreign_key and foreign_key.get("table"):
                generator_type = "foreign"
                generator = f"{foreign_key['table']}__{foreign_key['column']}"
                reason = f"Preserves the relationship to {foreign_key['table']}"
            elif column.get("autoincrement"):
                generator_type = "autoincrement"
                generator = None
                reason = "Database-managed identifier"
            elif column.get("computed"):
                generator_type = "computed"
                generator = None
                reason = "Computed by the database"
            else:
                model_column = model_columns.get(column["name"], {})
                candidate = model_column.get("generator")
                reason = str(model_column.get("reason", "Choose a generator in the table"))[:240]
                requested_type = model_column.get("generator_type")
                if requested_type == "regex" and isinstance(candidate, str):
                    try:
                        AiService._validate_ai_regex(candidate, column)
                        generator_type = "regex"
                        generator = candidate
                    except (ValueError, re.error):
                        generator_type = "faker"
                        generator = AiService._fallback_faker_generator(column, allowed_generators)
                        reason = f"{reason}. The suggested regex was invalid or unsafe; using {generator}."
                else:
                    generator_type = "faker"
                    generator = (
                        candidate
                        if isinstance(candidate, str) and candidate in allowed_generators
                        else AiService._fallback_faker_generator(column, allowed_generators)
                    )
                    if generator != candidate:
                        reason = f"{reason}. Using {generator} as a valid Faker fallback."

            normalized_columns.append(
                {
                    "name": column["name"],
                    "type": generator_type,
                    "generator": generator,
                    "reason": reason,
                }
            )
        return {
            "name": table["name"],
            "no_of_entries": row_count,
            "columns": normalized_columns,
        }

    @staticmethod
    def _validate_ai_regex(pattern: str, column: dict) -> None:
        if len(pattern) > 160 or not pattern.startswith("^") or not pattern.endswith("$"):
            raise ValueError("Regex must be short and anchored.")
        if pattern.count("^") != 1 or pattern.count("$") != 1:
            raise ValueError("Regex must have one start and end anchor.")
        if re.search(r"\\[A-Za-z]", pattern):
            raise ValueError("Use explicit character classes instead of shorthand escapes.")
        if "." in pattern or "[^" in pattern:
            raise ValueError("Avoid wildcard and negated character classes.")
        if re.search(r"\{\d+,\}", pattern):
            raise ValueError("Regex repetitions must have a bounded length.")
        if any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in pattern):
            raise ValueError("Regex cannot contain whitespace or control characters.")

        max_length = column.get("length")
        max_length = max_length if isinstance(max_length, int) and max_length > 0 else 128
        for match in re.finditer(r"\{(\d+)(?:,(\d+))?\}", pattern):
            lower = int(match.group(1))
            upper = int(match.group(2) or lower)
            if lower < 1 or upper < lower or upper > min(max_length, 128):
                raise ValueError("Regex repetition must have a safe, bounded length.")

        escaped = False
        for char in pattern:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char in "*+?":
                raise ValueError("Regex quantifiers must use bounded repetitions.")

        compiled = re.compile(pattern)
        for _ in range(16):
            try:
                value = rstr.xeger(pattern)
            except Exception as error:
                raise ValueError("Regex could not generate a value safely.") from error
            if (
                not value
                or len(value) > max_length
                or any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in value)
                or compiled.fullmatch(value) is None
            ):
                raise ValueError("Regex can generate empty, oversized, or unsafe values.")

    @staticmethod
    def _fallback_faker_generator(column: dict, allowed_generators: set[str]) -> str:
        name = str(column.get("name", "")).lower()
        column_type = str(column.get("type", "")).lower()

        preferences = []
        if "bool" in column_type:
            preferences = ["boolean"]
        elif any(part in column_type for part in ("int", "numeric", "decimal")):
            preferences = ["random_int", "pyint"]
        elif any(part in column_type for part in ("float", "real", "double")):
            preferences = ["pyfloat", "random_number"]
        elif "datetime" in column_type or "timestamp" in column_type:
            preferences = ["date_time"]
        elif column_type == "date" or column_type.endswith(".date"):
            preferences = ["date"]
        elif column_type == "time" or column_type.endswith(".time"):
            preferences = ["time"]

        semantic_preferences = (
            (("email", "mail"), "email"),
            (("phone", "mobile", "telephone", "tel"), "phone_number"),
            (("first_name", "given_name"), "first_name"),
            (("last_name", "family_name", "surname"), "last_name"),
            (("name", "person"), "name"),
            (("address", "street"), "address"),
            (("city",), "city"),
            (("country",), "country"),
            (("company", "organization", "organisation"), "company"),
            (("url", "website"), "url"),
            (("uuid",), "uuid4"),
        )
        for tokens, method in semantic_preferences:
            if any(token in name for token in tokens):
                preferences.append(method)

        preferences.append("word")
        for method in preferences:
            if method in allowed_generators:
                return method
        return sorted(allowed_generators)[0]
