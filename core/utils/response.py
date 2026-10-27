import re
from typing import Any, Literal

from pydantic import BaseModel, model_validator


class Response(BaseModel):
    status: Literal["ok", "error", "pending"]
    payload: Any | None = None
    error: str | None = None
    traceback: str | None = None

    def to_dict(self) -> dict:
        return self.model_dump()


class Request(BaseModel):
    id: str | None = None
    kind: str
    body: dict[str, Any] | None = None

    @staticmethod
    def _snake(s: str) -> str:
        return re.sub(r"(?<!^)(?=[A-Z])", "_", s).lower()

    @classmethod
    def _transform(cls, obj: Any) -> Any:
        if isinstance(obj, dict):
            return {cls._snake(k): cls._transform(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [cls._transform(v) for v in obj]
        return obj

    @model_validator(mode="before")
    @classmethod
    def normalize_body(cls, data: dict) -> dict:
        if "body" in data:
            data["body"] = cls._transform(data["body"])
        return data
